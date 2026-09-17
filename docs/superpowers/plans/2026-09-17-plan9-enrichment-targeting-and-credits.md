# Plan 9: Enrichment Targeting and Live Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spend Apollo credits on the right person (local decision-makers, never a chain's head office), show the real Apollo credit balance in Settings, and close the last flaky test.

**Architecture:** Apollo People Search costs no credits, so it becomes the workhorse: an unlocated-first call establishes the org's national headcount and short-circuits for a single-location SMB, then a location cascade (city → metro → state) finds the local owner for multi-location/franchise-brand domains; the same search's `total_entries` is also a free headcount signal that flags national chains before a credit is spent. Credit accounting keeps the app's own per-cycle cap (what this app has spent) and adds Apollo's live balance and cycle dates from `usage_stats/credit_usage_stats`. `searchPeople` grows from a bare array to a result object carrying `totalFound`, `totalAtDomain`, and the `scope` that matched, which both new features consume.

**Tech Stack:** Next.js 15.5 (App Router), React 19, Prisma 6.19 / Postgres 16, pg-boss 12, zod 4, Vitest 5, shadcn Base UI. Node 22.22.3 via nvm.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` (sections 5.2 enrichment, 4.3 SMB exclusion). Live findings driving this plan are in `.superpowers/sdd/2026-09-17-plan8-lead-detail/progress.md` (Apollo capability re-check, location probe, chain misses).

## Global Constraints

- Node `22.22.3` (`.nvmrc`, `engines`), Next `15.5.x` (not 16), Prisma `6.x` (not 7), pg-boss `12.x`.
- Providers are all-or-nothing by `PROVIDER_MODE` (`fake` | `real`); every new provider call needs a fake counterpart; DB tests pin `PROVIDER_MODE=fake` (`tests/db/setup.ts`).
- Apollo keys travel only in the `x-api-key` header via `getProviderKey`; never in URLs, logs, activity rows, or API responses. Credited calls go through `withBudget("apollo", …)`.
- No region literals outside `src/lib/config/region.ts`; never hard-code Texas or Houston. The US state table added here is a generic abbreviation→name map, not a region assumption.
- `"local-user"` literal only in `src/lib/actor.ts`. Base UI: no `asChild`; `nativeButton={false}` on `Button` rendered as a link; `Select` needs `items`; `onValueChange` may pass `null`.
- Sentence case in UI copy. Activity messages are plain sentences with a fixed prefix (`Enriched via Apollo:`, `Enrichment skipped:`, …) because `src/lib/leads/enrichActivity.ts` matches on them.
- Run `npm run test:db` from one process at a time (shared `sdr_test`).
- Commit per task; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/providers/apollo.ts` | Apollo HTTP contract: people search (now a result object + location cascade), reveal, org search, plan-block memo, **new** `creditUsage()` |
| `src/lib/providers/types.ts` | `EnrichmentProvider` interface; **new** `PeopleSearchResult`, `PeopleSearchQuery`, `ApolloCreditUsage` |
| `src/lib/providers/fake.ts` | Fake counterparts (deterministic `totalFound`, `scope`, credit usage) |
| `src/lib/geo/usStates.ts` (**new**) | `US_STATE_NAMES` abbreviation→name map, `stateNameFor(abbr)` |
| `src/lib/jobs/enrich.ts` | `runEnrich`: consumes the result object, headcount chain signal, `regionFromAddress` |
| `src/lib/enrichment/credits.ts` | `creditStatus` merges app-derived usage with live Apollo balance |
| `src/lib/config/enrichment.ts` | `monthlyCreditCapMax`, `chainHeadcountMin`, `creditUsageTtlMs` |
| `src/lib/config/runtime.ts` | zod ceiling for the cap |
| `src/lib/config/exclusion.ts` | seed chain additions |
| `src/lib/jobs/rescore.ts` (**new**) | `rescoreExclusions(ownerId)`: re-apply `scoreSmbFit` to every business after the chain list changes |
| `src/app/api/enrichment/credits/route.ts` | returns the merged status |
| `src/app/api/businesses/[id]/route.ts` | PATCH gains `markAsChain` |
| `src/components/settings/ProviderKeysCard.tsx`, `EnrichmentCard.tsx`, `types.ts` | live balance display, cap ceiling, optional renewal date |
| `src/components/leads/LeadDetail.tsx` | "Not an SMB (chain)" action |
| `scripts/chain-sweep.ts` (**new**) | dry-run/apply sweep over businesses with a domain using the headcount signal |
| `tests/db/businessEnrichRoute.test.ts` | fixture-leak fix |

---

### Task 1: Live Apollo credit balance in Settings, higher cap ceiling

**Files:**
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/apollo.ts`, `src/lib/providers/fake.ts`
- Modify: `src/lib/enrichment/credits.ts`, `src/app/api/enrichment/credits/route.ts`
- Modify: `src/lib/config/enrichment.ts`, `src/lib/config/runtime.ts:44-58`
- Modify: `src/components/settings/types.ts`, `src/components/settings/ProviderKeysCard.tsx:81-84`, `src/components/settings/EnrichmentCard.tsx`
- Test: `tests/unit/providers/apollo.test.ts`, `tests/unit/enrichment/credits.test.ts` (create if absent; `tests/unit/enrichment/` may exist), `tests/db/businessEnrichRoute.test.ts`, `tests/unit/config/runtime.test.ts` (or wherever `overridesSchema` is tested)

**Interfaces:**
- Consumes: `getProviderKey("apollo")`, `creditCycleStart`, `creditsUsed` (existing).
- Produces:
  ```ts
  // src/lib/providers/types.ts
  export type ApolloCreditUsage = {
    limit: number;      // lead_credit.limit
    consumed: number;   // lead_credit.consumed
    leftOver: number;   // lead_credit.left_over
    cycleStart: Date;   // current_credit_cycle.start_date
    cycleEnd: Date;     // current_credit_cycle.end_date
    fetchedAt: Date;
  };
  export interface EnrichmentProvider {
    // …existing…
    /** Live account balance (0 credits). Null when unavailable (no key, non-200, network error). Memoized per process for ENRICH_CONFIG.creditUsageTtlMs. */
    creditUsage(): Promise<ApolloCreditUsage | null>;
  }
  // src/lib/enrichment/credits.ts
  export type CreditStatus = {
    used: number; cap: number; remaining: number; cycleStart: Date; cycleRenewsOn: string | null;
    apollo: { limit: number; consumed: number; leftOver: number; cycleEnd: string } | null; // ISO date
  };
  ```
- `ENRICH_CONFIG` gains `monthlyCreditCapMax: 5000` and `creditUsageTtlMs: 5 * 60_000`.

- [x] **Step 1: Failing tests**

`tests/unit/providers/apollo.test.ts` — add:
```ts
describe("creditUsage", () => {
  it("maps lead_credit and the cycle dates; memoizes for the TTL", async () => {
    const body = { credit_usage_stats: { lead_credit: { limit: 2510, consumed: 2, left_over: 2508 } }, current_credit_cycle: { start_date: "2026-09-17T04:58:17.000+00:00", end_date: "2026-10-17T04:58:17.000+00:00" } };
    const fetchMock = vi.fn(async () => json(body, 200));
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApolloEnrichmentProvider();
    const u1 = await p.creditUsage();
    expect(u1).toMatchObject({ limit: 2510, consumed: 2, leftOver: 2508 });
    expect(u1!.cycleEnd.toISOString()).toBe("2026-10-17T04:58:17.000Z");
    await p.creditUsage();
    expect(fetchMock).toHaveBeenCalledTimes(1); // memoized
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.apollo.io/api/v1/usage_stats/credit_usage_stats");
    expect(init.method).toBe("POST");
    expect(url).not.toContain("api_key");
  });
  it("returns null on a non-200 and on a network error, and does not memoize failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: "forbidden" }, 403))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json(body, 200));
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApolloEnrichmentProvider();
    expect(await p.creditUsage()).toBeNull();
    expect(await p.creditUsage()).toBeNull();
    expect(await p.creditUsage()).toMatchObject({ leftOver: 2508 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("returns null without a key and makes no request", async () => {
    vi.mocked(getProviderKey).mockResolvedValueOnce(null); // the file already mocks @/lib/providers/keys
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await new ApolloEnrichmentProvider().creditUsage()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```
`tests/unit/enrichment/credits.test.ts` (exists) — add:
```ts
describe("creditStatus with a live Apollo balance", () => {
  const cfg = (cap: number, cycleRenewsOn: string | null) => ({ enrichment: { maxPeople: 1, monthlyCreditCap: cap, cycleRenewsOn } }) as unknown as RuntimeConfig;
  const provider = (usage: ApolloCreditUsage | null) => ({ creditUsage: async () => usage }) as unknown as EnrichmentProvider;
  const live: ApolloCreditUsage = { limit: 2510, consumed: 2, leftOver: 5, cycleStart: new Date("2026-09-17T04:58:17Z"), cycleEnd: new Date("2026-10-17T04:58:17Z"), fetchedAt: new Date() };
  const at = new Date("2026-09-20T12:00:00Z");
  // creditsUsed hits Prisma; creditStatus takes a 5th `deps` param `{ creditsUsed }` defaulting to the real one.
  const deps = { creditsUsed: async () => 2 };

  it("remaining is the smaller of the app cap and Apollo's balance", async () => {
    const s = await creditStatus("o", cfg(500, "2026-10-16"), at, provider(live), deps);
    expect(s).toMatchObject({ used: 2, cap: 500, remaining: 5, apollo: { limit: 2510, consumed: 2, leftOver: 5, cycleEnd: "2026-10-16" } });
  });
  it("falls back to the app cap alone when Apollo is unavailable", async () => {
    const s = await creditStatus("o", cfg(500, "2026-10-16"), at, provider(null), deps);
    expect(s).toMatchObject({ remaining: 498, apollo: null });
  });
  it("derives the renewal day from Apollo's cycle end (local date) when Settings leaves it blank", async () => {
    const s = await creditStatus("o", cfg(500, null), at, provider(live), deps);
    expect(s.cycleRenewsOn).toBe("2026-10-16"); // 04:58Z on the 17th is 11:58 PM on the 16th in REGION.timezone
    expect(s.cycleStart.toISOString()).toBe(creditCycleStart(at, "2026-10-16", REGION.timezone).toISOString());
  });
});
```
`tests/unit/config/runtime.test.ts` (exists) — `monthlyCreditCap: 5000` accepted, `5001` rejected by `overridesSchema`.
`tests/db/businessEnrichRoute.test.ts` "credits for a fresh owner" — add `apollo: null` to the expected object (fake mode returns null unless the fake is primed; see Step 3).

- [x] **Step 2: Run them, expect failures** — `npm test -- apollo credits runtime`.

- [x] **Step 3: Implement**

`src/lib/config/enrichment.ts`: add `monthlyCreditCapMax: 5000`, `creditUsageTtlMs: 5 * 60_000`; update the doc comment (the user is on a paid plan with 2,500 credits; the default cap stays 80 until the user raises it).

`src/lib/config/runtime.ts`: `monthlyCreditCap: z.number().int().min(0).max(ENRICH_CONFIG.monthlyCreditCapMax)`.

`src/lib/providers/apollo.ts`:
```ts
const CREDIT_USAGE_PATH = "/api/v1/usage_stats/credit_usage_stats";
let creditUsageMemo: ApolloCreditUsage | null = null;
export function __resetCreditUsageForTests() { creditUsageMemo = null; }

async creditUsage(): Promise<ApolloCreditUsage | null> {
  if (creditUsageMemo && Date.now() - creditUsageMemo.fetchedAt.getTime() < ENRICH_CONFIG.creditUsageTtlMs) return creditUsageMemo;
  const key = await getProviderKey("apollo");
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}${CREDIT_USAGE_PATH}`, { method: "POST", headers: { accept: "application/json", "x-api-key": key } });
    if (!res.ok) { await discardBody(res); return null; }
    const body = (await res.json()) as { credit_usage_stats?: { lead_credit?: { limit?: number; consumed?: number; left_over?: number } }; current_credit_cycle?: { start_date?: string; end_date?: string } };
    const lc = body.credit_usage_stats?.lead_credit; const cy = body.current_credit_cycle;
    if (!lc || !cy?.start_date || !cy.end_date) return null;
    creditUsageMemo = { limit: lc.limit ?? 0, consumed: lc.consumed ?? 0, leftOver: lc.left_over ?? 0, cycleStart: new Date(cy.start_date), cycleEnd: new Date(cy.end_date), fetchedAt: new Date() };
    return creditUsageMemo;
  } catch (e) { console.error("[apollo] credit usage unavailable", (e as Error).message); return null; }
}
```
(Use the module's existing `BASE` constant and `discardBody` helper if present; otherwise `await res.text()`.) Not wrapped in `withBudget`: it is a status read, not a data call.

`src/lib/providers/fake.ts`: `creditUsage()` returns `this.fakeCreditUsage` (default `null`); tests set `fake.fakeCreditUsage = {...}`.

`src/lib/enrichment/credits.ts`:
```ts
export async function creditStatus(
  ownerId: string, cfg: RuntimeConfig, now = new Date(),
  provider: EnrichmentProvider = getProviders().enrichment,
  deps: { creditsUsed: typeof creditsUsed } = { creditsUsed },
): Promise<CreditStatus> {
  const live = await provider.creditUsage();
  const cycleRenewsOn = cfg.enrichment.cycleRenewsOn ?? (live ? localDateString(live.cycleEnd, REGION.timezone) : null);
  const cycleStart = creditCycleStart(now, cycleRenewsOn, REGION.timezone);
  const used = await deps.creditsUsed(ownerId, cycleStart);
  const cap = cfg.enrichment.monthlyCreditCap;
  const remaining = Math.max(0, Math.min(cap - used, live ? live.leftOver : Number.POSITIVE_INFINITY));
  return { used, cap, remaining, cycleStart, cycleRenewsOn, apollo: live ? { limit: live.limit, consumed: live.consumed, leftOver: live.leftOver, cycleEnd: localDateString(live.cycleEnd, REGION.timezone) } : null };
}
```
`localDateString(d, tz)` reuses `localYmd` in the same file → `YYYY-MM-DD`. Note: Apollo's `end_date` `2026-10-17T04:58:17Z` is Oct 16 11:58 PM in America/Chicago, which is the date the Apollo UI shows; the local-date conversion is what makes them agree.

Route: unchanged shape plus `apollo`. `assertCredits` in both enrich routes already uses `remaining`, so a zero live balance now blocks with the existing 409 message; change that message to `Apollo account is out of credits (Apollo reports 0 left)` only when `apollo.leftOver <= 0` is the binding constraint; otherwise keep the app-cap wording.

UI: `ProviderKeysCard.tsx:81-84` becomes two lines when `credits.apollo` exists: `Apollo account: 2,508 of 2,510 credits left · renews Oct 16` and `This app: 2 of 500 this cycle`; otherwise the existing single line. `EnrichmentCard.tsx`: cap input `max={ENRICH_CONFIG.monthlyCreditCapMax}` (import the constant); renewal date label gets helper text `Leave blank to use Apollo's cycle (renews <date>)` with the live date from `credits?.apollo?.cycleEnd` passed down from `SettingsView` (a `placeholder` on a date input never renders). `src/components/settings/types.ts` `CreditStatus` gains `apollo`.

- [x] **Step 4: Run** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` — all exit 0.
- [x] **Step 5: Commit** `feat(credits): live Apollo balance and cycle in Settings; cap ceiling 5000; remaining = min(app cap, Apollo balance)`.

---

### Task 2: Local-first People Search (`person_locations[]` cascade) and a search result object

**Files:**
- Create: `src/lib/geo/usStates.ts`
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/apollo.ts` (`searchPeople`), `src/lib/providers/fake.ts`
- Modify: `src/lib/jobs/enrich.ts` (`regionFromAddress`, consume the result object, mention the scope in the message)
- Test: `tests/unit/geo/usStates.test.ts`, `tests/unit/providers/apollo.test.ts`, `tests/unit/jobs/enrichHelpers.test.ts`, `tests/db/enrich.test.ts`, `tests/db/enrichCredits.test.ts` (its `super.searchPeople` subclass)

**Why:** verified 2026-09-17 with zero-credit probes: `person_locations[]` takes `"City, State"` with the full state name. `kidsrkids.com`: 139 people nationally, 0 in "Pearland, Texas", 20 in "Houston, Texas" (a local Preschool Director), 64 in "Texas, United States". `hrblock.com`: 6,579 nationally, 1 in Pearland (Assistant Manager). Without the filter, a franchise-brand domain returns the head office.

**Interfaces (as shipped — restructured in a fix round after live testing found the original city→state→any-first order wasteful for the common single-location SMB and short of a metro fallback; see the fix-round note below):**
- Produces:
  ```ts
  // metro = operator-typed Settings value (RuntimeConfig.enrichment.metroLocation), passed verbatim as person_locations[]
  export type PeopleSearchQuery = { domain: string | null; orgName: string; city: string | null; state: string | null; metro: string | null }; // state = 2-letter USPS code or null
  export type PeopleSearchScope = "city" | "metro" | "state" | "any";
  export type PeopleSearchResult = { people: EnrichPerson[]; totalFound: number; totalAtDomain: number | null; scope: PeopleSearchScope };
  searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult>;
  // src/lib/geo/usStates.ts
  export const US_STATE_NAMES: Readonly<Record<string, string>>; // "TX" → "Texas", all 50 + DC
  export function stateNameFor(abbr: string | null | undefined): string | null;
  // src/lib/jobs/enrich.ts
  export function regionFromAddress(addr: string | null): { city: string | null; state: string | null }; // supersedes cityFromAddress (keep it as a thin wrapper)
  ```
- `totalFound` = Apollo's `total_entries` for the scope that matched (or for the unlocated "any" page returned as the fallback when every located scope was empty).
- `totalAtDomain` = Apollo's `total_entries` for the *unlocated* first call specifically — the org's national headcount, independent of which scope ultimately matched; carried unchanged onto every later result. Null only when no usable total could be determined at all (org-fallback found no org — no call ever made — or the unlocated call itself returned a non-200/422). This is what Task 3's chain guard reads, **not** `totalFound`.

**Algorithm as shipped:** the first call is always unlocated (`scope: "any"`, full `searchPageSize` page) — that call's `total_entries` becomes `totalAtDomain`. If `totalAtDomain <= ENRICH_CONFIG.searchPageSize`, every person at the org is already in that one page (a single-location SMB): return immediately, one call total. If `totalAtDomain` is null (422/non-200 on that first call), also return immediately — there is no total worth cascading against. Otherwise cascade `city → metro → state` (each conditionally included: city only when both a city and a resolved state name exist, metro only when `q.metro` is configured, state only when a state resolves), stopping at the first scope with any candidates; if every located scope comes back empty, fall back to the already-fetched unlocated page (`scope: "any"`). Each attempt is one `withBudget("apollo", …)` call; the cascade costs at most 4 (any + city + metro + state) — up from the pre-fix-round cascade's 3, but the common case (a single-location SMB) now costs exactly 1 instead of up to 3.

- [x] **Step 1: Failing tests**

`tests/unit/geo/usStates.test.ts`: `stateNameFor("TX") === "Texas"`, `("tx")` same, `("XX")` null, `(null)` null; the map has 51 entries.

`tests/unit/jobs/enrichHelpers.test.ts`: `regionFromAddress("1820 Pearland Pkwy, Pearland, TX 77581, USA")` → `{ city: "Pearland", state: "TX" }`; without the country suffix; `("Somewhere")` → `{ city: null, state: null }`; `cityFromAddress` still returns the city.

`tests/unit/providers/apollo.test.ts` (fix-round shape — see the algorithm above):
- small org: `total_entries: 3` on the unlocated call → exactly 1 fetch, `scope: "any"`, `totalAtDomain: 3`.
- large org: unlocated → 139, city → 0, metro → 20 (non-empty) → 3 fetches, `scope: "metro"`, `totalFound: 20`, `totalAtDomain: 139`; `person_locations[]` values are none, then `"Pearland, Texas"`, then the metro string verbatim.
- large org, every located scope empty → falls back to the unlocated page, `scope: "any"`, 4 fetches (any + city + metro + state).
- no metro configured → the metro call is skipped (3 fetches max: any + city + state).
- a 422 on the unlocated call → `{ people: [], totalFound: 0, totalAtDomain: null, scope: "any" }`, exactly 1 fetch (no cascade on an error); other HTTP errors still throw.
- org-search fallback branch (domain null) unchanged apart from the result object, and asserted for `scope`/`totalAtDomain` too (reviewer nit).
- People Search response fields are still mapped as before (`orgName`, `hasEmail`, ranking).

`tests/db/enrich.test.ts`: update every `fake.searchPeople = async () => [...]` to return `{ people, totalFound: people.length, totalAtDomain: people.length, scope: "any" }`; add one case where the fake returns `scope: "city"` and assert the success message ends with ` (matched in Pearland, TX)`.

- [x] **Step 2: Run, expect failures.**

- [x] **Step 3: Implement**

`src/lib/geo/usStates.ts`: the 50 states + DC as `{ AL: "Alabama", … , WY: "Wyoming", DC: "District of Columbia" }`; `stateNameFor` upper-cases and looks up.

`src/lib/jobs/enrich.ts`: `regionFromAddress` parses the `"City, ST 12345"` part the way `cityFromAddress` does and extracts the 2-letter code with `/^([A-Z]{2})\b/` from the state-zip segment; `cityFromAddress(addr)` = `regionFromAddress(addr).city`.

`src/lib/providers/apollo.ts` `searchPeople` (fix-round shape — unlocated first, short-circuit for small orgs, then city → metro → state):
```ts
async searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult> {
  await checkPlanBlocked(PEOPLE_SEARCH_PATH);
  const key = await requireKey();
  const base = { person_titles: [...ENRICH_CONFIG.preferredTitles], include_similar_titles: true, person_seniorities: [...ENRICH_CONFIG.seniorities], per_page: ENRICH_CONFIG.searchPageSize, page: 1 };
  let filter: Record<string, string | string[]>;
  if (q.domain) filter = { q_organization_domains_list: [q.domain] };
  else { const org = await this.searchOrganization(q.orgName, q.city); if (!org) return { people: [], totalFound: 0, totalAtDomain: null, scope: "any" }; filter = org.primaryDomain ? { q_organization_domains_list: [org.primaryDomain] } : { organization_ids: [org.id] }; }

  const fetchScope = async (scope: PeopleSearchScope, loc: string | null, knownTotalAtDomain: number | null): Promise<PeopleSearchResult> => {
    const r = await withBudget("apollo", () => post<{ people?: SearchPerson[]; total_entries?: number }>(key, PEOPLE_SEARCH_PATH, { ...base, ...filter, ...(loc ? { person_locations: [loc] } : {}) }));
    const people = rank((r.data?.people ?? []).map(toEnrichPerson));
    const totalEntries = r.data?.total_entries;
    return { people, totalFound: totalEntries ?? people.length, totalAtDomain: knownTotalAtDomain ?? totalEntries ?? null, scope };
  };

  const any = await fetchScope("any", null, null);
  if (any.totalAtDomain !== null && any.totalAtDomain <= ENRICH_CONFIG.searchPageSize) return any; // single-location SMB: everyone's already in hand
  if (any.totalAtDomain === null) return any; // 422/non-200 on the first call: no total to cascade against

  const stateName = stateNameFor(q.state);
  const scopes: { scope: PeopleSearchScope; loc: string }[] = [];
  if (q.city && stateName) scopes.push({ scope: "city", loc: `${q.city}, ${stateName}` });
  if (q.metro) scopes.push({ scope: "metro", loc: q.metro });
  if (stateName) scopes.push({ scope: "state", loc: `${stateName}, United States` });
  for (const s of scopes) {
    const r = await fetchScope(s.scope, s.loc, any.totalAtDomain);
    if (r.people.length > 0) return r;
  }
  return any;
}
```
`rank` is the existing titleRank/hasEmail sort extracted into a function.

`src/lib/providers/fake.ts`: returns `{ people: [...same two...], totalFound: people.length, totalAtDomain: people.length, scope: q.city && q.state ? "city" : "any" }`.

`src/lib/jobs/enrich.ts` `runEnrich`: `const { city, state } = regionFromAddress(b.formattedAddress); const metro = cfg.enrichment.metroLocation ?? null; const search = await …searchPeople({ domain, orgName: b.name, city, state, metro }, maxPeople); const people = search.people;`. Keep `found = people.length` and the Task 7 "checked" logic exactly as they are (they describe the page we examined). Append a scope suffix to the success and none-had-email messages only, each guarded by the value it names actually being present (so a mismatched/partial result can never render `(matched in null, null)`): ` (matched in ${city}, ${state})` when `search.scope === "city" && city && state`, ` (matched in ${metro})` when `search.scope === "metro" && metro`, ` (matched in ${stateNameFor(state)})` when `search.scope === "state" && state`, nothing when `"any"`. `search.totalFound`/`search.totalAtDomain` are consumed by Task 3, not by any message here — Task 3's headcount guard reads `search.totalAtDomain` specifically (the national count), not `totalFound` (which can be a narrower scoped count).

`src/lib/config/runtime.ts`: `RuntimeConfig.enrichment` gains `metroLocation: string | null`; `overridesSchema`'s `enrichment` object gains `metroLocation: z.string().trim().min(3).max(80).nullable().optional()`; `mergeConfig` defaults it to `null`. `src/components/settings/types.ts` `EnrichmentConfig` gains the same field. `EnrichmentCard.tsx` gets a text input "Metro area for enrichment" (not prefilled) with helper text "Used when nobody is found in the lead's own city, e.g. Houston, Texas"; its `renewalPlaceholder` prop is renamed `renewalHint` and the date is formatted the way `ProviderKeysCard` does ("renews Oct 16") rather than shown as a raw ISO date.

`tests/db/enrichCredits.test.ts`: its subclass overriding `searchPeople` must return the result object, and should import `PeopleSearchQuery`/`PeopleSearchResult` rather than re-declaring the query shape inline.

- [x] **Step 4: tsc, lint, unit, db exit 0.**
- [x] **Step 5: Commit** `feat(enrich): local-first People Search (city → state → anywhere) and a search result object with totalFound and scope` (Task 2's original commit); the fix round restructuring the cascade and adding the metro setting is a separate commit — `feat(enrich): unlocated search first (national headcount, single-call for small orgs), then city → metro → state; metro area setting`.

---

### Task 3: Chains never get a credit — headcount signal, sweep script, seed list, "Not an SMB" action

**Files:**
- Modify: `src/lib/config/enrichment.ts` (`chainHeadcountMin`), `src/lib/config/exclusion.ts` (seed chains)
- Create: `src/lib/jobs/rescore.ts`, `scripts/chain-sweep.ts`
- Modify: `src/lib/jobs/enrich.ts` (headcount guard), `src/app/api/businesses/[id]/route.ts` (PATCH `markAsChain`), `src/components/leads/LeadDetail.tsx` (action)
- Test: `tests/unit/scoring/smbFit.test.ts` (seed additions), `tests/db/rescore.test.ts` (new), `tests/db/enrich.test.ts`, `tests/db/businessPatchRoute.test.ts` (new — no db test covers the PATCH route today; mirror the request/context helpers in `tests/db/businessEnrichRoute.test.ts`)

**Why:** Zumiez, Pet Paradise and H&R Block escaped chain exclusion (name-list only). Apollo's `total_entries` for a domain is a free national headcount: 6,579 for hrblock.com. Franchise brands stay eligible (kidsrkids.com is 139; the local owner is a real SMB prospect), so the threshold is deliberately high.

**Interfaces:**
- `ENRICH_CONFIG.chainHeadcountMin = 1000` (people at the domain in Apollo, any location).
- `src/lib/jobs/rescore.ts`:
  ```ts
  export async function rescoreExclusions(ownerId: string, cfg?: RuntimeConfig): Promise<{ scanned: number; newlyExcluded: number; restored: number }>;
  ```
  Re-runs `scoreSmbFit({ name, sameNameCount }, cfg.exclusion, cfg.projects)` for every business of the owner (same `nameCounts` logic as `src/lib/jobs/zipSearch.ts:176`), updates `exclusion`/`exclusionReasons` only when they change, and writes an activity row `Excluded as chain: <reason>` / `Exclusion lifted` per changed business. Businesses whose current reasons include `apollo_headcount:` keep that reason (it is not name-derived) — merge, do not overwrite.
- `runEnrich`: after `searchPeople`, `if (domain && search.totalAtDomain !== null && search.totalAtDomain >= ENRICH_CONFIG.chainHeadcountMin)` → set `exclusion: "enterprise"`, add `chain:apollo_headcount:<n>` to `exclusionReasons`, log `Enrichment skipped: <n> people at <domain> in Apollo — not an SMB (marked as chain)`, return `{ added: 0, updated: 0, skipped: "chain" }`, no reveal, `lastEnrichedAt` untouched. Reads `search.totalAtDomain` (the org's *national* headcount from the cascade's unlocated first call — see Task 2), not `search.totalFound` (which can be a narrower scoped count, e.g. just the metro or city page): a franchise brand's local page can easily be small even though the brand nationally is not. `isEnrichIssueMessage` gains this skip (it explains an empty People list).
- PATCH `/api/businesses/:id` body gains `markAsChain: z.literal(true).optional()`: appends `normalizeName(name)` (from `src/lib/jobs/shared.ts`) to `overrides.exclusion.chains` (dedupe, lowercase, via `saveOverrides`), then `rescoreExclusions`; response `{ business, rescore: { newlyExcluded } }`.
- `scripts/chain-sweep.ts`: `node --env-file=.env --import=tsx scripts/chain-sweep.ts [--apply] [--limit N]` — for each non-excluded business with a domain (skip `SHARED_HOSTS`), one People Search with no location and `per_page: 1` through the provider (so `withBudget` and the plan-block memo apply), print `domain  total  → chain?`; with `--apply`, mark as in `runEnrich`. Prints a reminder that the Apollo daily budget in Settings bounds the sweep (raise it to ≥ the business count first) and stops cleanly on `BudgetExhaustedError`.

- [ ] **Step 1: Failing tests**

`tests/unit/scoring/smbFit.test.ts`: `"Zumiez"`, `"Pet Paradise Pearland"`, `"H&R Block"`, `"Jiffy Lube"`, `"GEICO Insurance Agent"` are excluded with a `chain:` reason; `"Snap Fitness Pearland"` and `"State Farm - Jane Smith"` are NOT (franchise/agent-owned SMBs).

`tests/db/rescore.test.ts`: create three businesses ("Zumiez", "Bella Nails", "Zumiez Outlet") with `exclusion: "none"`; `rescoreExclusions(OWNER, cfgWithChains(["zumiez"]))` → `{ scanned: 3, newlyExcluded: 2, restored: 0 }`, activity rows written for the two, Bella untouched; a second run → `newlyExcluded: 0`; a business with `exclusionReasons: ["chain:apollo_headcount:2000"]` stays excluded even when its name matches nothing.

`tests/db/enrich.test.ts`: fake returns `totalAtDomain: 6579` for a business with a domain → `skipped: "chain"`, `enrich` calls 0, exclusion `enterprise`, reason `chain:apollo_headcount:6579`, one activity row, `lastEnrichedAt` null; `totalAtDomain: 139` → proceeds normally.

`tests/db/businessPatchRoute.test.ts`: `markAsChain: true` on "Zumiez" → 200, `rescore.newlyExcluded ≥ 1`, `AppConfig.overrides.exclusion.chains` contains `"zumiez"`; a second call is idempotent (no duplicate entry).

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement** as specified. Seed additions to `DEFAULT_EXCLUSION_CONFIG.chains`: `"zumiez", "pet paradise", "h&r block", "jiffy lube", "geico", "petsmart", "petco", "great clips", "supercuts", "planet fitness", "la fitness", "24 hour fitness", "aspen dental", "banfield", "vca ", "chili's", "applebee", "olive garden", "ihop", "denny's", "waffle house", "panda express", "chipotle", "five guys", "raising cane", "popeyes", "kfc", "sonic drive", "jack in the box", "dairy queen", "autozone", "o'reilly auto", "advance auto", "discount tire", "firestone", "goodyear", "mattress firm", "ross dress", "tj maxx", "marshalls", "dollar general", "dollar tree", "family dollar", "office depot", "staples", "best buy", "verizon", "at&t", "t-mobile", "spectrum", "xfinity"` (the last two are the user's own employer's brands; they are never prospects). Keep `hasWord` semantics in mind: entries are whole-word substrings of the lowercase name.

`LeadDetail.tsx`: in the header block, when `b.exclusion === "none"`, a small ghost `Button` "Not an SMB (chain)" that calls PATCH with `{ markAsChain: true }`, toasts `Excluded <name> and N similar leads`, and refreshes; sentence case; fits the 375 px header stack (it joins the existing action row).

- [ ] **Step 4: tsc, lint, unit, db exit 0.** Then run the sweep dry-run against the dev DB with `--limit 50` and paste the top of its output in the task report (no `--apply`).
- [ ] **Step 5: Commit** `feat(exclusion): Apollo headcount marks national chains before a credit is spent; chain sweep script; seed chains; "Not an SMB" action with re-score`.

---

### Task 4: Close the order-dependent credits test

**Files:**
- Modify: `tests/db/businessEnrichRoute.test.ts:313-336`

**Why:** "GET /api/enrichment/credits returns the credit status for a fresh owner" failed once in a full `test:db` run with `used: 1`: an Apollo-sourced email contact for the shared `local-user` owner existed at that moment (Vitest orders files by cached duration, so which file runs first varies). The route's actor is always `local-user`, so the test cannot pick a private owner; it must clear what it counts.

- [x] **Step 1:** In that describe's `beforeEach`, after `cleanup()`, add `await prisma.contact.deleteMany({ where: { ownerId: OWNER, source: "apollo", type: "email" } });` with a comment naming the leak. Assert additionally that `creditsUsed(OWNER, new Date(0))` is 0 right before the request so a future leak fails with a clear message.
- [x] **Step 2:** (three consecutive full runs are done by the coordinator at the branch gate) Run `npm run test:db` three times in a row; all green.
- [x] **Step 3: Commit** `test(db): credits status test clears Apollo contacts for the shared owner (order-dependent fixture leak)`.

---

## Done criteria for Plan 9

- Settings shows the live Apollo balance and renewal date, and the app's own cap up to 5,000; enrichment stops when either the app cap or the Apollo balance is exhausted.
- Enriching a franchise-brand lead reveals a person in the lead's city or state when Apollo has one, and the activity row says so.
- A domain with ≥ 1,000 people in Apollo is excluded as a chain at enrichment time with no credit spent; the sweep script can do this for the whole table (dry run by default); the lead drawer has a "Not an SMB (chain)" action that also excludes look-alikes.
- `npm run test:db` passes three consecutive full runs.
- Live verification (coordinator, after the worker restarts on the branch): (1) Settings credit line matches the Apollo billing page; (2) `enqueueEnrich` on the Kids R Kids lead reveals a Houston-area person, not the CEO; (3) sweep dry run flags hrblock.com and zumiez.com.

## Follow-ups (not in this plan)

Bulk enrich progress in the UI; SSR the first Leads page; `person_locations[]` for the org-search fallback branch; undici `Parser.finish` assertion upstream; pg-boss pickup delay; Railway deploy end to end.
