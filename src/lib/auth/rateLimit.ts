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

export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

const g = globalThis as unknown as { unlockLimiter?: FailureRateLimiter };
/** Per-process limiter: 5 wrong passphrases in 15 minutes locks that client out for 15 minutes. */
export const unlockLimiter = (g.unlockLimiter ??= new FailureRateLimiter({ maxFailures: 5, windowMs: 15 * 60_000, lockoutMs: 15 * 60_000 }));
