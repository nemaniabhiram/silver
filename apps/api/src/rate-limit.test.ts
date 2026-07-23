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
