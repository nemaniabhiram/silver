import type { RequestHandler } from "express";
import { ApiError } from "./errors.js";

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Window {
  startedAt: number;
  count: number;
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window counters held in this process. A second api instance gets its own
 * counters, which is accepted for now — `consume` is the seam a shared store
 * would slot into without touching any caller.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  consume(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitVerdict {
    const window = this.windows.get(key);

    if (!window || now - window.startedAt >= windowMs) {
      this.pruneIfCrowded(now, windowMs);
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (window.count >= limit) {
      const remainingMs = window.startedAt + windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }

    window.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private pruneIfCrowded(now: number, windowMs: number): void {
    if (this.windows.size < MAX_TRACKED_KEYS) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= windowMs) {
        this.windows.delete(key);
      }
    }
  }
}

export function rateLimit(
  limiter: RateLimiter,
  bucket: string,
  limit: number,
  windowMs: number,
): RequestHandler {
  return (request, _response, next) => {
    const verdict = limiter.consume(`${bucket}:${request.ip}`, limit, windowMs);

    if (!verdict.allowed) {
      next(
        new ApiError("RATE_LIMITED", "You're going too fast. Try again in a moment.", {
          "Retry-After": String(verdict.retryAfterSeconds),
        }),
      );
      return;
    }

    next();
  };
}
