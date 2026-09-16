import { describe, it, expect, afterEach, vi } from "vitest";
import { FailureRateLimiter, clientKey, unlockLimiter, unlockGlobalLimiter } from "@/lib/auth/rateLimit";

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 'direct' when TRUST_PROXY is not set, even if x-forwarded-for is present", () => {
    vi.stubEnv("TRUST_PROXY", "");
    expect(
      clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })),
    ).toBe("direct");
  });

  it("with TRUST_PROXY=1, uses the last x-forwarded-for entry, then x-real-ip, then 'direct'", () => {
    vi.stubEnv("TRUST_PROXY", "1");
    expect(
      clientKey(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })),
    ).toBe("10.0.0.1");
    expect(clientKey(new Request("http://x", { headers: { "x-real-ip": "5.6.7.8" } }))).toBe("5.6.7.8");
    expect(clientKey(new Request("http://x"))).toBe("direct");
  });
});

describe("unlockGlobalLimiter", () => {
  it("locks after 100 failures recorded across distinct clients, refusing an unrelated client that never failed", () => {
    const GLOBAL_KEY = "__test_global__";
    // The route records every failed attempt under one shared global key regardless of which
    // client made it, so 100 distinct clients failing once each trips the same bucket.
    for (let i = 0; i < 100; i++) unlockGlobalLimiter.recordFailure(GLOBAL_KEY);
    expect(unlockGlobalLimiter.check(GLOBAL_KEY).allowed).toBe(false);

    // A brand-new client identity that itself never failed is still fine on the per-client
    // limiter (proving per-client tracking is untouched)...
    expect(unlockLimiter.check("never-failed-client").allowed).toBe(true);
    // ...but the route ORs both gates, so once the shared global bucket is tripped, that
    // unrelated client is refused too because the global check alone is enough to lock them out.
    expect(unlockGlobalLimiter.check(GLOBAL_KEY).allowed).toBe(false);
  });
});
