import { createLogger, createPool, loadConfig, runMigrations } from "@silver/shared";
import type pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rate-limit.js";

const WINDOW = 60_000;

const config = loadConfig();
const log = createLogger("rate-limit-test");
const pool = createPool(config, log);

// Resolved before the suite is registered, because skipIf is evaluated then. A
// flag set in beforeAll comes too late and the suite runs against nothing.
const reachable = await runMigrations(pool).then(
  () => true,
  () => false,
);

/** Time is injected so a window can elapse without the suite waiting for it. */
const at = (ms: number) => new Date(ms);

afterAll(async () => {
  await pool.end();
});

describe.skipIf(!reachable)("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(async () => {
    await pool.query("TRUNCATE rate_limits");
    limiter = new RateLimiter(pool, log);
  });

  it("allows exactly the limit within one window", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await limiter.consume("ip", 3, WINDOW, at(1_000))).allowed).toBe(true);
    }
    expect((await limiter.consume("ip", 3, WINDOW, at(1_000))).allowed).toBe(false);
  });

  it("reports how long until the window rolls over", async () => {
    await limiter.consume("ip", 1, WINDOW, at(0));
    expect((await limiter.consume("ip", 1, WINDOW, at(20_000))).retryAfterSeconds).toBe(40);
  });

  it("never reports zero seconds while still blocked", async () => {
    await limiter.consume("ip", 1, WINDOW, at(0));
    expect((await limiter.consume("ip", 1, WINDOW, at(59_999))).retryAfterSeconds).toBe(1);
  });

  it("starts a fresh window once the old one elapses", async () => {
    await limiter.consume("ip", 1, WINDOW, at(0));
    expect((await limiter.consume("ip", 1, WINDOW, at(WINDOW))).allowed).toBe(true);
  });

  it("counts each key separately", async () => {
    await limiter.consume("a", 1, WINDOW, at(0));
    expect((await limiter.consume("b", 1, WINDOW, at(0))).allowed).toBe(true);
  });

  /**
   * The reason the counters left process memory. Two instances behind a load
   * balancer used to grant the limit each, so the number the product advertised
   * was multiplied by however many were running.
   */
  it("shares one window across separate instances", async () => {
    const first = new RateLimiter(pool, log);
    const second = new RateLimiter(pool, log);

    expect((await first.consume("ip", 2, WINDOW, at(0))).allowed).toBe(true);
    expect((await second.consume("ip", 2, WINDOW, at(0))).allowed).toBe(true);
    expect((await second.consume("ip", 2, WINDOW, at(0))).allowed).toBe(false);
    expect((await first.consume("ip", 2, WINDOW, at(0))).allowed).toBe(false);
  });

  /**
   * A limiter that cannot reach the database must not take uploads with it.
   * Being briefly too generous beats being closed for business.
   */
  it("allows the request when the database cannot be reached", async () => {
    const broken = {
      query: () => Promise.reject(new Error("no connection")),
    } as unknown as pg.Pool;
    const quiet = createLogger("rate-limit-test");
    vi.spyOn(quiet, "warn").mockImplementation(() => undefined);

    const offline = new RateLimiter(broken, quiet);

    expect((await offline.consume("ip", 1, WINDOW)).allowed).toBe(true);
    expect((await offline.peek("ip", 1, WINDOW)).allowed).toBe(true);
    expect(quiet.warn).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(!reachable)("peek", () => {
  let limiter: RateLimiter;

  beforeEach(async () => {
    await pool.query("TRUNCATE rate_limits");
    limiter = new RateLimiter(pool, log);
  });

  it("reports the verdict without spending anything", async () => {
    for (let look = 0; look < 10; look += 1) {
      expect((await limiter.peek("ip", 2, WINDOW, at(1_000))).allowed).toBe(true);
    }

    expect((await limiter.consume("ip", 2, WINDOW, at(1_000))).allowed).toBe(true);
    expect((await limiter.consume("ip", 2, WINDOW, at(1_000))).allowed).toBe(true);
    expect((await limiter.consume("ip", 2, WINDOW, at(1_000))).allowed).toBe(false);
  });

  it("sees the exhausted window that consume created", async () => {
    await limiter.consume("ip", 1, WINDOW, at(0));

    const verdict = await limiter.peek("ip", 1, WINDOW, at(10_000));
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(50);
  });

  it("does not open a window a later consume would inherit", async () => {
    await limiter.peek("ip", 1, WINDOW, at(0));
    await limiter.peek("ip", 1, WINDOW, at(30_000));

    // The window starts when the first deployment is actually created, not when
    // the first look happened, so the caller gets a full window of quota.
    expect((await limiter.consume("ip", 1, WINDOW, at(60_000))).allowed).toBe(true);
    expect((await limiter.consume("ip", 1, WINDOW, at(90_000))).allowed).toBe(false);
  });
});
