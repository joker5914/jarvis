# Plan 9: Enrichment Targeting and Live Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spend Apollo credits on the right person (local decision-makers, never a chain's head office), show the real Apollo credit balance in Settings, and close the last flaky test.

**Architecture:** Apollo People Search costs no credits, so it becomes the workhorse: a location cascade (city → state → anywhere) finds the local owner for franchise-brand domains, and the same search's `total_entries` is a free headcount signal that flags national chains before a credit is spent. Credit accounting keeps the app's own per-cycle cap (what this app has spent) and adds Apollo's live balance and cycle dates from `usage_stats/credit_usage_stats`. `searchPeople` grows from a bare array to a result object carrying `totalFound` and the `scope` that matched, which both new features consume.

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
| `src/lib/providers/apollo.ts` | Apollo HTTP contract: people search (now a result object + location cascade), reveal, org search, plan-block memo, **new** `fetchApolloCreditUsage` |
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

- [ ] **Step 1: Failing tests**

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
  it("returns null on a non-200 and on a network error, and does not memoize failures", async () => { /* 403 → null; then throw → null; then 200 → object; 3 fetch calls */ });
  it("returns null without a key", async () => { /* getProviderKey mocked to null → no fetch */ });
});
```
`tests/unit/enrichment/credits.test.ts` — `creditStatus` unit test with a stubbed `creditsUsed` (2) and a stubbed provider returning `leftOver: 5`, cap 500 → `remaining` is `min(500-2, 5) = 5`; with provider `null` → `remaining 498`, `apollo null`; when `cycleRenewsOn` is null and live `cycleEnd` is `2026-10-17T04:58:17Z`, `cycleRenewsOn` in the result is the local calendar date of `cycleEnd` in `REGION.timezone` (`"2026-10-16"`), and `cycleStart` is computed from that day.
`tests/unit/config/runtime` — `monthlyCreditCap: 5000` accepted, `5001` rejected.
`tests/db/businessEnrichRoute.test.ts` "credits for a fresh owner" — add `apollo: null` to the expected object (fake mode returns null unless the fake is primed; see Step 3).

- [ ] **Step 2: Run them, expect failures** — `npm test -- apollo credits runtime`.

- [ ] **Step 3: Implement**

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
export async function creditStatus(ownerId: string, cfg: RuntimeConfig, now = new Date(), provider: EnrichmentProvider = getProviders().enrichment): Promise<CreditStatus> {
  const live = await provider.creditUsage();
  const cycleRenewsOn = cfg.enrichment.cycleRenewsOn ?? (live ? localDateString(live.cycleEnd, REGION.timezone) : null);
  const cycleStart = creditCycleStart(now, cycleRenewsOn, REGION.timezone);
  const used = await creditsUsed(ownerId, cycleStart);
  const cap = cfg.enrichment.monthlyCreditCap;
  const remaining = Math.max(0, Math.min(cap - used, live ? live.leftOver : Number.POSITIVE_INFINITY));
  return { used, cap, remaining, cycleStart, cycleRenewsOn, apollo: live ? { limit: live.limit, consumed: live.consumed, leftOver: live.leftOver, cycleEnd: localDateString(live.cycleEnd, REGION.timezone) } : null };
}
```
`localDateString(d, tz)` reuses `localYmd` in the same file → `YYYY-MM-DD`. Note: Apollo's `end_date` `2026-10-17T04:58:17Z` is Oct 16 11:58 PM in America/Chicago, which is the date the Apollo UI shows; the local-date conversion is what makes them agree.

Route: unchanged shape plus `apollo`. `assertCredits` in both enrich routes already uses `remaining`, so a zero live balance now blocks with the existing 409 message; change that message to `Apollo credits exhausted (${s.used}/${s.cap} this cycle; Apollo reports ${s.apollo?.leftOver ?? "?"} left)` when `apollo` is present.

UI: `ProviderKeysCard.tsx:81-84` becomes two lines when `credits.apollo` exists: `Apollo account: 2,508 of 2,510 credits left · renews Oct 16` and `This app: 2 of 500 this cycle`; otherwise the existing single line. `EnrichmentCard.tsx`: cap input `max={ENRICH_CONFIG.monthlyCreditCapMax}` (import the constant); renewal date label gets helper text `Leave blank to use Apollo's cycle` and shows the live date as placeholder when available (pass `credits?.apollo?.cycleEnd` down from `SettingsView`). `src/components/settings/types.ts` `CreditStatus` gains `apollo`.

- [ ] **Step 4: Run** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:db` — all exit 0.
- [ ] **Step 5: Commit** `feat(credits): live Apollo balance and cycle in Settings; cap ceiling 5000; remaining = min(app cap, Apollo balance)`.

---

### Task 2: Local-first People Search (`person_locations[]` cascade) and a search result object

**Files:**
- Create: `src/lib/geo/usStates.ts`
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/apollo.ts` (`searchPeople`), `src/lib/providers/fake.ts`
- Modify: `src/lib/jobs/enrich.ts` (`regionFromAddress`, consume the result object, mention the scope in the message)
- Test: `tests/unit/geo/usStates.test.ts`, `tests/unit/providers/apollo.test.ts`, `tests/unit/jobs/enrichHelpers.test.ts`, `tests/db/enrich.test.ts`, `tests/db/enrichCredits.test.ts` (its `super.searchPeople` subclass)

**Why:** verified 2026-09-17 with zero-credit probes: `person_locations[]` takes `"City, State"` with the full state name. `kidsrkids.com`: 139 people nationally, 0 in "Pearland, Texas", 20 in "Houston, Texas" (a local Preschool Director), 64 in "Texas, United States". `hrblock.com`: 6,579 nationally, 1 in Pearland (Assistant Manager). Without the filter, a franchise-brand domain returns the head office.

**Interfaces:**
- Produces:
  ```ts
  export type PeopleSearchQuery = { domain: string | null; orgName: string; city: string | null; state: string | null }; // state = 2-letter USPS code or null
  export type PeopleSearchScope = "city" | "state" | "any";
  export type PeopleSearchResult = { people: EnrichPerson[]; totalFound: number; scope: PeopleSearchScope };
  searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult>;
  // src/lib/geo/usStates.ts
  export const US_STATE_NAMES: Readonly<Record<string, string>>; // "TX" → "Texas", all 50 + DC
  export function stateNameFor(abbr: string | null | undefined): string | null;
  // src/lib/jobs/enrich.ts
  export function regionFromAddress(addr: string | null): { city: string | null; state: string | null }; // supersedes cityFromAddress (keep it as a thin wrapper)
  ```
- `totalFound` = Apollo's `total_entries` for the scope that matched (or for the last attempted scope when everything was empty).

- [ ] **Step 1: Failing tests**

`tests/unit/geo/usStates.test.ts`: `stateNameFor("TX") === "Texas"`, `("tx")` same, `("XX")` null, `(null)` null; the map has 51 entries.

`tests/unit/jobs/enrichHelpers.test.ts`: `regionFromAddress("1820 Pearland Pkwy, Pearland, TX 77581, USA")` → `{ city: "Pearland", state: "TX" }`; without the country suffix; `("Somewhere")` → `{ city: null, state: null }`; `cityFromAddress` still returns the city.

`tests/unit/providers/apollo.test.ts`:
- cascade: fetch mock returns `total_entries: 0` for the first call and 3 people for the second; `searchPeople({ domain: "kidsrkids.com", orgName: "Kids R Kids", city: "Pearland", state: "TX" }, 1)` → two calls; the first has `person_locations[]=Pearland, Texas`, the second `person_locations[]=Texas, United States`; result `scope: "state"`, `totalFound: 3`.
- three empties → third call has no `person_locations[]`, `scope: "any"`, `totalFound: 0`, `people: []`.
- first call non-empty → one call, `scope: "city"`.
- no city/state → a single unfiltered call, `scope: "any"`.
- org-search fallback branch (domain null) unchanged apart from the result object (`scope: "any"`).
- People Search response fields are still mapped as before (`orgName`, `hasEmail`, ranking).

`tests/db/enrich.test.ts`: update every `fake.searchPeople = async () => [...]` to return `{ people, totalFound: people.length, scope: "any" }`; add one case where the fake returns `scope: "city"` and assert the success message ends with ` (matched in Pearland, TX)`.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement**

`src/lib/geo/usStates.ts`: the 50 states + DC as `{ AL: "Alabama", … , WY: "Wyoming", DC: "District of Columbia" }`; `stateNameFor` upper-cases and looks up.

`src/lib/jobs/enrich.ts`: `regionFromAddress` parses the `"City, ST 12345"` part the way `cityFromAddress` does and extracts the 2-letter code with `/^([A-Z]{2})\b/` from the state-zip segment; `cityFromAddress(addr)` = `regionFromAddress(addr).city`.

`src/lib/providers/apollo.ts` `searchPeople`:
```ts
async searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult> {
  await checkPlanBlocked(PEOPLE_SEARCH_PATH);
  const key = await requireKey();
  const base = { person_titles: [...ENRICH_CONFIG.preferredTitles], include_similar_titles: true, person_seniorities: [...ENRICH_CONFIG.seniorities], per_page: ENRICH_CONFIG.searchPageSize, page: 1 };
  let filter: Record<string, string | string[]>;
  if (q.domain) filter = { q_organization_domains_list: [q.domain] };
  else { const org = await this.searchOrganization(q.orgName, q.city); if (!org) return { people: [], totalFound: 0, scope: "any" }; filter = org.primaryDomain ? { q_organization_domains_list: [org.primaryDomain] } : { organization_ids: [org.id] }; }
  const stateName = stateNameFor(q.state);
  const scopes: { scope: PeopleSearchScope; loc?: string }[] = [];
  if (q.city && stateName) scopes.push({ scope: "city", loc: `${q.city}, ${stateName}` });
  if (stateName) scopes.push({ scope: "state", loc: `${stateName}, United States` });
  scopes.push({ scope: "any" });
  let last: PeopleSearchResult = { people: [], totalFound: 0, scope: "any" };
  for (const s of scopes) {
    const r = await withBudget("apollo", () => post<{ people?: SearchPerson[]; total_entries?: number }>(key, PEOPLE_SEARCH_PATH, { ...base, ...filter, ...(s.loc ? { person_locations: [s.loc] } : {}) }));
    const people = rank((r.data?.people ?? []).map(toEnrichPerson));
    last = { people, totalFound: r.data?.total_entries ?? people.length, scope: s.scope };
    if (people.length > 0) return last;
  }
  return last;
}
```
`rank` is the existing titleRank/hasEmail sort extracted into a function. Each scope attempt is one budget unit (People Search is free of credits but counts toward the daily call budget; the cascade costs at most 3).

`src/lib/providers/fake.ts`: returns `{ people: [...same two...], totalFound: 2, scope: q.city && q.state ? "city" : "any" }`.

`src/lib/jobs/enrich.ts` `runEnrich`: `const { city, state } = regionFromAddress(b.formattedAddress); const search = await …searchPeople({ domain, orgName: b.name, city, state }, maxPeople); const people = search.people;` — replace `found = people.length` with `search.totalFound` for the "out of N found" wording only when `search.totalFound > people.length` would misstate examined candidates: keep `found = people.length` for the "checked" logic (Task 7) and append ` (${search.totalFound} at ${scopeLabel} in Apollo)` is over-engineering — instead append a short scope suffix to the success and none-had-email messages: ` (matched in ${city}, ${state})` for `scope === "city"`, ` (matched in ${stateNameFor(state)})` for `"state"`, nothing for `"any"`.

`tests/db/enrichCredits.test.ts`: its subclass overriding `searchPeople` must return the result object.

- [ ] **Step 4: tsc, lint, unit, db exit 0.**
- [ ] **Step 5: Commit** `feat(enrich): local-first People Search (city → state → anywhere) and a search result object with totalFound and scope`.

---

### Task 3: Chains never get a credit — headcount signal, sweep script, seed list, "Not an SMB" action

**Files:**
- Modify: `src/lib/config/enrichment.ts` (`chainHeadcountMin`), `src/lib/config/exclusion.ts` (seed chains)
- Create: `src/lib/jobs/rescore.ts`, `scripts/chain-sweep.ts`
- Modify: `src/lib/jobs/enrich.ts` (headcount guard), `src/app/api/businesses/[id]/route.ts` (PATCH `markAsChain`), `src/components/leads/LeadDetail.tsx` (action)
- Test: `tests/unit/scoring/smbFit.test.ts` (seed additions), `tests/db/rescore.test.ts` (new), `tests/db/enrich.test.ts`, `tests/db/businessRoute.test.ts` (or the file that tests the PATCH route; create if absent)

**Why:** Zumiez, Pet Paradise and H&R Block escaped chain exclusion (name-list only). Apollo's `total_entries` for a domain is a free national headcount: 6,579 for hrblock.com. Franchise brands stay eligible (kidsrkids.com is 139; the local owner is a real SMB prospect), so the threshold is deliberately high.

**Interfaces:**
- `ENRICH_CONFIG.chainHeadcountMin = 1000` (people at the domain in Apollo, any location).
- `src/lib/jobs/rescore.ts`:
  ```ts
  export async function rescoreExclusions(ownerId: string, cfg?: RuntimeConfig): Promise<{ scanned: number; newlyExcluded: number; restored: number }>;
  ```
  Re-runs `scoreSmbFit({ name, sameNameCount }, cfg.exclusion, cfg.projects)` for every business of the owner (same `nameCounts` logic as `src/lib/jobs/zipSearch.ts:176`), updates `exclusion`/`exclusionReasons` only when they change, and writes an activity row `Excluded as chain: <reason>` / `Exclusion lifted` per changed business. Businesses whose current reasons include `apollo_headcount:` keep that reason (it is not name-derived) — merge, do not overwrite.
- `runEnrich`: after `searchPeople`, `if (domain && search.totalFound >= ENRICH_CONFIG.chainHeadcountMin)` → set `exclusion: "enterprise"`, add `chain:apollo_headcount:<n>` to `exclusionReasons`, log `Enrichment skipped: <n> people at <domain> in Apollo — not an SMB (marked as chain)`, return `{ added: 0, updated: 0, skipped: "chain" }`, no reveal, `lastEnrichedAt` untouched. `isEnrichIssueMessage` gains this skip (it explains an empty People list).
- PATCH `/api/businesses/:id` body gains `markAsChain: z.literal(true).optional()`: appends `normalizeName(name)` (from `src/lib/jobs/shared.ts`) to `overrides.exclusion.chains` (dedupe, lowercase, via `saveOverrides`), then `rescoreExclusions`; response `{ business, rescore: { newlyExcluded } }`.
- `scripts/chain-sweep.ts`: `node --env-file=.env --import=tsx scripts/chain-sweep.ts [--apply] [--limit N]` — for each non-excluded business with a domain (skip `SHARED_HOSTS`), one People Search with no location and `per_page: 1` through the provider (so `withBudget` and the plan-block memo apply), print `domain  total  → chain?`; with `--apply`, mark as in `runEnrich`. Prints a reminder that the Apollo daily budget in Settings bounds the sweep (raise it to ≥ the business count first) and stops cleanly on `BudgetExhaustedError`.

- [ ] **Step 1: Failing tests**

`tests/unit/scoring/smbFit.test.ts`: `"Zumiez"`, `"Pet Paradise Pearland"`, `"H&R Block"`, `"Jiffy Lube"`, `"GEICO Insurance Agent"` are excluded with a `chain:` reason; `"Snap Fitness Pearland"` and `"State Farm - Jane Smith"` are NOT (franchise/agent-owned SMBs).

`tests/db/rescore.test.ts`: create three businesses ("Zumiez", "Bella Nails", "Zumiez Outlet") with `exclusion: "none"`; `rescoreExclusions(OWNER, cfgWithChains(["zumiez"]))` → `{ scanned: 3, newlyExcluded: 2, restored: 0 }`, activity rows written for the two, Bella untouched; a second run → `newlyExcluded: 0`; a business with `exclusionReasons: ["chain:apollo_headcount:2000"]` stays excluded even when its name matches nothing.

`tests/db/enrich.test.ts`: fake returns `totalFound: 6579` for a business with a domain → `skipped: "chain"`, `enrich` calls 0, exclusion `enterprise`, reason `chain:apollo_headcount:6579`, one activity row, `lastEnrichedAt` null; `totalFound: 139` → proceeds normally.

PATCH route test: `markAsChain: true` on "Zumiez" → 200, `rescore.newlyExcluded ≥ 1`, `AppConfig.overrides.exclusion.chains` contains `"zumiez"`; a second call is idempotent (no duplicate entry).

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

- [ ] **Step 1:** In that describe's `beforeEach`, after `cleanup()`, add `await prisma.contact.deleteMany({ where: { ownerId: OWNER, source: "apollo", type: "email" } });` with a comment naming the leak. Assert additionally that `creditsUsed(OWNER, new Date(0))` is 0 right before the request so a future leak fails with a clear message.
- [ ] **Step 2:** Run `npm run test:db` three times in a row; all green.
- [ ] **Step 3: Commit** `test(db): credits status test clears Apollo contacts for the shared owner (order-dependent fixture leak)`.

---

## Done criteria for Plan 9

- Settings shows the live Apollo balance and renewal date, and the app's own cap up to 5,000; enrichment stops when either the app cap or the Apollo balance is exhausted.
- Enriching a franchise-brand lead reveals a person in the lead's city or state when Apollo has one, and the activity row says so.
- A domain with ≥ 1,000 people in Apollo is excluded as a chain at enrichment time with no credit spent; the sweep script can do this for the whole table (dry run by default); the lead drawer has a "Not an SMB (chain)" action that also excludes look-alikes.
- `npm run test:db` passes three consecutive full runs.
- Live verification (coordinator, after the worker restarts on the branch): (1) Settings credit line matches the Apollo billing page; (2) `enqueueEnrich` on the Kids R Kids lead reveals a Houston-area person, not the CEO; (3) sweep dry run flags hrblock.com and zumiez.com.

## Follow-ups (not in this plan)

Bulk enrich progress in the UI; SSR the first Leads page; `person_locations[]` for the org-search fallback branch; undici `Parser.finish` assertion upstream; pg-boss pickup delay; Railway deploy end to end.
