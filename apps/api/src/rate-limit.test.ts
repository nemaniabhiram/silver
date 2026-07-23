import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

const WINDOW = 60_000;

describe("RateLimiter", () => {
  it("allows exactly the limit within one window", () => {
    const limiter = new RateLimiter();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(limiter.consume("ip", 3, WINDOW, 1_000).allowed).toBe(true);
    }
    expect(limiter.consume("ip", 3, WINDOW, 1_000).allowed).toBe(false);
  });

  it("reports how long until the window rolls over", () => {
    const limiter = new RateLimiter();
    limiter.consume("ip", 1, WINDOW, 0);
    expect(limiter.consume("ip", 1, WINDOW, 20_000).retryAfterSeconds).toBe(40);
  });

  it("never reports zero seconds while still blocked", () => {
    const limiter = new RateLimiter();
    limiter.consume("ip", 1, WINDOW, 0);
    expect(limiter.consume("ip", 1, WINDOW, 59_999).retryAfterSeconds).toBe(1);
  });

  it("starts a fresh window once the old one elapses", () => {
    const limiter = new RateLimiter();
    limiter.consume("ip", 1, WINDOW, 0);
    expect(limiter.consume("ip", 1, WINDOW, WINDOW).allowed).toBe(true);
  });

  it("counts each key separately", () => {
    const limiter = new RateLimiter();
    limiter.consume("a", 1, WINDOW, 0);
    expect(limiter.consume("b", 1, WINDOW, 0).allowed).toBe(true);
  });
});

describe("peek", () => {
  it("reports the verdict without spending anything", () => {
    const limiter = new RateLimiter();

    for (let look = 0; look < 10; look += 1) {
      expect(limiter.peek("ip", 2, WINDOW, 1_000).allowed).toBe(true);
    }

    expect(limiter.consume("ip", 2, WINDOW, 1_000).allowed).toBe(true);
    expect(limiter.consume("ip", 2, WINDOW, 1_000).allowed).toBe(true);
    expect(limiter.consume("ip", 2, WINDOW, 1_000).allowed).toBe(false);
  });

  it("sees the exhausted window that consume created", () => {
    const limiter = new RateLimiter();
    limiter.consume("ip", 1, WINDOW, 0);

    const verdict = limiter.peek("ip", 1, WINDOW, 10_000);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(50);
  });

  it("does not open a window a later consume would inherit", () => {
    const limiter = new RateLimiter();

    limiter.peek("ip", 1, WINDOW, 0);
    limiter.peek("ip", 1, WINDOW, 30_000);

    // The window starts when the first deployment is actually created, not when
    // the first look happened, so the caller gets a full window of quota.
    expect(limiter.consume("ip", 1, WINDOW, 60_000).allowed).toBe(true);
    expect(limiter.consume("ip", 1, WINDOW, 90_000).allowed).toBe(false);
  });
});
