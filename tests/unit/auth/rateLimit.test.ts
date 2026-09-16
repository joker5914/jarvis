import { describe, it, expect } from "vitest";
import { FailureRateLimiter, clientKey } from "@/lib/auth/rateLimit";

function limiter(start = 0) {
  let t = start;
  const l = new FailureRateLimiter({ maxFailures: 3, windowMs: 60_000, lockoutMs: 120_000, now: () => t });
  return { l, advance: (ms: number) => (t += ms) };
}

describe("FailureRateLimiter", () => {
  it("allows until maxFailures within the window, then locks out with retryAfter", () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 3; i++) {
      expect(l.check("a").allowed).toBe(true);
      l.recordFailure("a");
      advance(1_000);
    }
    const r = l.check("a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(120);
  });
  it("forgets failures outside the window", () => {
    const { l, advance } = limiter();
    l.recordFailure("a"); l.recordFailure("a");
    advance(61_000);
    l.recordFailure("a");
    expect(l.check("a").allowed).toBe(true);
  });
  it("lockout expires and reset clears immediately", () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 3; i++) l.recordFailure("a");
    expect(l.check("a").allowed).toBe(false);
    advance(120_001);
    expect(l.check("a").allowed).toBe(true);
    for (let i = 0; i < 3; i++) l.recordFailure("b");
    l.reset("b");
    expect(l.check("b").allowed).toBe(true);
  });
  it("keys are independent", () => {
    const { l } = limiter();
    for (let i = 0; i < 3; i++) l.recordFailure("a");
    expect(l.check("z").allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first x-forwarded-for address, then x-real-ip, then unknown", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }))).toBe("1.2.3.4");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("http://x"))).toBe("unknown");
  });
});
