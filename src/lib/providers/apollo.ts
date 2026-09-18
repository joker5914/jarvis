import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import { ProviderNotConfiguredError, ProviderPlanError } from "./errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
import { normalizeName } from "@/lib/jobs/shared";
import { prisma } from "@/lib/db";
import { discardBody } from "@/lib/net/safeFetch";
import { stateNameFor } from "@/lib/geo/usStates";
import type { ApolloCreditUsage, EnrichPerson, EnrichmentProvider, PeopleSearchQuery, PeopleSearchResult, PeopleSearchScope } from "./types";

const BASE = "https://api.apollo.io/api/v1";
export const ORG_SEARCH_PATH = "/mixed_companies/search";
export const PEOPLE_SEARCH_PATH = "/mixed_people/api_search";
export const PEOPLE_MATCH_PATH = "/people/match";
export const CREDIT_USAGE_PATH = "/usage_stats/credit_usage_stats";

const PLAN_BLOCK_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Path -> epoch ms until which that Apollo endpoint is known to be plan-blocked (403
 * API_INACCESSIBLE). Module-level so it survives across calls within the same process; a fresh
 * deploy/restart clears it, which is fine since the next call re-derives it from a real 403. */
const planBlockedUntil = new Map<string, number>();
/** Path -> the provider's own explanation text for the most recent plan block, kept alongside
 * planBlockedUntil so apolloPlanBlocked() can surface it without a network call. */
const planBlockedDetail = new Map<string, string>();

/** Drops this process's plan-block memo entirely (all paths). The block is provider-wide, not
 * per-endpoint, so a clear always clears everything, whether it was discovered by
 * checkPlanBlocked() revalidating a stale memo against the DB or by an explicit
 * clearPlanBlock()/test reset. */
function clearPlanBlockMemo(): void {
  planBlockedUntil.clear();
  planBlockedDetail.clear();
}

/** Marks `path` blocked in this process's memo (the worker's per-call short-circuit — see
 * checkPlanBlocked) *and* persists a single provider-wide block on the ProviderConfig row, since
 * the worker process is the only one that ever calls the *credited* People Search / People
 * Enrichment / Organization Search endpoints (JOB_MODE=queue in production) — this function is
 * only ever reached from those calls' 403 handling. (The Next.js web process does call Apollo
 * directly too, as of Task 1's live credit balance: creditUsage() reads usage_stats/credit_usage_
 * stats from Settings/the credits route, uncredited and never gated by this plan-block memo — see
 * its own doc comment. That does not change the fact this specific function only ever runs in the
 * worker.) The Next.js web process's own copy of `planBlockedUntil` is always empty for the paths
 * this function marks, so the routes' gate (apolloPlanBlocked) must be able to see this via the
 * database, not just memory. Upserts like withBudget() does, in case no ProviderConfig row exists
 * yet. The persist is best-effort: the caller always throws ProviderPlanError regardless of
 * whether this write lands, so a transient DB failure here never surfaces as a generic Prisma
 * error or re-enables pg-boss retries for the job that just saw the live 403.
 *
 * The in-process memo set below is NOT enough on its own to protect later calls in this process
 * if the persist fails: `checkPlanBlocked` always revalidates a memoized block against the
 * persisted ProviderConfig row before honoring it (see its doc comment), and with no row to find,
 * that revalidation reads back `null`, drops the memo, and lets the next call proceed to the
 * network. So a failed persist degrades the block to "skip this one job, but not the next" — the
 * next job re-hits Apollo, gets 403'd again, and tries (and may again fail) to persist. See the
 * D2 test in tests/unit/providers/apollo.test.ts for the exact sequence. */
async function markPlanBlocked(path: string, detail: string): Promise<void> {
  const until = Date.now() + PLAN_BLOCK_TTL_MS;
  planBlockedUntil.set(path, until);
  planBlockedDetail.set(path, detail);
  try {
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { planBlockedUntil: new Date(until), planBlockDetail: detail },
      create: { provider: "apollo", planBlockedUntil: new Date(until), planBlockDetail: detail },
    });
  } catch (e) {
    console.error("[apollo] failed to persist plan block (memo still set; classification unaffected)", e);
  }
}

/** Throws ProviderPlanError with no network call when `path` was recently 403'd as
 * plan-inaccessible; a no-op otherwise (including once the 6h memo has expired) — zero extra
 * reads on that common unblocked path. When the memo *does* say blocked, revalidates against the
 * persisted row before throwing: the worker and the Next.js web process are separate processes
 * (JOB_MODE=queue in production), so `clearPlanBlock()` running in the web process on a Settings
 * key save clears the DB row and its own memo but has no way to reach the worker's in-memory
 * `planBlockedUntil` — without this check the worker would keep refusing for up to the full 6h
 * TTL even after the operator "fixed" it. A cleared/expired row drops the whole memo (the block
 * is provider-wide, not per-path) and lets the call proceed normally. */
async function checkPlanBlocked(path: string): Promise<void> {
  const until = planBlockedUntil.get(path);
  if (until === undefined || until <= Date.now()) return;
  const detail = planBlockedDetail.get(path) ?? "API_INACCESSIBLE";
  let cfg: { planBlockedUntil: Date | null } | null;
  try {
    cfg = await prisma.providerConfig.findUnique({ where: { provider: "apollo" }, select: { planBlockedUntil: true } });
  } catch (e) {
    // Fail closed: the memo already says blocked, and classification must not depend on the DB in
    // either direction (a Prisma error here would otherwise become a retried job failure).
    console.error("[apollo] plan-block revalidation read failed; keeping the memoized block", e);
    throw new ProviderPlanError("apollo", path, detail);
  }
  if (!cfg?.planBlockedUntil || cfg.planBlockedUntil.getTime() <= Date.now()) {
    clearPlanBlockMemo();
    return;
  }
  throw new ProviderPlanError("apollo", path, detail);
}

/** Clears a plan block, in this process's memo and on the persisted ProviderConfig row, for the
 * given provider. Called when the operator saves a (presumably fixed) key or re-enables the
 * provider in Settings, so a stale block doesn't keep refusing Enrich after the underlying
 * problem is resolved. Provider-neutral name/signature since Settings' PUT route is shared across
 * providers, even though only Apollo populates a block today. */
export async function clearPlanBlock(provider: string): Promise<void> {
  if (provider === "apollo") {
    clearPlanBlockMemo();
    // L6 (whole-branch review): a key save/re-enable is exactly when the account behind the key
    // may have changed — without this, creditUsage()'s balance memo (keyed process-wide, not per
    // key) could keep showing the *previous* key's balance for up to creditUsageTtlMs (5 min).
    creditUsageMemo = null;
  }
  await prisma.providerConfig.updateMany({ where: { provider }, data: { planBlockedUntil: null, planBlockDetail: null } });
}

/** True when Apollo's plan is known (within the last 6h) to not include the People Search /
 * People Enrichment APIs this app relies on for lead enrichment. Used by the enrich routes to
 * refuse before even queuing a job.
 *
 * Mirrors `checkPlanBlocked`'s revalidation contract rather than trusting the in-process memo
 * outright: a "blocked" memo is only ever a starting point, confirmed (or dropped) against a
 * single PK read of the persisted ProviderConfig row on every call — this function already reads
 * that row on every call today (to catch a block set by the worker process, which this Next.js
 * web process's own memo never sees), so revalidating a blocked memo against it costs nothing
 * extra. Without this, a Settings save that clears the key/block in one web process/replica would
 * never take effect in another process that had already memoized the old block — it would keep
 * reporting 409 until its memo happened to expire on its own 6h TTL. When the row is clear or
 * expired, the memo (provider-wide, not per-path) is dropped entirely so it can't cause a false
 * "blocked" anywhere else that still reads it (e.g. checkPlanBlocked in the worker, if this ever
 * ran in the same process). When the row still says blocked, this also re-primes this process's
 * memo, matching the pre-existing behavior of keeping the memo in sync with the DB.
 * Fake provider mode never populates the memo or the row, so this always reports unblocked there. */
export async function apolloPlanBlocked(): Promise<{ blocked: boolean; detail?: string }> {
  const now = Date.now();
  let memoBlocked = false;
  for (const path of [PEOPLE_SEARCH_PATH, ORG_SEARCH_PATH, PEOPLE_MATCH_PATH]) {
    const until = planBlockedUntil.get(path);
    if (until !== undefined && until > now) {
      memoBlocked = true;
      break;
    }
  }
  const cfg = await prisma.providerConfig.findUnique({ where: { provider: "apollo" }, select: { planBlockedUntil: true, planBlockDetail: true } });
  if (cfg?.planBlockedUntil && cfg.planBlockedUntil.getTime() > now) {
    const untilMs = cfg.planBlockedUntil.getTime();
    for (const path of [PEOPLE_SEARCH_PATH, ORG_SEARCH_PATH, PEOPLE_MATCH_PATH]) {
      planBlockedUntil.set(path, untilMs);
      if (cfg.planBlockDetail) planBlockedDetail.set(path, cfg.planBlockDetail);
    }
    return { blocked: true, detail: cfg.planBlockDetail ?? undefined };
  }
  // The row disagrees with a memo that said blocked (cleared or expired) — drop the stale memo.
  if (memoBlocked) clearPlanBlockMemo();
  return { blocked: false };
}

/** Test-only: forces the plan-block memo for one Apollo path without a real 403, so route tests
 * can exercise the 409 gate without mocking fetch. Not used by app code. */
export function __setPlanBlockedForTests(path: string, untilEpochMs: number, detail = "test-forced plan block"): void {
  planBlockedUntil.set(path, untilEpochMs);
  planBlockedDetail.set(path, detail);
}

/** Test-only: clears the plan-block memo entirely (all paths). Call in afterEach/afterAll so a
 * forced block from one test doesn't leak into the next. */
export function __resetPlanBlockedForTests(): void {
  clearPlanBlockMemo();
}

/** Process-wide memo for creditUsage(), separate from the plan-block memo above: a successful
 * fetch is cached for ENRICH_CONFIG.creditUsageTtlMs so Settings/route polling doesn't re-hit
 * Apollo on every request; a failure is never memoized (see creditUsage()'s doc comment). */
let creditUsageMemo: ApolloCreditUsage | null = null;

/** Test-only: clears the creditUsage() memo. Call in beforeEach/afterEach alongside
 * __resetPlanBlockedForTests so a memoized balance from one test doesn't leak into the next. */
export function __resetCreditUsageForTests(): void {
  creditUsageMemo = null;
}

type ApolloErrorBody = {
  error?: string;
  error_code?: string;
  error_details?: { code?: string; message?: string };
};

/** Apollo's Free/Basic-trial plans return 403 for People Search/Enrichment even with a valid key
 * — distinct from a real auth/permissions 403. Two shapes have been observed in the wild:
 *   - `error_code: "API_INACCESSIBLE"` with an `error` string containing "not included in your"
 *     (the plan simply lacks the endpoint), and
 *   - `error_details.code: "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED"` with
 *     `error_details.message` matching /not permitted to call this endpoint/i (seen on some
 *     accounts whose team isn't permitted to call the endpoint at all, even with a master key).
 * Reads the body once to tell a plan block apart from a genuine 403, memoizes the block so this
 * process stops hitting the endpoint for a while, and always throws (never returns) once
 * classified as a plan block. `detail` prefers `error_code`, falling back to `error_details.code`,
 * then the literal "API_INACCESSIBLE" — kept for diagnosis in the activity log, never the
 * human-facing message, which lives on ProviderPlanError itself. */
async function throwFor403(path: string, res: Response): Promise<never> {
  let body: ApolloErrorBody | null = null;
  try {
    body = (await res.json()) as ApolloErrorBody;
  } catch {
    // Non-JSON body: fall through to the generic 403 below.
  }
  const errorText = body?.error ?? "";
  const detailsCode = body?.error_details?.code ?? "";
  const detailsMessage = body?.error_details?.message ?? "";
  const isPlanBlocked =
    body?.error_code === "API_INACCESSIBLE" ||
    /not included in your/i.test(errorText) ||
    detailsCode === "AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED" ||
    /not permitted to call this endpoint/i.test(detailsMessage);
  if (isPlanBlocked) {
    const detail = body?.error_code || detailsCode || "API_INACCESSIBLE";
    await markPlanBlocked(path, detail);
    throw new ProviderPlanError("apollo", path, detail);
  }
  throw new Error(`Apollo ${path} HTTP 403`);
}

type SearchPerson = { id: string; first_name?: string | null; last_name_obfuscated?: string | null; title?: string | null; has_email?: boolean | null; organization?: { name?: string | null } | null };
type MatchPerson = { id: string; first_name?: string | null; last_name?: string | null; name?: string | null; title?: string | null; email?: string | null; email_status?: string | null; linkedin_url?: string | null; match_confidence?: string | null; organization?: { name?: string | null } | null };

async function requireKey() {
  const key = await getProviderKey("apollo");
  if (!key) throw new ProviderNotConfiguredError("apollo");
  return key;
}

function titleRank(title: string | null | undefined, titles: readonly string[]): number {
  const t = (title ?? "").toLowerCase();
  const i = titles.findIndex((p) => t.includes(p));
  return i === -1 ? titles.length : i;
}

/** Best match first: preferred-title rank ascending, then a verified/available email ahead of
 * none, for ties. Extracted from searchPeople (Plan 9 Task 2) so the cascade's per-scope mapping
 * step can call it once per attempt without duplicating the sort. */
function rank(people: EnrichPerson[], titles: readonly string[]): EnrichPerson[] {
  return [...people].sort((a, b) => titleRank(a.title, titles) - titleRank(b.title, titles) || Number(b.hasEmail) - Number(a.hasEmail));
}

function qs(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) u.append(`${k}[]`, item);
    else u.set(k, String(v));
  }
  return u.toString();
}

async function post<T>(key: string, path: string, params: Record<string, string | number | boolean | string[] | undefined>): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${BASE}${path}?${qs(params)}`, {
    method: "POST",
    headers: { accept: "application/json", "x-api-key": key },
  });
  if (res.status === 422) return { status: 422, data: null };
  if (res.status === 403) await throwFor403(path, res);
  if (!res.ok) throw new Error(`Apollo ${path} HTTP ${res.status}`);
  return { status: res.status, data: (await res.json()) as T };
}

type OrgSearchResponse = { organizations?: { id: string; name?: string | null; primary_domain?: string | null }[] };

/**
 * normalizeName already strips "&" (a non-alphanumeric char) but leaves the word "and" alone,
 * so "Bella Nails & Spa" and "Bella Nails and Spa" normalize to different strings. Fold both
 * tokens out here so the two spellings compare equal.
 */
function normalizeForOrgCompare(name: string): string {
  return normalizeName(name)
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guards against Apollo's org search returning a plausible-looking but different organization
 * (e.g. request "Joe's" matching org "Joe's Crab Shack" on naive substring containment). Accept
 * only an exact match, or a containment where the shorter side has at least two words — a
 * single-word request must match exactly.
 */
export function orgNameMatches(requestedRaw: string, foundRaw: string): boolean {
  // Normalize here (idempotent) so every caller can pass raw names: legal suffixes, punctuation
  // and "&"/"and" differences ("Bella Nails & Spa" vs "Bella Nails and Spa") must not count.
  const requested = normalizeForOrgCompare(requestedRaw);
  const found = normalizeForOrgCompare(foundRaw);
  if (!requested || !found) return false;
  if (requested === found) return true;
  const [shorter, longer] = requested.length <= found.length ? [requested, found] : [found, requested];
  const shorterWordCount = shorter.split(" ").filter(Boolean).length;
  return shorterWordCount >= 2 && longer.includes(shorter);
}

export class ApolloEnrichmentProvider implements EnrichmentProvider {
  async searchOrganization(name: string, city: string | null): Promise<{ id: string; primaryDomain: string | null } | null> {
    await checkPlanBlocked(ORG_SEARCH_PATH);
    const key = await requireKey();
    const r = await withBudget("apollo", () =>
      post<OrgSearchResponse>(key, ORG_SEARCH_PATH, {
        q_organization_name: name,
        organization_locations: city ? [city] : undefined,
        per_page: 1,
        page: 1,
      }),
    );
    const org = r.data?.organizations?.[0];
    if (!org) return null;
    // orgNameMatches normalizes its own inputs (see its doc comment) — pass the raw names.
    if (!orgNameMatches(name, org.name ?? "")) return null;
    return { id: org.id, primaryDomain: org.primary_domain ?? null };
  }

  /**
   * Unlocated-first location cascade (Plan 9 Task 2, restructured in the fix round after live
   * testing): the first call is always unfiltered by location (`scope: "any"`), a full page
   * (searchPageSize). Its `total_entries` is `totalAtDomain` — a free national headcount that
   * both short-circuits the common case and feeds the Task 3 chain guard. When
   * `totalAtDomain <= searchPageSize`, every person at the org is already in that one page (a
   * single-location SMB), so this returns immediately: one call, no cascade. Otherwise (a
   * multi-location org, or a franchise brand whose head office would otherwise win) it cascades
   * city → metro → state, stopping at the first scope with any candidates, so a franchise-brand
   * domain (e.g. kidsrkids.com) surfaces the local owner/director instead of the head office.
   * When every located scope comes back empty, falls back to the already-fetched unlocated page.
   * `totalAtDomain` is carried through every returned result unchanged once known; it is null only
   * when no usable total could be determined at all (no org match on the fallback branch, or a
   * non-200/422 on the very first call — in which case there is no cascade either, since a total
   * this function can't trust isn't a total it can compare against searchPageSize).
   *
   * Each attempt is one `withBudget("apollo", …)` call (People Search itself costs no Apollo
   * credits, only counts toward the app's own daily call budget), so the cascade costs at most 4
   * budget units (any + city + metro + state). `person_locations[]` takes natural place names
   * ("Pearland, Texas", "Texas, United States"), verified live 2026-09-17 — see stateNameFor; the
   * metro scope passes `q.metro` verbatim (an operator-typed Settings value, e.g. "Houston,
   * Texas"). When `q.city` is set but `q.state` isn't, the city scope is skipped: a bare city name
   * is ambiguous (there are many Pearlands) without a state to disambiguate it.
   *
   * `max` is accepted for interface stability (a future/other provider may use it to bound its
   * own request page size) but unused here: each attempt always fetches a full page
   * (searchPageSize) and ranks locally — the caller (runEnrich) is the one that slices to `max`
   * once it starts spending on paid reveals, so it can also report how many total candidates were
   * found, not just how many it acted on.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for EnrichmentProvider API stability, see comment above
  async searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult> {
    await checkPlanBlocked(PEOPLE_SEARCH_PATH);
    const key = await requireKey();
    // Per-owner targeting filters, defaulting to the code constants (see PeopleSearchQuery.titles).
    // `titles` is reused for the local ranking below so the sort order always matches the filter
    // that produced the page.
    const titles = q.titles ?? [...ENRICH_CONFIG.preferredTitles];
    const seniorities = q.seniorities ?? [...ENRICH_CONFIG.seniorities];
    const base: Record<string, string | number | boolean | string[] | undefined> = {
      person_titles: [...titles],
      include_similar_titles: true,
      person_seniorities: [...seniorities],
      per_page: ENRICH_CONFIG.searchPageSize,
      page: 1,
    };
    let filter: Record<string, string | number | boolean | string[] | undefined>;
    // resolvedDomain/orgSearchCredits (whole-branch review H1): set once, before fetchScope is
    // defined below, so every PeopleSearchResult this call returns — including the early
    // no-org-match return right here — carries the same values. searchOrganization makes exactly
    // one billed API call when it runs at all (per_page: 1), so orgSearchCredits is 0 or 1, never
    // more, for a single searchPeople invocation.
    let resolvedDomain: string | null = null;
    let orgSearchCredits = 0;
    if (q.domain) {
      filter = { q_organization_domains_list: [q.domain] };
    } else {
      const org = await this.searchOrganization(q.orgName, q.city);
      orgSearchCredits = 1; // the call above was made (and billed) regardless of whether it matched
      if (!org) return { people: [], totalFound: 0, totalAtDomain: null, scope: "any", resolvedDomain, orgSearchCredits };
      resolvedDomain = org.primaryDomain;
      filter = org.primaryDomain ? { q_organization_domains_list: [org.primaryDomain] } : { organization_ids: [org.id] };
    }

    // `knownTotalAtDomain` is null only for the very first (unlocated) call, which is the one
    // that establishes it; every later cascade call already knows it (carried through from that
    // first call) and just reports it back unchanged on its own result.
    const fetchScope = async (scope: PeopleSearchScope, loc: string | null, knownTotalAtDomain: number | null): Promise<PeopleSearchResult> => {
      const r = await withBudget("apollo", () =>
        post<{ people?: SearchPerson[]; total_entries?: number }>(key, PEOPLE_SEARCH_PATH, {
          ...base,
          ...filter,
          ...(loc ? { person_locations: [loc] } : {}),
        }),
      );
      const people = rank((r.data?.people ?? []).map<EnrichPerson>((p) => ({
        apolloId: p.id,
        firstName: p.first_name ?? null,
        lastName: null, // search results obfuscate last names
        name: p.first_name ?? null,
        title: p.title ?? null,
        email: null,
        emailStatus: null,
        linkedinUrl: null,
        hasEmail: !!p.has_email,
        orgName: p.organization?.name ?? null,
      })), titles);
      const totalEntries = r.data?.total_entries;
      return {
        people,
        totalFound: totalEntries ?? people.length,
        totalAtDomain: knownTotalAtDomain ?? totalEntries ?? null,
        scope,
        resolvedDomain,
        orgSearchCredits,
      };
    };

    const any = await fetchScope("any", null, null);
    if (any.totalAtDomain !== null && any.totalAtDomain <= ENRICH_CONFIG.searchPageSize) return any; // single-location SMB: everyone's already in hand
    if (any.totalAtDomain === null) return any; // 422/non-200 on the first call: no total to cascade against

    const stateName = stateNameFor(q.state);
    const scopes: { scope: PeopleSearchScope; loc: string }[] = [];
    if (q.city && stateName) scopes.push({ scope: "city", loc: `${q.city}, ${stateName}` });
    // Skip the metro scope when it is the lead's own city (a Houston lead with metro "Houston,
    // Texas" would otherwise repeat the identical, already-empty query and waste a budget unit).
    if (q.metro && !scopes.some((s) => s.loc.toLowerCase() === q.metro!.trim().toLowerCase())) scopes.push({ scope: "metro", loc: q.metro });
    if (stateName) scopes.push({ scope: "state", loc: `${stateName}, United States` });

    for (const s of scopes) {
      const r = await fetchScope(s.scope, s.loc, any.totalAtDomain);
      if (r.people.length > 0) return r;
    }
    return any;
  }

  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    await checkPlanBlocked(PEOPLE_MATCH_PATH);
    const key = await requireKey();
    const url = new URL(`${BASE}${PEOPLE_MATCH_PATH}`);
    url.searchParams.set("id", apolloId);
    url.searchParams.set("reveal_personal_emails", "false");
    url.searchParams.set("reveal_phone_number", "false");
    const data = await withBudget("apollo", async () => {
      const res = await fetch(url.href, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
      if (res.status === 403) await throwFor403(PEOPLE_MATCH_PATH, res);
      if (!res.ok) throw new Error(`Apollo match HTTP ${res.status}`);
      return (await res.json()) as { person?: MatchPerson | null };
    });
    const p = data.person;
    if (!p || p.match_confidence === "none") return null;
    return {
      apolloId: p.id,
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      name: p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null),
      title: p.title ?? null,
      email: p.email ?? null,
      emailStatus: p.email_status ?? null,
      linkedinUrl: p.linkedin_url ?? null,
      hasEmail: !!p.email,
      orgName: p.organization?.name ?? null,
    };
  }

  /** Live account balance and current billing cycle from usage_stats/credit_usage_stats. Not
   * wrapped in withBudget(): it is a status read (costs no Apollo credits and isn't gated by the
   * app's own daily-call budget), not a data call. Not gated by checkPlanBlocked() either — a
   * plan block on People Search/Enrichment says nothing about whether this status endpoint is
   * reachable, so a fresh call is always attempted (subject to its own TTL memo below). Never
   * throws: every failure path (no key, non-2xx, network error, unexpected body shape) resolves
   * to null so Settings can render "balance unavailable" instead of an error boundary. */
  async creditUsage(): Promise<ApolloCreditUsage | null> {
    if (creditUsageMemo && Date.now() - creditUsageMemo.fetchedAt.getTime() < ENRICH_CONFIG.creditUsageTtlMs) {
      return creditUsageMemo;
    }
    const key = await getProviderKey("apollo");
    if (!key) return null;
    try {
      const res = await fetch(`${BASE}${CREDIT_USAGE_PATH}`, {
        method: "POST",
        headers: { accept: "application/json", "x-api-key": key },
        // M1 (whole-branch review): this now runs on user-facing routes (Settings, credits,
        // both enrich routes' assertCredits) and runEnrich, not just a background poll — a
        // hanging Apollo response used to be able to hang all of them. The catch below already
        // maps any failure (including an abort) to null.
        signal: AbortSignal.timeout(ENRICH_CONFIG.creditUsageTimeoutMs),
      });
      if (!res.ok) {
        await discardBody(res);
        return null;
      }
      const body = (await res.json()) as {
        credit_usage_stats?: { lead_credit?: { limit?: number; consumed?: number; left_over?: number } };
        current_credit_cycle?: { start_date?: string; end_date?: string };
      };
      const lc = body.credit_usage_stats?.lead_credit;
      const cy = body.current_credit_cycle;
      if (!lc || !cy?.start_date || !cy.end_date) return null;
      creditUsageMemo = {
        limit: lc.limit ?? 0,
        consumed: lc.consumed ?? 0,
        leftOver: lc.left_over ?? 0,
        cycleStart: new Date(cy.start_date),
        cycleEnd: new Date(cy.end_date),
        fetchedAt: new Date(),
      };
      return creditUsageMemo;
    } catch (e) {
      console.error("[apollo] credit usage unavailable", (e as Error).message);
      return null;
    }
  }
}
