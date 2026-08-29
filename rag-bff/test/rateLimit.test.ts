import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../lib/rateLimit.js";
import type { Clock } from "../lib/rateLimit.js";

/** A fake clock so tests are deterministic. */
function fakeClock(start = 0): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("rate limiter", () => {
  it("allows a request under the per-IP budget (happy)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { windowMs: 1000, maxPerIp: 3, maxPerSession: 10 },
      clock,
    );
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
  });

  it("rejects when the per-IP budget is exceeded (non-happy)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { windowMs: 1000, maxPerIp: 2, maxPerSession: 10 },
      clock,
    );
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    const verdict = limiter.check("1.2.3.4", "s1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.status).toBe(429);
    expect(verdict.reason).toBe("ip rate limit exceeded");
  });

  it("rejects when the per-session budget is exceeded (non-happy)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { windowMs: 1000, maxPerIp: 100, maxPerSession: 2 },
      clock,
    );
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    const verdict = limiter.check("1.2.3.4", "s1");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("session rate limit exceeded");
  });

  it("resets the budget after the window elapses (happy)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { windowMs: 1000, maxPerIp: 1, maxPerSession: 10 },
      clock,
    );
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(false);
    clock.advance(1001);
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
  });

  it("tracks different IPs independently (happy)", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter(
      { windowMs: 1000, maxPerIp: 1, maxPerSession: 10 },
      clock,
    );
    expect(limiter.check("1.2.3.4", "s1").allowed).toBe(true);
    expect(limiter.check("5.6.7.8", "s1").allowed).toBe(true);
  });

  it("reports the IP window usage (count/max/resetAt) for the sidebar", () => {
    const clock = fakeClock(1000);
    const limiter = createRateLimiter(
      { windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 },
      clock,
    );
    limiter.check("1.2.3.4", "s1");
    limiter.check("1.2.3.4", "s1");
    const w = limiter.ipWindow("1.2.3.4");
    expect(w.count).toBe(2);
    expect(w.max).toBe(20);
    expect(w.resetAt).toBe(1000 + 60_000);
  });

  it("reports the session window usage (count/max/resetAt) for the sidebar", () => {
    const clock = fakeClock(1000);
    const limiter = createRateLimiter(
      { windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 },
      clock,
    );
    limiter.check("1.2.3.4", "s1");
    limiter.check("1.2.3.4", "s1");
    const w = limiter.sessionWindow("s1");
    expect(w.count).toBe(2);
    expect(w.max).toBe(10);
    expect(w.resetAt).toBe(1000 + 60_000);
  });

  it("reports a fresh window (count 0) for an unused key", () => {
    const clock = fakeClock(1000);
    const limiter = createRateLimiter(
      { windowMs: 60_000, maxPerIp: 20, maxPerSession: 10 },
      clock,
    );
    const w = limiter.ipWindow("9.9.9.9");
    expect(w.count).toBe(0);
    expect(w.max).toBe(20);
    expect(w.resetAt).toBe(1000 + 60_000);
  });
});
