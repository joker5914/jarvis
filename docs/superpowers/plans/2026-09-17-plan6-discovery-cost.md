# SDR Lead Gen Dashboard — Plan 6: Discovery Cost Control

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a zip search affordable on dense zips: cap places per category, never repeat the category searches on Resume, and deliver scored leads with contacts for whatever was fetched when the Google daily budget pauses discovery.

**Architecture:** `discover()` in `src/lib/jobs/zipSearch.ts` gains a per-category `maxResults` from `DISCOVERY_CONFIG`, persists the discovered `placeId → category` map on the `Search` row (new `discoveredIds Json?` column) and reuses it on Resume, and stops (instead of throwing) when Place Details hits `BudgetExhaustedError`, returning `complete: false`. `runZipSearch` then links, scores, scrapes, validates, and quality-scores the fetched set exactly as today, and ends the run as `paused` with a "Discovery incomplete" message that Resume continues from (details for the remaining IDs only, then the contact steps for the newly linked businesses; already-scraped businesses are skipped by the existing `websiteCheckedAt < search.createdAt` rule).

**Tech Stack:** Same as Plans 1–5 (Next.js 15.5, Prisma 6.19, pg-boss 12, Vitest 5). One migration.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` — 5.1 (zip search steps), 5.5 ("Budget exhaustion: job status `paused` with a message; Retry resumes from the last completed step"). Motivation recorded in `.superpowers/sdd/2026-09-16-plan5-hygiene/progress.md` (live run on zip 77581: 1,369 businesses after 2,000 calls, contacts still 0).

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` before npm commands). Pinned majors unchanged.
- Owner via `getActor()`; `"local-user"` only in `src/lib/actor.ts`, schema defaults, seed, tests. Every Google call inside `withBudget("google")`; `PROVIDER_MODE=fake` never touches the network.
- Scanner semantics unchanged: scanner-origin searches still honor `pauseRequested`; a budget pause still leaves the search `paused` so the planner's `pausedSearch` resumes it once the budget resets.
- The "never scored" marker (`primaryCategory === null` on rows persisted by `discover()`) and the exactly-once `discovered` activity (Plan 4 R1/R2) must keep holding.
- Browser suite stays at 13; unit/db suites only grow. Never reset the dev database (it now holds real data); the migration is additive.
- Commit per task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. `npx tsc --noEmit` is the source of truth over editor diagnostics. Stop servers by PID, never `taskkill /IM node.exe`.

## File structure

```
src/lib/config/discovery.ts            + maxPlacesPerCategory: 40
prisma/schema.prisma                   Search.discoveredIds Json?; migration search_discovered_ids
src/lib/jobs/zipSearch.ts              discover(): cap, persisted IDs, budget stop → complete:false; runZipSearch: partial-run flow
src/lib/providers/fake.ts              FakeDiscoveryProvider records maxResults per call
src/components/searches/SearchList.tsx paused-with-partial copy (no new testids)
README.md                              Zip search cost paragraph
tests/db/zipSearchDiscoveryCap.test.ts new
tests/db/zipSearchBudgetResume.test.ts updated expectations
```

---

### Task 1: Per-category cap and persisted discovered IDs

**Files:**
- Modify: `src/lib/config/discovery.ts`, `prisma/schema.prisma` (+ migration `search_discovered_ids`), `src/lib/jobs/zipSearch.ts` (`discover`, `runZipSearch` call site), `src/lib/providers/fake.ts`, `README.md`
- Create: `tests/db/zipSearchDiscoveryCap.test.ts`

**Interfaces:**
- Produces: `DISCOVERY_CONFIG = { detailsRefreshDays: 30, maxPlacesPerCategory: 40 }`; `Search.discoveredIds: Json?` holding `Record<string, string>` (placeId → category slug); `FakeDiscoveryProvider.maxResultsSeen: number[]` (one entry per `searchCategoryIds` call); `discover(searchId, ownerId, zip, center, radius, deps, done, categories, priorIds: Record<string,string> | null)`.

- [ ] **Step 1: Failing DB test**

`tests/db/zipSearchDiscoveryCap.test.ts` (same conventions as `tests/db/zipSearchBudgetResume.test.ts`: unique owner, `deleteMany` cleanup, `Providers` literal with all six fakes):

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { DISCOVERY_CONFIG } from "@/lib/config/discovery";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, FakeRegistryProvider, FakeEnrichmentProvider, fakeFetcher } from "@/lib/providers/fake";

const OWNER = "test-discovery-cap-owner";
async function cleanup() { /* activityLog, businessTag, contact, searchBusiness, search, business for OWNER — copy from zipSearchBudgetResume.test.ts */ }
beforeEach(cleanup);
afterAll(cleanup);

function deps(discovery: FakeDiscoveryProvider) {
  return { providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), enrichment: new FakeEnrichmentProvider(), fetcher: fakeFetcher }, log: () => {} } as never;
}

describe("discovery cap and persisted IDs", () => {
  it("passes maxPlacesPerCategory to every category search and persists the discovered IDs", async () => {
    const discovery = new FakeDiscoveryProvider();
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search.id, deps(discovery));
    expect(discovery.calls.searchCategoryIds).toBeGreaterThan(0);
    expect(new Set(discovery.maxResultsSeen)).toEqual(new Set([DISCOVERY_CONFIG.maxPlacesPerCategory]));
    const after = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    const ids = after.discoveredIds as Record<string, string>;
    expect(Object.keys(ids).length).toBe(discovery.known.size); // every discovered place recorded with its first category
    expect(Object.values(ids).every((slug) => typeof slug === "string" && slug.length > 0)).toBe(true);
  });

  it("a resumed search reuses the persisted IDs and makes zero category searches", async () => {
    const first = new FakeDiscoveryProvider();
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search.id, deps(first));
    // Force a resume from before the discover step (as a budget pause would leave it).
    await prisma.search.update({ where: { id: search.id }, data: { status: "paused", progress: { step: "paused", doneSteps: [] } } });
    const second = new FakeDiscoveryProvider();
    await runZipSearch(search.id, deps(second));
    expect(second.calls.searchCategoryIds).toBe(0);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: search.id } })).status).toBe("complete");
  });
});
```
(`discovery.known` is the fake's cache of generated places; read `fake.ts` and use whatever exposes the generated set — the assertion is that every discovered place ID is persisted.)

- [ ] **Step 2: Run it, expect failure** — `npx vitest run tests/db/zipSearchDiscoveryCap.test.ts -c vitest.db.config.ts` → FAIL (`maxResultsSeen`/`discoveredIds` missing).

- [ ] **Step 3: Config, schema, fake**

`src/lib/config/discovery.ts`:
```ts
/** Place Details are re-fetched for a known place only after this many days; each category search returns at most this many places (Google ranks by prominence; 60 is the API maximum). */
export const DISCOVERY_CONFIG = { detailsRefreshDays: 30, maxPlacesPerCategory: 40 } as const;
```
`prisma/schema.prisma` `model Search`: add `discoveredIds Json?` after `progress`. `npx prisma migrate dev --name search_discovered_ids --skip-seed && npx prisma generate` (`--create-only` + `migrate deploy` if the CLI refuses under the AI guard; the dev DB holds real data — additive only).

`src/lib/providers/fake.ts` `FakeDiscoveryProvider`: add `maxResultsSeen: number[] = []` and change `async searchCategoryIds(rawQuery: string, _center?: unknown, _radius?: number, maxResults = 60)` to push `maxResults` before returning (behaviour otherwise unchanged; do not truncate the fake's list — its per-category counts are asserted elsewhere).

- [ ] **Step 4: discover() uses the cap and the persisted map**

In `zipSearch.ts` `discover(...)`, add the trailing parameter `priorIds: Record<string, string> | null` and replace the ID loop:

```ts
  const idsByCategory = new Map<string, string>(); // placeId -> first surfacing category
  if (priorIds && Object.keys(priorIds).length > 0) {
    for (const [id, slug] of Object.entries(priorIds)) idsByCategory.set(id, slug);
    await setProgress(searchId, { step: "discover", current: categories.length, total: categories.length, message: "Using previously discovered places", doneSteps: done });
  } else {
    for (let i = 0; i < categories.length; i++) {
      await checkPause(deps);
      const c = categories[i];
      await setProgress(searchId, { step: "discover", current: i + 1, total: categories.length, message: c.label, doneSteps: done });
      const ids = await deps.providers.discovery.searchCategoryIds(`${c.query} in ${zip}`, center, radius, DISCOVERY_CONFIG.maxPlacesPerCategory);
      for (const id of ids) if (id && !idsByCategory.has(id)) idsByCategory.set(id, c.slug);
    }
    await prisma.search.update({ where: { id: searchId }, data: { discoveredIds: Object.fromEntries(idsByCategory) as Prisma.InputJsonValue } });
  }
```
In `runZipSearch`, pass `(search.discoveredIds as Record<string, string> | null) ?? null` as the new argument. A **re-run** (`/api/searches/[id]/rerun`) creates a new Search row, so it always discovers afresh — correct, because re-running is how a user refreshes a zip.

- [ ] **Step 5: README** — in the zip-search/cost text add: "Each category search returns at most `maxPlacesPerCategory` (40) places, ranked by Google prominence, so a dense zip costs at most about 34 × 40 Place Details calls; a Resume never repeats the category searches."

- [ ] **Step 6: Verify, commit**

```bash
npm run test:db && npm test && npx tsc --noEmit && npm run lint
git add -A && git commit -m "feat(discovery): cap places per category and persist discovered IDs so Resume skips category searches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Contact steps run on the fetched set when details hit the budget

**Files:**
- Modify: `src/lib/jobs/zipSearch.ts` (`discover` return shape, `runZipSearch` flow and end state), `src/components/searches/SearchList.tsx` (copy only), `tests/db/zipSearchBudgetResume.test.ts`

**Interfaces:**
- Consumes: Task 1's `discover(..., priorIds)`.
- Produces: `discover()` returns `{ found, knownFresh, complete: boolean }`; a budget-interrupted run ends with `status: "paused"`, `error: null`, `progress: { step: "paused", message: "Discovery incomplete: Google daily budget exhausted — resume to find more businesses", doneSteps: <without "discover"> }` and all fetched businesses linked, scored, scraped, validated, and quality-scored.

- [ ] **Step 1: Update the DB test expectations (they become the failing test)**

In `tests/db/zipSearchBudgetResume.test.ts`, the first case ("budget bites mid-discover") changes to assert the new contract after the limited run:

```ts
    expect(paused.status).toBe("paused");
    expect(paused.error).toBeNull();
    expect((paused.progress as { message?: string }).message).toMatch(/Discovery incomplete/);
    expect((paused.progress as { doneSteps: string[] }).doneSteps).not.toContain("discover");
    expect(limited.calls.getPlaceDetails).toBe(N);
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(N);   // linked, not 0
    expect(paused.countsFound).toBe(N);
    const scored = await prisma.business.findMany({ where: { ownerId: OWNER }, select: { primaryCategory: true, websiteCheckedAt: true, contactQualityBand: true } });
    expect(scored).toHaveLength(N);
    expect(scored.every((b) => b.primaryCategory !== null)).toBe(true);        // scored/excluded already
    expect(scored.filter((b) => b.websiteCheckedAt !== null).length).toBeGreaterThan(0); // scraped
    expect(await prisma.contact.count({ where: { ownerId: OWNER } })).toBeGreaterThan(0); // contacts delivered before the resume
    expect(await prisma.activityLog.count({ where: { kind: "discovered" } })).toBe(N);
```
And for the resumed run add:
```ts
    expect(fresh.calls.searchCategoryIds).toBe(0);            // Task 1: IDs persisted
    expect(fresh.calls.getPlaceDetails).toBe(total - N);
    const firstBatchChecked = new Map(scored.map((b) => [b.primaryCategory, b.websiteCheckedAt])); // capture before resume; compare by id in the real test
    // businesses scraped in the first run keep their websiteCheckedAt (not re-scraped): compare per-id before/after
```
(Compare per business id: snapshot `websiteCheckedAt` for the first N by id before the resume and assert equality after.) Keep the existing end-state assertions (complete, total links, one `discovered` activity each, Starbucks excluded, interrupted-vs-uninterrupted scores identical).

- [ ] **Step 2: Run, expect failure** — `npx vitest run tests/db/zipSearchBudgetResume.test.ts -c vitest.db.config.ts` → FAIL on `error`/links.

- [ ] **Step 3: discover() stops on budget instead of throwing**

Wrap the details loop body's `getPlaceDetails` call:

```ts
  let complete = true;
  for (const id of toFetch) {
    await checkPause(deps);
    n++;
    await setProgress(searchId, { step: "details", current: n, total: toFetch.length, doneSteps: done });
    let biz: DiscoveredBusiness | null;
    try {
      biz = await deps.providers.discovery.getPlaceDetails(id);
    } catch (e) {
      if (e instanceof BudgetExhaustedError) { complete = false; break; }
      throw e;
    }
    if (biz && biz.name) { /* existing upsert block unchanged */ }
  }
  return { found, knownFresh: /* unchanged */, complete };
```
A `BudgetExhaustedError` thrown by the category searches (before any details) still propagates as today (the existing outer catch pauses with the error message) — only the details phase becomes partial.

- [ ] **Step 4: runZipSearch partial flow**

```ts
    let discoveryComplete = true;
    if (!done.includes("discover")) {
      const { found, knownFresh, complete } = await discover(searchId, ownerId, search.zip, center, radius, deps, done, cfg.categories, priorIds);
      discoveryComplete = complete;
      await setProgress(searchId, { step: "save", current: 0, total: found.size + knownFresh.length, doneSteps: done });
      businessIds = await upsertBusinesses(searchId, ownerId, found, knownFresh, cfg);
      if (discoveryComplete) done.push("discover");
      await prisma.search.update({ where: { id: searchId }, data: { countsFound: businessIds.length } });
    } else { /* unchanged */ }
    // steps 5–7 unchanged (scrape → validate → score) on businessIds
    if (discoveryComplete) {
      /* existing complete update */
    } else {
      await prisma.search.update({
        where: { id: searchId },
        data: { status: "paused", error: null, progress: { step: "paused", message: "Discovery incomplete: Google daily budget exhausted — resume to find more businesses", doneSteps: done } as Prisma.InputJsonValue },
      });
      log(`search ${searchId}: paused with discovery incomplete (${businessIds.length} businesses processed)`);
    }
```
Check `upsertBusinesses`' knownFresh linking tolerates rows already linked to this search from the first partial run (it must use `createMany({ skipDuplicates: true })` or `upsertIgnoringConflict` on `searchBusiness` — read it; fix if it would throw on the composite key). `countsFound` on resume = total linked businesses.

- [ ] **Step 5: Copy** — `SearchList.tsx`: the paused card already prints `progress.message`; make sure a paused search with `error === null` shows the message in amber (not red) and keeps the Resume button. No new testids.

- [ ] **Step 6: Verify, commit**

```bash
npm run test:db && npm test && npx tsc --noEmit && npm run lint && npm run test:e2e   # 13
git add -A && git commit -m "feat(discovery): deliver scored leads with contacts for the fetched set when Place Details hits the daily budget

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 6

- A zip search never requests more than `maxPlacesPerCategory` places per category; a Resume makes zero category searches.
- When Place Details hits the Google budget, the run still links, scores, scrapes, validates, and quality-scores everything fetched, and ends `paused` with the "Discovery incomplete" message; Resume fetches only the remaining places and does not re-scrape.
- Suites green (e2e 13); migration additive; the live dev database's paused 77581 search can be resumed under the new code without re-running category searches on the next attempt after one (the first resume persists the IDs).
