import { prisma } from "@/lib/db";
import { REGION } from "@/lib/config/region";
import { utcForLocal } from "@/lib/scanner/window";
import { getProviders } from "@/lib/providers";
import { json } from "@/lib/api";
import type { EnrichmentProvider } from "@/lib/providers/types";
import type { RuntimeConfig } from "@/lib/config/runtime";

/** Calendar date (`{ y, m, d }`, 1-indexed month) in the given IANA timezone. */
function localYmd(d: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (k: string) => Number(parts.find((x) => x.type === k)!.value);
  return { y: g("year"), m: g("month"), d: g("day") };
}

/** `YYYY-MM-DD` calendar date in the given IANA timezone — the same local-date rule Apollo's own
 * UI uses to show a UTC cycle-end timestamp, so the two agree (e.g. `2026-10-17T04:58:17Z` reads
 * as Oct 16 in America/Chicago). */
function localDateString(d: Date, tz: string): string {
  const { y, m, d: day } = localYmd(d, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

/**
 * Whole-branch review H1/M1: counts `ActivityLog` rows with `kind: "credit_spent"` — one written
 * per real Apollo spend (a person reveal that returned an email, or an Organization Search page;
 * see `src/lib/jobs/enrich.ts`'s `logCreditSpent` and `src/lib/enrichment/candidates.ts`'s
 * `findCandidates`) — instead of counting `Contact` rows directly. Two problems that fixed:
 * (1) M1: "not the decision-maker" suppression (`PATCH /businesses/:id/people`) hard-deletes a
 * revealed person's Apollo Contact rows, which used to make the credit they'd already cost
 * silently vanish from this count too, understating real spend for the rest of the cycle; the
 * ledger row is never deleted, so the count survives a suppression. (2) H1: the no-website
 * "Find people" fallback (Organization Search) spends a real credit but never creates a Contact
 * row at all, so it was invisible to this count entirely before the ledger existed. Migration
 * `20260918010100_credit_ledger_backfill` seeds one `credit_spent` row per pre-existing
 * Apollo-sourced email Contact row so history before this change still counts correctly.
 */
export async function creditsUsed(ownerId: string, since: Date): Promise<number> {
  return prisma.activityLog.count({ where: { ownerId, kind: "credit_spent", createdAt: { gte: since } } });
}

export type CreditStatus = {
  used: number;
  cap: number;
  remaining: number;
  cycleStart: Date;
  cycleRenewsOn: string | null;
  /** Apollo's own account-wide balance and cycle end (local date), or null when unavailable (no
   * key, non-200, network error) — see ApolloEnrichmentProvider.creditUsage(). */
  apollo: { limit: number; consumed: number; leftOver: number; cycleEnd: string } | null;
};

export async function creditStatus(
  ownerId: string,
  cfg: RuntimeConfig,
  now: Date = new Date(),
  provider: EnrichmentProvider = getProviders().enrichment,
  deps: { creditsUsed: typeof creditsUsed } = { creditsUsed },
): Promise<CreditStatus> {
  const live = await provider.creditUsage();
  const cycleRenewsOn = cfg.enrichment.cycleRenewsOn ?? (live ? localDateString(live.cycleEnd, REGION.timezone) : null);
  const cycleStart = creditCycleStart(now, cycleRenewsOn, REGION.timezone);
  const used = await deps.creditsUsed(ownerId, cycleStart);
  const cap = cfg.enrichment.monthlyCreditCap;
  const remaining = Math.max(0, Math.min(cap - used, live ? live.leftOver : Number.POSITIVE_INFINITY));
  return {
    used,
    cap,
    remaining,
    cycleStart,
    cycleRenewsOn,
    apollo: live ? { limit: live.limit, consumed: live.consumed, leftOver: live.leftOver, cycleEnd: localDateString(live.cycleEnd, REGION.timezone) } : null,
  };
}

/** Rough spend estimate for the UI/bulk actions: worst case, every person revealed costs a credit. */
export const estimateCredits = (businesses: number, people: number): number => businesses * people;

/**
 * Refuses at the monthly Apollo credit cap before any provider call that could spend one — the
 * single-business enrich route, the bulk enrich route, and (fix round, R6/R7) the candidates
 * route's no-domain branch, which falls back to a credited Organization Search. Takes an
 * already-loaded config so callers that also need it (e.g. for the default `people` count) don't
 * load it twice. Returns null when there is remaining budget, a 409 Response otherwise.
 */
export async function assertCredits(ownerId: string, cfg: RuntimeConfig): Promise<Response | null> {
  const s = await creditStatus(ownerId, cfg);
  if (s.remaining <= 0) {
    // Name the binding constraint: Apollo's own balance when it is empty, otherwise this app's cap.
    const error = s.apollo && s.apollo.leftOver <= 0
      ? "Apollo account is out of credits (Apollo reports 0 left)"
      : `Apollo monthly credit cap reached (${s.used}/${s.cap})`;
    return json({ error, settingsHref: "/settings" }, 409);
  }
  return null;
}
