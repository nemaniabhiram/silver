import type { Logger } from "@silver/shared";
import type { RequestHandler } from "express";
import type pg from "pg";
import { ApiError } from "./errors.js";

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface WindowRow {
  window_started_at: Date;
  count: number;
}

/**
 * Fixed window counters, kept in Postgres so every api instance reads and
 * writes the same ones. Held in process memory they stopped meaning anything
 * the moment a second instance existed, and a restart forgot them entirely.
 *
 * `consume` counts a request against the window; `peek` reports the verdict
 * without spending anything, for work whose outcome is not yet known.
 */
export class RateLimiter {
  constructor(
    private readonly pool: pg.Pool,
    private readonly log: Logger,
  ) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now: Date = new Date(),
  ): Promise<RateLimitVerdict> {
    try {
      // One statement, so two instances arriving together cannot both read the
      // same count and both decide they are under the limit.
      const result = await this.pool.query<WindowRow>(
        `INSERT INTO rate_limits (key, window_started_at, count)
         VALUES ($1, $2, 1)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE
             WHEN $2 - rate_limits.window_started_at >= $3::interval THEN 1
             ELSE rate_limits.count + 1
           END,
           window_started_at = CASE
             WHEN $2 - rate_limits.window_started_at >= $3::interval THEN $2
             ELSE rate_limits.window_started_at
           END
         RETURNING window_started_at, count`,
        [key, now, intervalOf(windowMs)],
      );

      return verdictFor(result.rows[0], limit, windowMs, now);
    } catch (error) {
      return this.failOpen(error);
    }
  }

  async peek(
    key: string,
    limit: number,
    windowMs: number,
    now: Date = new Date(),
  ): Promise<RateLimitVerdict> {
    try {
      const result = await this.pool.query<WindowRow>(
        `SELECT window_started_at, count FROM rate_limits
         WHERE key = $1 AND $2 - window_started_at < $3::interval`,
        [key, now, intervalOf(windowMs)],
      );

      const window = result.rows[0];
      if (!window) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      // peek asks whether the next request would be allowed, so it compares
      // against what the count would become rather than what it is.
      return verdictFor({ ...window, count: window.count + 1 }, limit, windowMs, now);
    } catch (error) {
      return this.failOpen(error);
    }
  }

  /**
   * A limiter that cannot reach the database must not take uploads down with
   * it. Being briefly too generous is a smaller failure than being closed.
   */
  private failOpen(error: unknown): RateLimitVerdict {
    this.log.warn("rate limit check failed, allowing the request", {
      err: error instanceof Error ? error.message : "unknown",
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function verdictFor(
  window: WindowRow | undefined,
  limit: number,
  windowMs: number,
  now: Date,
): RateLimitVerdict {
  if (!window || window.count <= limit) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const remainingMs = window.window_started_at.getTime() + windowMs - now.getTime();
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

function intervalOf(windowMs: number): string {
  return `${windowMs} milliseconds`;
}

export function tooFast(retryAfterSeconds: number): ApiError {
  return new ApiError("RATE_LIMITED", "You're going too fast. Try again in a moment.", {
    "Retry-After": String(retryAfterSeconds),
  });
}

export function rateLimit(
  limiter: RateLimiter,
  bucket: string,
  limit: number,
  windowMs: number,
): RequestHandler {
  return async (request, _response, next) => {
    const verdict = await limiter.consume(`${bucket}:${request.ip}`, limit, windowMs);
    next(verdict.allowed ? undefined : tooFast(verdict.retryAfterSeconds));
  };
}
