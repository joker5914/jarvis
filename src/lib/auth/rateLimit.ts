export type RateLimiterOptions = { maxFailures: number; windowMs: number; lockoutMs: number; now?: () => number };

type Entry = { failures: number[]; lockedUntil: number };

export class FailureRateLimiter {
  private entries = new Map<string, Entry>();
  private now: () => number;
  constructor(private opts: RateLimiterOptions) {
    this.now = opts.now ?? Date.now;
  }
  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { failures: [], lockedUntil: 0 };
      this.entries.set(key, e);
    }
    return e;
  }
  check(key: string): { allowed: boolean; retryAfterSec?: number } {
    const e = this.entries.get(key);
    if (!e) return { allowed: true };
    const t = this.now();
    if (e.lockedUntil > t) return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - t) / 1000) };
    return { allowed: true };
  }
  recordFailure(key: string): void {
    const t = this.now();
    const e = this.entry(key);
    e.failures = e.failures.filter((f) => t - f < this.opts.windowMs);
    e.failures.push(t);
    if (e.failures.length >= this.opts.maxFailures) {
      e.lockedUntil = t + this.opts.lockoutMs;
      e.failures = [];
    }
    if (this.entries.size > 10_000) this.entries.clear(); // memory bound; single-instance app
  }
  reset(key: string): void {
    this.entries.delete(key);
  }
}

/**
 * Only trust proxy-supplied client-address headers when TRUST_PROXY=1 (set behind Railway or
 * any reverse proxy that terminates/overwrites these headers at a trusted edge). Otherwise any
 * client could spoof x-forwarded-for/x-real-ip to defeat per-client throttling, so we collapse
 * everyone onto a single "direct" key and rely on the global limiter instead.
 */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY !== "1") return "direct";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    // The rightmost entry is the hop the trusted edge itself appended; earlier entries are
    // client-supplied and spoofable.
    if (parts.length) return parts[parts.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() || "direct";
}

const g = globalThis as unknown as {
  unlockLimiter?: FailureRateLimiter;
  unlockGlobalLimiter?: FailureRateLimiter;
};
/** Per-process limiter: 5 wrong passphrases in 15 minutes locks that client out for 15 minutes. */
export const unlockLimiter = (g.unlockLimiter ??= new FailureRateLimiter({ maxFailures: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 }));
/**
 * Per-process global limiter: bounds total brute-force throughput to 100 wrong passphrases in
 * 15 minutes across ALL clients, so header rotation (or TRUST_PROXY being unset) can't be used
 * to defeat the per-client limiter above.
 */
export const unlockGlobalLimiter = (g.unlockGlobalLimiter ??= new FailureRateLimiter({ maxFailures: 100, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 }));
