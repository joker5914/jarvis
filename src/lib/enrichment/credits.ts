import { prisma } from "@/lib/db";
import { REGION } from "@/lib/config/region";
import { utcForLocal } from "@/lib/scanner/window";
import type { RuntimeConfig } from "@/lib/config/runtime";

/** Calendar date (`{ y, m, d }`, 1-indexed month) in the given IANA timezone. */
function localYmd(d: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (k: string) => Number(parts.find((x) => x.type === k)!.value);
  return { y: g("year"), m: g("month"), d: g("day") };
}

/** Number of days in month `m` (1-indexed) of year `y`. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * The start of the current Apollo credit cycle: if `cycleRenewsOn` is unset, the first of the
 * current calendar month at local midnight; otherwise the most recent occurrence (on or before
 * `now`) of that date's day-of-month at local midnight, clamped to the shorter month when the
 * renewal day (e.g. 31) doesn't exist in it (so a Jan 31 renewal lands on Apr 30, not May 1).
 */
export function creditCycleStart(now: Date, cycleRenewsOn: string | null, tz: string): Date {
  const { y, m, d } = localYmd(now, tz);
  const renewDay = cycleRenewsOn ? Number(cycleRenewsOn.slice(8, 10)) : 1;
  let yy = y;
  let mm = m;
  if (d < Math.min(renewDay, daysIn(y, m))) {
    mm -= 1;
    if (mm === 0) {
      mm = 12;
      yy -= 1;
    }
  }
  return utcForLocal(yy, mm, Math.min(renewDay, daysIn(yy, mm)), 0, 0, tz);
}

/** Apollo charges one credit per verified net-new email; that's the only thing we store that maps to a credit. */
export async function creditsUsed(ownerId: string, since: Date): Promise<number> {
  return prisma.contact.count({ where: { ownerId, source: "apollo", type: "email", createdAt: { gte: since } } });
}

export async function creditStatus(
  ownerId: string,
  cfg: RuntimeConfig,
  now: Date = new Date(),
): Promise<{ used: number; cap: number; remaining: number; cycleStart: Date; cycleRenewsOn: string | null }> {
  const cycleStart = creditCycleStart(now, cfg.enrichment.cycleRenewsOn, REGION.timezone);
  const used = await creditsUsed(ownerId, cycleStart);
  const cap = cfg.enrichment.monthlyCreditCap;
  return { used, cap, remaining: Math.max(0, cap - used), cycleStart, cycleRenewsOn: cfg.enrichment.cycleRenewsOn };
}

/** Rough spend estimate for the UI/bulk actions: worst case, every person revealed costs a credit. */
export const estimateCredits = (businesses: number, people: number): number => businesses * people;
