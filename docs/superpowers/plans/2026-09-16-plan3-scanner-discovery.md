# SDR Lead Gen Dashboard — Plan 3: Scanner, Places ID-only Discovery, Shared Job Helpers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dashboard work unattended: a Scanner that runs zip searches, TDLR syncs, and website re-checks inside a user-defined operating window and can be paused or stopped at any moment; plus a cheaper Google discovery path (ID-only search, details only for new places), shared job helpers, and a browser suite that runs against a production build.

**Architecture:** A pg-boss cron `scanner-tick` job every 5 minutes reads `ScanSchedule`/`ScanTarget`/`ScannerState`, decides via a pure planner what one piece of work is due, enqueues it at scanner priority with `origin = scanner`, and writes status the UI polls. Scanner-origin jobs check a `pauseRequested` flag between steps through the shared `checkPause`. Discovery becomes two provider calls: an ID-only Text Search per category and Place Details only for IDs not already stored (or stale). Shared job code moves out of `zipSearch.ts` into `src/lib/jobs/shared.ts`.

**Tech Stack:** Same as Plans 1–2: Next.js 15.5 App Router, TypeScript, Tailwind 4, shadcn/ui (Base UI generation), Prisma 6.19 + Postgres 16, pg-boss 12, zod 4, Vitest 5, Playwright. Node 22.22.3.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` — sections 4 (ScanSchedule, ScanTarget, ScannerState), 5.1 step 2 (ID-only discovery), 5.6 (Scanner), 8 (Scanner page, navbar pill, dashboard card), 9.

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` before npm commands). Pinned majors unchanged; no upgrades.
- shadcn/ui is the **Base UI generation**: no `asChild`; `render` prop; `nativeButton={false}` on a Button rendering `<a>`; `Select` takes `items` and `onValueChange` may pass `null`; `Checkbox` uses `onCheckedChange(boolean)`.
- Owner via `getActor()` in every route handler and server component; `"local-user"` only in `src/lib/actor.ts`, schema defaults, seed, tests. Jobs without an owning row call `getActor()` once.
- Scanner tick every **5 minutes**; window = `windowStart`..`windowEnd` (absolute), optional `dailyStartTime`/`dailyEndTime` (`HH:mm`, in `timezone`), `daysOfWeek` (0–6, empty = every day). Work priority: (1) TDLR sync if `lastSuccessfulAt` older than `tdlrSyncHours`; (2) a paused scanner-origin zip search to resume; (3) highest-priority unpaused `ScanTarget` with `lastSearchedAt` null or older than `zipRefreshDays` (ties: oldest `lastSearchedAt`); (4) up to 25 non-excluded businesses with `websiteCheckedAt` older than `websiteRecheckDays`; else idle with `nextPlanned`. At most `maxConcurrentJobs` (default 1) scanner-origin jobs run at once. Budget exhaustion → state `budget_exhausted`. After a scanner-origin job fails past retries, skip that item for 6 hours; three consecutive failures across items → `paused` with `lastError`.
- Pause takes effect within seconds: every scanner-origin job checks `ScannerState.pauseRequested` between steps and website fetches. Resume clears the flag and the next tick re-enqueues the paused item, which continues from its last completed step. Stop = pause + `enabled = false`. Manual jobs ignore the window and pause state and always outrank scanner jobs (manual priority 10, scanner priority 1).
- `autoAddHotZips`: upsert a `ScanTarget` (addedBy `auto_tdlr`, priority 100) for the zip of every non-excluded project with `smbFitScore >= 60` and timing window `opening_soon` or `under_construction`.
- Discovery cost rule (spec 5.1): Text Search with field mask `places.id` only (IDs-only SKU), then Place Details only for place IDs the owner does not already have, or has not refreshed within `zipRefreshDays`; both count one budget unit per HTTP call.
- The browser suite runs against `next build` + `next start` on port 3100 with a separate `distDir` so it never clobbers a running dev server.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. Stop servers by PID, never `taskkill /IM node.exe`. `npx tsc --noEmit` is the source of truth over editor diagnostics.

## File structure (what this plan creates or modifies)

```
next.config.ts                        distDir from NEXT_DIST_DIR (e2e builds into .next-e2e)
playwright.config.ts                  build + start production server
.gitignore                            + .next-e2e/
.github/workflows/ci.yml              + prisma migrate diff step
src/lib/jobs/shared.ts                JobDeps, JobPausedError, checkPause, normalizeName, discoveredToBusinessFields, scannerPauseCheck
src/lib/jobs/zipSearch.ts             imports from shared; ID-only discovery with details for new/stale places; origin-aware
src/lib/jobs/tdlrSync.ts, promote.ts  import shared helpers (no behavior change)
src/lib/jobs/websiteRecheck.ts        runWebsiteRecheck(businessIds, ownerId, deps)
src/lib/jobs/queues.ts                + scannerTick, websiteRecheck queues; ZipSearchJobData.origin; QUEUE_OPTIONS entries
src/lib/jobs/enqueue.ts               + origin on zip search, enqueueWebsiteRecheck, enqueueScannerTick
src/worker/index.ts                   + handlers + 5-minute cron; scanner-origin jobs get shouldPause
src/lib/providers/types.ts            + searchCategoryIds, getPlaceDetails on DiscoveryProvider
src/lib/providers/google.ts           ID-only text search + place details
src/lib/providers/fake.ts             fake ids/details + call counters
src/lib/config/region.ts              tdlrCityCode 785, defaultCenter, timezone (replaces Houston literals)
src/lib/scanner/window.ts             isWithinWindow(schedule, now)
src/lib/scanner/planner.ts            pickNextWork(input) (pure)
src/lib/scanner/tick.ts               runScannerTick(deps) (DB + enqueue)
src/lib/scanner/state.ts              readScanner(ownerId), setScannerStatus(...), scanner activity log helpers
prisma/schema.prisma                  Business.googleFetchedAt; ScannerState.backoffUntil, consecutiveFailures, skipUntil Json; migration scanner_fields
src/app/api/scanner/route.ts          GET state+schedule+targets
src/app/api/scanner/schedule/route.ts PUT
src/app/api/scanner/{pause,resume,stop,run-now}/route.ts  POST
src/app/api/scanner/targets/route.ts  GET, POST
src/app/api/scanner/targets/[id]/route.ts  PATCH, DELETE
src/app/api/searches/[id]/resume/route.ts  POST (resume a paused search)
src/components/scanner/*              StatusCard, ScheduleForm, TargetsCard, ScannerActivity, ScannerView
src/components/nav/ScannerPill.tsx    live pill with Pause/Resume
src/components/dashboard/ScannerCard.tsx
src/components/searches/SearchList.tsx  Resume button for paused searches
src/app/scanner/page.tsx              real page
src/lib/projects/filters.ts           fit thresholds from PROJECT_CONFIG/bandFor
src/app/api/projects/{sync,promote-high-fit}/route.ts  getActor()
tests/unit/scanner/*.test.ts, tests/unit/providers/googleIds.test.ts, tests/db/scannerTick.test.ts, tests/db/zipSearchIds.test.ts, tests/db/websiteRecheck.test.ts, tests/e2e/scanner.spec.ts
```

---

### Task 1: Browser suite against a production build

**Files:**
- Modify: `next.config.ts`, `playwright.config.ts`, `.gitignore`, `package.json` (one script), `.github/workflows/ci.yml` (no change needed to steps; verify)

**Interfaces:**
- Produces: `NEXT_DIST_DIR` env var honored by `next.config.ts`; npm script `e2e:server` = `cross-env NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-e2e next build && cross-env NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-e2e next start -p 3100`.

- [ ] **Step 1: Make the build output directory configurable**

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["pg-boss", "pg", "@prisma/client"],
  // The e2e suite builds into its own directory so it never clobbers a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
```

Append `.next-e2e/` to `.gitignore`.

- [ ] **Step 2: Add the server script and point Playwright at it**

In `package.json` scripts add:

```json
"e2e:server": "cross-env NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-e2e next build && cross-env NEXT_TELEMETRY_DISABLED=1 NEXT_DIST_DIR=.next-e2e next start -p 3100"
```

In `playwright.config.ts` change the `webServer` block to:

```ts
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:3100/unlock",
    reuseExistingServer: false,
    // next build takes a minute or two on a cold runner before the server starts.
    timeout: 300_000,
    env: {
      DATABASE_URL: testDb,
      PROVIDER_MODE: "fake",
      JOB_MODE: "inline",
      APP_PASSPHRASE: "test-pass",
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
      GOOGLE_DAILY_BUDGET: "100000",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
```

and update the comment above `expect: { timeout: 15_000 }` to say the production server is fast but CI runners are shared, so the wider default stays.

- [ ] **Step 3: Run the suite twice**

```bash
npm run test:e2e
npm run test:e2e
```

Expected: 8 passed both times; the first run's build log shows `NEXT_DIST_DIR` respected (a `.next-e2e/` directory appears; `.next/` is untouched). If `next start` refuses because `next build` emitted a warning about `outputFileTracingRoot`, keep the config; warnings are fine. If the build fails on a type error in a route export, fix the type per the error and note it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: run the browser suite against a production build in its own dist dir

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared job helpers and region config

**Files:**
- Create: `src/lib/jobs/shared.ts`, `src/lib/config/region.ts`, `tests/unit/jobs/shared.test.ts`
- Modify: `src/lib/jobs/zipSearch.ts`, `src/lib/jobs/tdlrSync.ts`, `src/lib/jobs/promote.ts`, `src/lib/providers/tdlr.ts`, `tests/unit/jobs/normalizeName.test.ts`

**Interfaces:**
- Produces:
  - `type JobDeps = { providers: Providers; shouldPause?: () => Promise<boolean>; signal?: AbortSignal; log?: (msg: string) => void }`
  - `class JobPausedError extends Error`; `checkPause(deps: JobDeps): Promise<void>`
  - `normalizeName(name: string): string` (moved; `zipSearch.ts` re-exports it)
  - `discoveredToBusinessFields(biz: DiscoveredBusiness)` → the ten Google-sourced Business columns
  - `scannerPauseCheck(ownerId: string): () => Promise<boolean>` — returns a `shouldPause` that reads `ScannerState.pauseRequested`
  - `REGION = { tdlrCityCode: 785, defaultCenter: { lat: 29.7604, lng: -95.3698 }, timezone: "America/Chicago", name: "Houston" }` in `src/lib/config/region.ts`
  - `ZipSearchDeps`, `TdlrSyncDeps`, `PromoteDeps` become aliases of `JobDeps` (kept as exported names).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/jobs/shared.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkPause, JobPausedError, normalizeName, discoveredToBusinessFields } from "@/lib/jobs/shared";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
};

describe("checkPause", () => {
  it("throws JobPausedError when the signal is aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(checkPause({ providers, signal: ctrl.signal })).rejects.toBeInstanceOf(JobPausedError);
  });
  it("throws when shouldPause resolves true and passes otherwise", async () => {
    await expect(checkPause({ providers, shouldPause: async () => true })).rejects.toBeInstanceOf(JobPausedError);
    await expect(checkPause({ providers, shouldPause: async () => false })).resolves.toBeUndefined();
    await expect(checkPause({ providers })).resolves.toBeUndefined();
  });
});

describe("normalizeName", () => {
  it("still normalizes suffixes and punctuation", () => {
    expect(normalizeName("Joe's Auto-Repair Inc.")).toBe("joes auto repair");
  });
});

describe("discoveredToBusinessFields", () => {
  it("maps the ten Google columns", () => {
    const f = discoveredToBusinessFields({
      placeId: "p1", name: "N", formattedAddress: "A", zip: "77084", lat: 1, lng: 2, phone: "p", websiteUrl: "w", rating: 4.5, reviewCount: 9, types: ["t"],
    });
    expect(f).toEqual({ name: "N", formattedAddress: "A", zip: "77084", lat: 1, lng: 2, phone: "p", websiteUrl: "w", googleRating: 4.5, googleReviewCount: 9, googleTypes: ["t"] });
  });
});
```

Run `npm test -- tests/unit/jobs/shared` — expect FAIL (module not found).

- [ ] **Step 2: Create shared.ts and region.ts**

Create `src/lib/config/region.ts`:

```ts
/** The metro the app targets today. Plan 4's Settings page makes this editable. */
export const REGION = {
  name: "Houston",
  tdlrCityCode: 785,
  defaultCenter: { lat: 29.7604, lng: -95.3698 },
  timezone: "America/Chicago",
} as const;
```

Create `src/lib/jobs/shared.ts`:

```ts
import { prisma } from "@/lib/db";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";

/** Dependencies every background job receives. Manual runs pass only `providers`. */
export type JobDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
};

export class JobPausedError extends Error {
  constructor() {
    super("paused");
    this.name = "JobPausedError";
  }
}

/** Call between steps and before each network fetch so a pause lands within seconds. */
export async function checkPause(deps: JobDeps): Promise<void> {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

const SUFFIX_RE = /\b(llc|inc|co|corp|ltd|pllc|pc)\b\.?/g;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The Business columns that come straight from Google. Used by zip search and promote. */
export function discoveredToBusinessFields(biz: DiscoveredBusiness) {
  return {
    name: biz.name,
    formattedAddress: biz.formattedAddress,
    zip: biz.zip,
    lat: biz.lat,
    lng: biz.lng,
    phone: biz.phone,
    websiteUrl: biz.websiteUrl,
    googleRating: biz.rating,
    googleReviewCount: biz.reviewCount,
    googleTypes: biz.types,
  };
}

/** shouldPause for scanner-origin jobs: true once the user has asked the Scanner to pause. */
export function scannerPauseCheck(ownerId: string): () => Promise<boolean> {
  return async () => {
    const s = await prisma.scannerState.findUnique({ where: { ownerId }, select: { pauseRequested: true } });
    return !!s?.pauseRequested;
  };
}
```

- [ ] **Step 3: Point the jobs at shared.ts**

In `src/lib/jobs/zipSearch.ts`:
- Delete the local `ZipSearchDeps` type, `JobPausedError` class, `SUFFIX_RE`, `normalizeName`, and `checkPause` definitions.
- Add `import { checkPause, discoveredToBusinessFields, JobPausedError, normalizeName, type JobDeps } from "./shared";` and `export type ZipSearchDeps = JobDeps; export { JobPausedError, normalizeName };` so existing importers keep working.
- In `upsertBusinesses`, replace the inline `googleFields` object's ten Google columns with `...discoveredToBusinessFields(biz)` (keep `exclusion`, `exclusionReasons`, `smbFitScore` alongside).

In `src/lib/jobs/tdlrSync.ts`: delete the local `checkPause`; import `checkPause` and `type JobDeps` from `./shared`; `export type TdlrSyncDeps = JobDeps & { now?: () => Date };`; replace `TDLR_HOUSTON_CITY_CODE`/`785` literals with `REGION.tdlrCityCode` from `@/lib/config/region`.

In `src/lib/jobs/promote.ts`: delete the local `checkPause` and `HOUSTON_CENTER`; import `checkPause`, `discoveredToBusinessFields`, `normalizeName`, `JobPausedError`, `type JobDeps` from `./shared` (remove those imports from `./zipSearch`, keep `scrapeOne`, `validateEmails`, `recomputeContactQuality`); `export type PromoteDeps = JobDeps;`; use `REGION.defaultCenter` for the fallback center; replace the inline Google fields object in `linkProjectToPlace` with `discoveredToBusinessFields(biz)`.

In `src/lib/providers/tdlr.ts`: `export const TDLR_HOUSTON_CITY_CODE = REGION.tdlrCityCode;` (import from config) so the constant keeps its name.

Update `tests/unit/jobs/normalizeName.test.ts` to import from `@/lib/jobs/shared`.

- [ ] **Step 4: Verify nothing moved behaviorally**

```bash
npm test
npm run test:db
npx tsc --noEmit
npm run lint
grep -rn "29.7604\|HOUSTON_CENTER\|785" src/ --include=*.ts --include=*.tsx | grep -v "config/region.ts"
```

Expected: all suites unchanged and green; the grep prints only `TDLR_HOUSTON_CITY_CODE = REGION.tdlrCityCode` (or nothing).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: shared job helpers (checkPause, JobPausedError, normalizeName, Google field mapper) and region config

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Places ID-only discovery with details for new or stale places

**Files:**
- Create: `tests/unit/providers/googleIds.test.ts`, `tests/db/zipSearchIds.test.ts`, a Prisma migration
- Modify: `prisma/schema.prisma`, `src/lib/providers/types.ts`, `src/lib/providers/google.ts`, `src/lib/providers/fake.ts`, `src/lib/jobs/zipSearch.ts`, `src/lib/config/projects.ts` (no) — see below; `tests/db/zipSearch.test.ts`

**Interfaces:**
- Consumes: `withBudget`, `getProviderKey`, `mapPlace`, `PlacesApiPlace` (Plan 1 `google.ts`); `discoveredToBusinessFields` (Task 2).
- Produces:
  - `DiscoveryProvider` gains `searchCategoryIds(query: string, center: { lat: number; lng: number }, radiusMeters: number, maxResults?: number): Promise<string[]>` and `getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null>`; `searchCategory` stays (used by promote).
  - `Business.googleFetchedAt DateTime?` (set whenever details are written).
  - `PLACE_DETAILS_FIELD_MASK` and `IDS_ONLY_FIELD_MASK = "places.id,nextPageToken"` exported from `google.ts`.
  - `FakeDiscoveryProvider.calls = { searchCategory: number; searchCategoryIds: number; getPlaceDetails: number }` counters for tests.
  - Zip search: discovery collects IDs per category; details are fetched only for IDs the owner lacks or whose `googleFetchedAt` is older than `DISCOVERY_CONFIG.detailsRefreshDays` (30), defined in a new `src/lib/config/discovery.ts`.

- [ ] **Step 1: Schema and migration**

In `prisma/schema.prisma` `model Business` add after `lastEnrichedAt`:

```prisma
  googleFetchedAt         DateTime?
```

```bash
npx prisma migrate dev --name business_google_fetched_at --skip-seed
npx prisma generate
```

Create `src/lib/config/discovery.ts`:

```ts
/** Place Details are re-fetched for a known place only after this many days. */
export const DISCOVERY_CONFIG = { detailsRefreshDays: 30 } as const;
```

- [ ] **Step 2: Write the failing unit test for the Google provider**

Create `tests/unit/providers/googleIds.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { GooglePlacesProvider, IDS_ONLY_FIELD_MASK, PLACE_DETAILS_FIELD_MASK } from "@/lib/providers/google";

vi.mock("@/lib/providers/budget", () => ({ withBudget: async (_p: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/providers/keys", () => ({ getProviderKey: async () => "test-key" }));

afterEach(() => vi.unstubAllGlobals());

describe("GooglePlacesProvider ID-only search", () => {
  it("requests only place ids and pages through tokens", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = JSON.parse(String(init.body));
      const page = body.pageToken ? 2 : 1;
      return new Response(JSON.stringify({ places: [{ id: `p${page}a` }, { id: `p${page}b` }], nextPageToken: page === 1 ? "tok" : undefined }), { status: 200 });
    }));
    const ids = await new GooglePlacesProvider().searchCategoryIds("nail salon in 77084", { lat: 29.8, lng: -95.6 }, 3000);
    expect(ids).toEqual(["p1a", "p1b", "p2a", "p2b"]);
    expect(calls).toHaveLength(2);
    expect((calls[0].init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(IDS_ONLY_FIELD_MASK);
    expect(IDS_ONLY_FIELD_MASK).toBe("places.id,nextPageToken");
  });

  it("fetches place details with the full mask and maps them", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://places.googleapis.com/v1/places/p1a");
      expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(PLACE_DETAILS_FIELD_MASK);
      return new Response(JSON.stringify({ id: "p1a", displayName: { text: "Bella" }, formattedAddress: "1 Main, Houston, TX 77084", location: { latitude: 1, longitude: 2 }, websiteUri: "https://b.com", types: ["nail_salon"], addressComponents: [{ longText: "77084", types: ["postal_code"] }] }), { status: 200 });
    }));
    const b = await new GooglePlacesProvider().getPlaceDetails("p1a");
    expect(b?.name).toBe("Bella");
    expect(b?.zip).toBe("77084");
    expect(b?.websiteUrl).toBe("https://b.com");
  });

  it("returns null for a 404 place", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect(await new GooglePlacesProvider().getPlaceDetails("gone")).toBeNull();
  });
});
```

Run `npm test -- tests/unit/providers/googleIds` — expect FAIL.

- [ ] **Step 3: Extend the provider interface, Google, and the fake**

In `src/lib/providers/types.ts` change `DiscoveryProvider` to:

```ts
export interface DiscoveryProvider {
  /** Full results (name, phone, website...). Used by the promote flow for a handful of candidates. */
  searchCategory(query: string, center: { lat: number; lng: number }, radiusMeters: number, maxResults?: number): Promise<DiscoveredBusiness[]>;
  /** IDs-only Text Search (free SKU). Used by zip search; details are fetched separately for new IDs. */
  searchCategoryIds(query: string, center: { lat: number; lng: number }, radiusMeters: number, maxResults?: number): Promise<string[]>;
  /** Place Details for one place; null when the place no longer exists. */
  getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null>;
}
```

In `src/lib/providers/google.ts`:
- Rename the existing `FIELD_MASK` constant to `SEARCH_FIELD_MASK` (keep its contents) and add:

```ts
export const IDS_ONLY_FIELD_MASK = "places.id,nextPageToken";
export const PLACE_DETAILS_FIELD_MASK = [
  "id", "displayName", "formattedAddress", "location", "nationalPhoneNumber", "websiteUri", "rating", "userRatingCount", "types", "addressComponents",
].join(",");
```

- Add to `GooglePlacesProvider`:

```ts
  async searchCategoryIds(query: string, center: LatLng, radiusMeters: number, maxResults = 60): Promise<string[]> {
    const key = await requireKey();
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && ids.length < maxResults; page++) {
      const body: Record<string, unknown> = {
        textQuery: query,
        pageSize: 20,
        locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusMeters, 50_000) } },
      };
      if (pageToken) body.pageToken = pageToken;
      const data = await withBudget("google", async () => {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": IDS_ONLY_FIELD_MASK },
          body: JSON.stringify(body),
        });
        if (res.status === 429) throw new Error("Places rate limited (429)");
        if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json() as Promise<{ places?: { id: string }[]; nextPageToken?: string }>;
      });
      for (const p of data.places ?? []) if (p.id) ids.push(p.id);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return ids.slice(0, maxResults);
  }

  async getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null> {
    const key = await requireKey();
    return withBudget("google", async () => {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK },
      });
      if (res.status === 404) return null;
      if (res.status === 429) throw new Error("Places rate limited (429)");
      if (!res.ok) throw new Error(`Place details HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return mapPlace((await res.json()) as PlacesApiPlace);
    });
  }
```

In `src/lib/providers/fake.ts` `FakeDiscoveryProvider`:
- Add `calls = { searchCategory: 0, searchCategoryIds: 0, getPlaceDetails: 0 };` and increment in each method.
- Refactor so the existing generated list lives in a private `generate(rawQuery)` method (the exact-match branch and the generic branch unchanged); `searchCategory` returns `this.generate(q)`.
- `searchCategoryIds(q)` returns `this.generate(q).map((b) => b.placeId)` and caches every generated business in a private `Map<string, DiscoveredBusiness>` (`this.known`).
- `getPlaceDetails(id)` returns `this.known.get(id) ?? null`; if the id is not known (a test calls details directly), regenerate by parsing the slug from the id is unnecessary — return null.

- [ ] **Step 4: Run the unit test, then rewire the zip search job**

```bash
npm test -- tests/unit/providers/googleIds
```

Expected: PASS.

In `src/lib/jobs/zipSearch.ts` replace `discover()` with an ID-first version:

```ts
type Found = { biz: DiscoveredBusiness; category: string };

/** Per category: IDs-only search; details only for places we don't have or haven't refreshed recently. */
async function discover(searchId: string, ownerId: string, zip: string, center: { lat: number; lng: number }, radius: number, deps: ZipSearchDeps, done: string[]) {
  const idsByCategory = new Map<string, string>(); // placeId -> first surfacing category
  for (let i = 0; i < CATEGORIES.length; i++) {
    await checkPause(deps);
    const c = CATEGORIES[i];
    await setProgress(searchId, { step: "discover", current: i + 1, total: CATEGORIES.length, message: c.label, doneSteps: done });
    const ids = await deps.providers.discovery.searchCategoryIds(`${c.query} in ${zip}`, center, radius);
    for (const id of ids) if (id && !idsByCategory.has(id)) idsByCategory.set(id, c.slug);
  }

  const refreshBefore = new Date(Date.now() - DISCOVERY_CONFIG.detailsRefreshDays * 86_400_000);
  const existing = await prisma.business.findMany({
    where: { ownerId, googlePlaceId: { in: [...idsByCategory.keys()] } },
    select: { googlePlaceId: true, googleFetchedAt: true },
  });
  const fresh = new Set(existing.filter((b) => b.googleFetchedAt && b.googleFetchedAt > refreshBefore).map((b) => b.googlePlaceId!));
  const known = new Set(existing.map((b) => b.googlePlaceId!));

  const found = new Map<string, Found>();
  const toFetch = [...idsByCategory.keys()].filter((id) => !fresh.has(id));
  let n = 0;
  for (const id of toFetch) {
    await checkPause(deps);
    n++;
    await setProgress(searchId, { step: "details", current: n, total: toFetch.length, doneSteps: done });
    const biz = await deps.providers.discovery.getPlaceDetails(id);
    if (biz && biz.name) found.set(id, { biz, category: idsByCategory.get(id)! });
  }
  return { found, knownFresh: [...idsByCategory.keys()].filter((id) => fresh.has(id) && known.has(id)).map((id) => ({ placeId: id, category: idsByCategory.get(id)! })) };
}
```

Then in `runZipSearch`'s discovery block, call `const { found, knownFresh } = await discover(searchId, ownerId, search.zip, center, radius, deps, done);`, pass both to `upsertBusinesses(searchId, ownerId, found, knownFresh)`. In `upsertBusinesses`:
- For each entry of `found`: as before, but the update/create data includes `googleFetchedAt: new Date()`.
- For each `{ placeId, category }` in `knownFresh`: load the business by `ownerId_googlePlaceId`, push its id, upsert the `SearchBusiness` link with `surfacedByCategory: category`, and (if `primaryCategory` is null) set it; no Google fields touched, no phone contact re-upsert needed (already there).
- Same-name counting for exclusion uses the `found` entries only (known businesses keep their existing exclusion).
Add `import { DISCOVERY_CONFIG } from "@/lib/config/discovery";`. Add `"details"` to the Searches page `STEP_LABELS` in `src/components/searches/SearchList.tsx` as `"Fetching place details"`.

- [ ] **Step 5: DB tests**

Create `tests/db/zipSearchIds.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

function makeProviders() {
  const discovery = new FakeDiscoveryProvider();
  return { discovery, providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher } };
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.tag.createMany({ data: CATEGORIES.map((c) => ({ ownerId: "local-user", name: c.slug, isSystem: true })) });
});

describe("zip search with ID-only discovery", () => {
  it("fetches details once per place and skips them on a fresh re-run", async () => {
    const a = makeProviders();
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s1.id, { providers: a.providers });
    const total = CATEGORIES.length * 2 + 1;
    expect(a.discovery.calls.searchCategoryIds).toBe(CATEGORIES.length);
    expect(a.discovery.calls.getPlaceDetails).toBe(total);
    expect(a.discovery.calls.searchCategory).toBe(0);
    expect(await prisma.business.count({ where: { googleFetchedAt: { not: null } } })).toBe(total);

    const b = makeProviders();
    const s2 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s2.id, { providers: b.providers });
    expect(b.discovery.calls.searchCategoryIds).toBe(CATEGORIES.length);
    expect(b.discovery.calls.getPlaceDetails).toBe(0);
    expect(await prisma.searchBusiness.count({ where: { searchId: s2.id } })).toBe(total);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: s2.id } })).countsFound).toBe(total);
  });

  it("re-fetches details for a stale place", async () => {
    const a = makeProviders();
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s1.id, { providers: a.providers });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.business.updateMany({ where: { name: "restaurant One" }, data: { googleFetchedAt: old } });
    const b = makeProviders();
    const s2 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s2.id, { providers: b.providers });
    expect(b.discovery.calls.getPlaceDetails).toBe(1);
    const r = await prisma.business.findFirstOrThrow({ where: { name: "restaurant One" } });
    expect(r.googleFetchedAt!.getTime()).toBeGreaterThan(old.getTime());
  });
});
```

Update `tests/db/zipSearch.test.ts` only where its assertions depend on `searchCategory` being the discovery call (none should; it asserts DB state). Run:

```bash
npm run test:db
npm test
npx tsc --noEmit
npm run lint
```

Expected: all green; the Plan 1 zip search DB test still passes with the same counts.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ID-only Places discovery with details fetched only for new or stale places

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Scanner core — window, planner, tick job, website re-check, queues, worker cron

**Files:**
- Create: `src/lib/scanner/window.ts`, `src/lib/scanner/planner.ts`, `src/lib/scanner/state.ts`, `src/lib/scanner/tick.ts`, `src/lib/jobs/websiteRecheck.ts`, `tests/unit/scanner/window.test.ts`, `tests/unit/scanner/planner.test.ts`, `tests/db/scannerTick.test.ts`, `tests/db/websiteRecheck.test.ts`, a Prisma migration
- Modify: `prisma/schema.prisma`, `src/lib/jobs/queues.ts`, `src/lib/jobs/enqueue.ts`, `src/worker/index.ts`, `src/lib/config/projects.ts`

**Interfaces:**
- Consumes: `checkPause`, `scannerPauseCheck`, `JobDeps` (Task 2); `scrapeOne`, `validateEmails`, `recomputeContactQuality` (`zipSearch.ts`); `readSync`, `isSyncRunning`, `SYNC_KEYS` (`syncStatus.ts`); `budgetStatus` (`budget.ts`); `PROJECT_CONFIG.highFitThreshold`; `getActor`.
- Produces:
  - Schema: `ScannerState.backoffUntil DateTime?`, `ScannerState.consecutiveFailures Int @default(0)`, `ScannerState.skipUntil Json?` (map item-key → ISO time); migration `scanner_fields`.
  - `QUEUES.scannerTick = "scanner-tick"`, `QUEUES.websiteRecheck = "website-recheck"`; `ZipSearchJobData = { searchId: string; origin?: "manual" | "scanner" }`; `WebsiteRecheckJobData = { businessIds: string[]; ownerId: string }`; `ScannerTickJobData = Record<string, never>`; `QUEUE_OPTIONS` entries for both (tick 300 s, recheck 3600 s).
  - `enqueueZipSearch(searchId, { priority?, origin? })`, `enqueueWebsiteRecheck(businessIds, ownerId): Promise<boolean>`, `enqueueScannerTick(): Promise<boolean>` (singletonKey `"scanner-tick"`).
  - `type WindowInput = { enabled: boolean; windowStart: Date | null; windowEnd: Date | null; dailyStartTime: string | null; dailyEndTime: string | null; daysOfWeek: number[]; timezone: string }`; `localParts(now: Date, tz: string): { weekday: number; minutes: number }`; `isWithinWindow(s: WindowInput, now?: Date): { ok: boolean; reason?: "disabled" | "before_start" | "after_end" | "day_off" | "outside_daily" }`
  - `type PlannerInput = { now: Date; schedule: { tdlrSyncHours: number; zipRefreshDays: number; websiteRecheckDays: number; maxConcurrentJobs: number }; tdlrLastSuccessfulAt: Date | null; tdlrRunning: boolean; runningScannerJobs: number; pausedSearch: { id: string; zip: string } | null; targets: { id: string; zip: string; priority: number; paused: boolean; lastSearchedAt: Date | null }[]; staleBusinessIds: string[]; skipUntil: Record<string, string> }`
  - `type Work = { kind: "busy" } | { kind: "tdlr_sync" } | { kind: "resume_search"; searchId: string; zip: string } | { kind: "zip_search"; targetId: string; zip: string } | { kind: "website_recheck"; businessIds: string[] } | { kind: "idle"; nextDueAt: Date | null; reason: string }`; `pickNextWork(i: PlannerInput): Work`; `workKey(w: Work): string | null` (`"tdlr"`, `zip:<zip>`, `"website_recheck"`)
  - `readScanner(ownerId)` → `{ schedule: ScanSchedule; state: ScannerState; targets: ScanTarget[] }` (creates default rows if missing); `logScanner(ownerId, message)` (ActivityLog kind `scanner`).
  - `type TickDeps = { now?: () => Date; enqueue?: { zipSearch(searchId: string, opts: { priority: number; origin: "scanner" }): Promise<boolean>; tdlrSync(): Promise<boolean>; websiteRecheck(ids: string[], ownerId: string): Promise<boolean> } }`; `runScannerTick(deps?: TickDeps): Promise<{ status: ScannerStatus; work: Work | null }>`
  - `runWebsiteRecheck(businessIds: string[], ownerId: string, deps: JobDeps): Promise<{ rechecked: number }>`
  - `SCANNER_CONFIG = { tickMinutes: 5, recheckBatchSize: 25, failureSkipHours: 6, maxConsecutiveFailures: 3, hotZipPriority: 100 }` in `src/lib/config/projects.ts`… no: in a new `src/lib/config/scanner.ts`.

- [ ] **Step 1: Schema, config, queues**

`prisma/schema.prisma` `model ScannerState` add:

```prisma
  backoffUntil        DateTime?
  consecutiveFailures Int       @default(0)
  skipUntil           Json?
```

```bash
npx prisma migrate dev --name scanner_fields --skip-seed
npx prisma generate
```

Create `src/lib/config/scanner.ts`:

```ts
export const SCANNER_CONFIG = {
  tickMinutes: 5,
  recheckBatchSize: 25,
  failureSkipHours: 6,
  maxConsecutiveFailures: 3,
  hotZipPriority: 100,
} as const;
```

Replace `src/lib/jobs/queues.ts`:

```ts
export const QUEUES = {
  zipSearch: "zip-search",
  tdlrSync: "tdlr-sync",
  promote: "promote",
  promoteBatch: "promote-batch",
  websiteRecheck: "website-recheck",
  scannerTick: "scanner-tick",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// A real 12-month Houston TDLR backfill is ~2.5–4k detail fetches at 1 req/s (45–70 min),
// so sync/batch get six hours; the tick is tiny and must never overlap itself.
export const QUEUE_OPTIONS: Record<QueueName, { expireInSeconds: number }> = {
  [QUEUES.zipSearch]: { expireInSeconds: 3600 },
  [QUEUES.tdlrSync]: { expireInSeconds: 6 * 3600 },
  [QUEUES.promote]: { expireInSeconds: 3600 },
  [QUEUES.promoteBatch]: { expireInSeconds: 6 * 3600 },
  [QUEUES.websiteRecheck]: { expireInSeconds: 3600 },
  [QUEUES.scannerTick]: { expireInSeconds: 300 },
};

export type JobOrigin = "manual" | "scanner";
export type ZipSearchJobData = { searchId: string; origin?: JobOrigin };
export type TdlrSyncJobData = Record<string, never>;
export type PromoteJobData = { businessId: string; ownerId: string };
export type PromoteBatchJobData = Record<string, never>;
export type WebsiteRecheckJobData = { businessIds: string[]; ownerId: string };
export type ScannerTickJobData = Record<string, never>;
```

(Typing `QUEUE_OPTIONS` by `QueueName` makes a missing entry a compile error — the Plan 2 reviewer's note.)

- [ ] **Step 2: Failing unit tests for window and planner**

Create `tests/unit/scanner/window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isWithinWindow, localParts } from "@/lib/scanner/window";

const base = { enabled: true, windowStart: null, windowEnd: null, dailyStartTime: null, dailyEndTime: null, daysOfWeek: [] as number[], timezone: "America/Chicago" };
// 2026-09-16 is a Wednesday. 15:00 UTC = 10:00 CDT.
const wedMorning = new Date("2026-09-16T15:00:00Z");

describe("localParts", () => {
  it("converts to the schedule's timezone", () => {
    expect(localParts(wedMorning, "America/Chicago")).toEqual({ weekday: 3, minutes: 600 });
    expect(localParts(new Date("2026-09-17T04:30:00Z"), "America/Chicago")).toEqual({ weekday: 3, minutes: 23 * 60 + 30 });
  });
});

describe("isWithinWindow", () => {
  it("is off when disabled", () => {
    expect(isWithinWindow({ ...base, enabled: false }, wedMorning)).toEqual({ ok: false, reason: "disabled" });
  });
  it("honors absolute start and end", () => {
    expect(isWithinWindow({ ...base, windowStart: new Date("2026-09-17T00:00:00Z") }, wedMorning)).toEqual({ ok: false, reason: "before_start" });
    expect(isWithinWindow({ ...base, windowEnd: new Date("2026-09-16T00:00:00Z") }, wedMorning)).toEqual({ ok: false, reason: "after_end" });
    expect(isWithinWindow({ ...base, windowStart: new Date("2026-09-01T00:00:00Z"), windowEnd: new Date("2026-12-31T00:00:00Z") }, wedMorning).ok).toBe(true);
  });
  it("honors days of week in local time", () => {
    expect(isWithinWindow({ ...base, daysOfWeek: [1, 2, 4, 5] }, wedMorning)).toEqual({ ok: false, reason: "day_off" });
    expect(isWithinWindow({ ...base, daysOfWeek: [3] }, wedMorning).ok).toBe(true);
  });
  it("honors daily hours in local time, including an overnight range", () => {
    expect(isWithinWindow({ ...base, dailyStartTime: "06:00", dailyEndTime: "22:00" }, wedMorning).ok).toBe(true);
    expect(isWithinWindow({ ...base, dailyStartTime: "11:00", dailyEndTime: "22:00" }, wedMorning)).toEqual({ ok: false, reason: "outside_daily" });
    // 22:00–06:00 overnight: 10:00 is outside, 23:30 is inside
    expect(isWithinWindow({ ...base, dailyStartTime: "22:00", dailyEndTime: "06:00" }, wedMorning).ok).toBe(false);
    expect(isWithinWindow({ ...base, dailyStartTime: "22:00", dailyEndTime: "06:00" }, new Date("2026-09-17T04:30:00Z")).ok).toBe(true);
  });
  it("is open with no constraints", () => {
    expect(isWithinWindow(base, wedMorning)).toEqual({ ok: true });
  });
});
```

Create `tests/unit/scanner/planner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickNextWork, workKey, type PlannerInput } from "@/lib/scanner/planner";

const now = new Date("2026-09-16T15:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const d = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base: PlannerInput = {
  now,
  schedule: { tdlrSyncHours: 6, zipRefreshDays: 7, websiteRecheckDays: 30, maxConcurrentJobs: 1 },
  tdlrLastSuccessfulAt: h(1),
  tdlrRunning: false,
  runningScannerJobs: 0,
  pausedSearch: null,
  targets: [],
  staleBusinessIds: [],
  skipUntil: {},
};

describe("pickNextWork", () => {
  it("is busy when the concurrency cap is reached", () => {
    expect(pickNextWork({ ...base, runningScannerJobs: 1 })).toEqual({ kind: "busy" });
  });
  it("prefers a due TDLR sync", () => {
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: h(7), targets: [{ id: "t", zip: "77084", priority: 0, paused: false, lastSearchedAt: null }] })).toEqual({ kind: "tdlr_sync" });
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: null }).kind).toBe("tdlr_sync");
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: h(7), tdlrRunning: true }).kind).toBe("idle");
  });
  it("resumes a paused scanner search before starting new ones", () => {
    expect(pickNextWork({ ...base, pausedSearch: { id: "s1", zip: "77084" }, targets: [{ id: "t", zip: "77005", priority: 9, paused: false, lastSearchedAt: null }] })).toEqual({ kind: "resume_search", searchId: "s1", zip: "77084" });
  });
  it("picks the highest-priority due target, oldest search first on ties, skipping paused", () => {
    const targets = [
      { id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: d(10) },
      { id: "b", zip: "77002", priority: 5, paused: true, lastSearchedAt: null },
      { id: "c", zip: "77003", priority: 5, paused: false, lastSearchedAt: d(8) },
      { id: "d", zip: "77004", priority: 5, paused: false, lastSearchedAt: d(9) },
      { id: "e", zip: "77005", priority: 9, paused: false, lastSearchedAt: d(2) },
    ];
    expect(pickNextWork({ ...base, targets })).toEqual({ kind: "zip_search", targetId: "d", zip: "77004" });
  });
  it("honors per-item skips", () => {
    const targets = [{ id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: null }];
    const skipUntil = { "zip:77001": new Date(now.getTime() + 3_600_000).toISOString() };
    expect(pickNextWork({ ...base, targets, skipUntil }).kind).toBe("idle");
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: null, skipUntil: { tdlr: new Date(now.getTime() + 60_000).toISOString() } }).kind).toBe("idle");
  });
  it("falls back to a website re-check batch", () => {
    expect(pickNextWork({ ...base, staleBusinessIds: ["b1", "b2"] })).toEqual({ kind: "website_recheck", businessIds: ["b1", "b2"] });
  });
  it("reports the next due time when idle", () => {
    const w = pickNextWork({ ...base, tdlrLastSuccessfulAt: h(1), targets: [{ id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: d(3) }] });
    expect(w.kind).toBe("idle");
    if (w.kind === "idle") {
      // tdlr due in 5 h, zip due in 4 d → next is the tdlr sync
      expect(w.nextDueAt?.toISOString()).toBe(new Date(now.getTime() + 5 * 3_600_000).toISOString());
    }
  });
  it("derives stable keys", () => {
    expect(workKey({ kind: "tdlr_sync" })).toBe("tdlr");
    expect(workKey({ kind: "zip_search", targetId: "a", zip: "77001" })).toBe("zip:77001");
    expect(workKey({ kind: "resume_search", searchId: "s", zip: "77001" })).toBe("zip:77001");
    expect(workKey({ kind: "website_recheck", businessIds: [] })).toBe("website_recheck");
    expect(workKey({ kind: "idle", nextDueAt: null, reason: "" })).toBeNull();
  });
});
```

Run `npm test -- tests/unit/scanner` — expect FAIL.

- [ ] **Step 3: Implement window.ts and planner.ts**

Create `src/lib/scanner/window.ts`:

```ts
export type WindowInput = {
  enabled: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  daysOfWeek: number[];
  timezone: string;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) and minutes since local midnight in the given IANA timezone. */
export function localParts(now: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: WEEKDAYS[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWithinWindow(
  s: WindowInput,
  now: Date = new Date(),
): { ok: boolean; reason?: "disabled" | "before_start" | "after_end" | "day_off" | "outside_daily" } {
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (s.windowStart && now < s.windowStart) return { ok: false, reason: "before_start" };
  if (s.windowEnd && now > s.windowEnd) return { ok: false, reason: "after_end" };
  const { weekday, minutes } = localParts(now, s.timezone || "UTC");
  if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(weekday)) return { ok: false, reason: "day_off" };
  const start = s.dailyStartTime ? toMinutes(s.dailyStartTime) : null;
  const end = s.dailyEndTime ? toMinutes(s.dailyEndTime) : null;
  if (start != null && end != null) {
    const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (!inside) return { ok: false, reason: "outside_daily" };
  } else if (start != null && minutes < start) {
    return { ok: false, reason: "outside_daily" };
  } else if (end != null && minutes >= end) {
    return { ok: false, reason: "outside_daily" };
  }
  return { ok: true };
}
```

Create `src/lib/scanner/planner.ts`:

```ts
export type PlannerTarget = { id: string; zip: string; priority: number; paused: boolean; lastSearchedAt: Date | null };

export type PlannerInput = {
  now: Date;
  schedule: { tdlrSyncHours: number; zipRefreshDays: number; websiteRecheckDays: number; maxConcurrentJobs: number };
  tdlrLastSuccessfulAt: Date | null;
  tdlrRunning: boolean;
  runningScannerJobs: number;
  pausedSearch: { id: string; zip: string } | null;
  targets: PlannerTarget[];
  staleBusinessIds: string[];
  skipUntil: Record<string, string>;
};

export type Work =
  | { kind: "busy" }
  | { kind: "tdlr_sync" }
  | { kind: "resume_search"; searchId: string; zip: string }
  | { kind: "zip_search"; targetId: string; zip: string }
  | { kind: "website_recheck"; businessIds: string[] }
  | { kind: "idle"; nextDueAt: Date | null; reason: string };

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function workKey(w: Work): string | null {
  switch (w.kind) {
    case "tdlr_sync":
      return "tdlr";
    case "zip_search":
    case "resume_search":
      return `zip:${w.zip}`;
    case "website_recheck":
      return "website_recheck";
    default:
      return null;
  }
}

function skipped(i: PlannerInput, key: string): boolean {
  const until = i.skipUntil[key];
  return !!until && Date.parse(until) > i.now.getTime();
}

export function pickNextWork(i: PlannerInput): Work {
  if (i.runningScannerJobs >= i.schedule.maxConcurrentJobs) return { kind: "busy" };
  const t = i.now.getTime();
  const candidates: Date[] = [];

  // 1. TDLR sync
  const tdlrDueAt = i.tdlrLastSuccessfulAt ? new Date(i.tdlrLastSuccessfulAt.getTime() + i.schedule.tdlrSyncHours * HOUR) : i.now;
  if (!i.tdlrRunning && !skipped(i, "tdlr")) {
    if (tdlrDueAt.getTime() <= t) return { kind: "tdlr_sync" };
    candidates.push(tdlrDueAt);
  }

  // 2. Resume a paused scanner search
  if (i.pausedSearch && !skipped(i, `zip:${i.pausedSearch.zip}`)) {
    return { kind: "resume_search", searchId: i.pausedSearch.id, zip: i.pausedSearch.zip };
  }

  // 3. Highest-priority due target; ties → oldest (null first)
  const ordered = [...i.targets]
    .filter((x) => !x.paused && !skipped(i, `zip:${x.zip}`))
    .sort((a, b) => b.priority - a.priority || (a.lastSearchedAt?.getTime() ?? 0) - (b.lastSearchedAt?.getTime() ?? 0));
  for (const target of ordered) {
    const dueAt = target.lastSearchedAt ? new Date(target.lastSearchedAt.getTime() + i.schedule.zipRefreshDays * DAY) : i.now;
    if (dueAt.getTime() <= t) return { kind: "zip_search", targetId: target.id, zip: target.zip };
    candidates.push(dueAt);
  }

  // 4. Website re-checks
  if (i.staleBusinessIds.length > 0 && !skipped(i, "website_recheck")) {
    return { kind: "website_recheck", businessIds: i.staleBusinessIds };
  }

  const nextDueAt = candidates.length ? new Date(Math.min(...candidates.map((c) => c.getTime()))) : null;
  return { kind: "idle", nextDueAt, reason: nextDueAt ? "waiting for the next due item" : "nothing scheduled" };
}
```

Run `npm test -- tests/unit/scanner` — expect PASS (7 + 8 tests).

- [ ] **Step 4: Website re-check job and state helpers**

Create `src/lib/jobs/websiteRecheck.ts`:

```ts
import { prisma } from "@/lib/db";
import { checkPause, type JobDeps } from "./shared";
import { recomputeContactQuality, scrapeOne, validateEmails } from "./zipSearch";

/** Re-scrape and re-validate a batch of businesses whose website check is stale. */
export async function runWebsiteRecheck(businessIds: string[], ownerId: string, deps: JobDeps): Promise<{ rechecked: number }> {
  let rechecked = 0;
  for (const id of businessIds) {
    await checkPause(deps);
    const b = await prisma.business.findFirst({ where: { id, ownerId }, select: { id: true, websiteUrl: true } });
    if (!b) continue;
    if (b.websiteUrl) {
      try {
        await scrapeOne(id, ownerId, deps);
      } catch (e) {
        await prisma.business.update({ where: { id }, data: { websiteReachable: false, websiteError: (e as Error).message, websiteCheckedAt: new Date() } });
      }
    } else {
      await prisma.business.update({ where: { id }, data: { websiteCheckedAt: new Date() } });
    }
    rechecked++;
  }
  await validateEmails(businessIds, deps);
  for (const id of businessIds) await recomputeContactQuality(id);
  deps.log?.(`website recheck: ${rechecked} businesses`);
  return { rechecked };
}
```

Create `src/lib/scanner/state.ts`:

```ts
import { prisma } from "@/lib/db";
import type { Prisma, ScannerStatus } from "@prisma/client";

export async function readScanner(ownerId: string) {
  const [schedule, state, targets] = await Promise.all([
    prisma.scanSchedule.upsert({ where: { ownerId }, update: {}, create: { ownerId } }),
    prisma.scannerState.upsert({ where: { ownerId }, update: {}, create: { ownerId } }),
    prisma.scanTarget.findMany({ where: { ownerId }, orderBy: [{ priority: "desc" }, { zip: "asc" }] }),
  ]);
  return { schedule, state, targets };
}

export type NextPlanned = { kind: string; at: string | null; detail?: string };

export async function setScannerState(
  ownerId: string,
  data: {
    status?: ScannerStatus;
    currentJobId?: string | null;
    currentActivity?: string | null;
    nextPlanned?: NextPlanned | null;
    lastError?: string | null;
    lastTickAt?: Date;
    backoffUntil?: Date | null;
    consecutiveFailures?: number;
    skipUntil?: Record<string, string>;
  },
) {
  const { nextPlanned, skipUntil, ...rest } = data;
  await prisma.scannerState.update({
    where: { ownerId },
    data: {
      ...rest,
      ...(nextPlanned !== undefined && { nextPlanned: (nextPlanned ?? Prisma.JsonNull) as Prisma.InputJsonValue }),
      ...(skipUntil !== undefined && { skipUntil: skipUntil as Prisma.InputJsonValue }),
    },
  });
}

export async function logScanner(ownerId: string, message: string) {
  await prisma.activityLog.create({ data: { ownerId, kind: "scanner", message } });
}
```

If `Prisma.JsonNull` typing complains for a nullable Json column, use `nextPlanned === null ? Prisma.DbNull : nextPlanned` — either clears the column.

- [ ] **Step 5: The tick**

Create `src/lib/scanner/tick.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { SCANNER_CONFIG } from "@/lib/config/scanner";
import { budgetStatus } from "@/lib/providers/budget";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { enqueueTdlrSync, enqueueWebsiteRecheck, enqueueZipSearch, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";
import { isWithinWindow } from "./window";
import { pickNextWork, workKey, type Work } from "./planner";
import { logScanner, readScanner, setScannerState } from "./state";
import type { ScannerStatus } from "@prisma/client";

export type TickDeps = {
  now?: () => Date;
  enqueue?: {
    zipSearch(searchId: string, opts: { priority: number; origin: "scanner" }): Promise<boolean>;
    tdlrSync(): Promise<boolean>;
    websiteRecheck(ids: string[], ownerId: string): Promise<boolean>;
  };
};

const defaultEnqueue: NonNullable<TickDeps["enqueue"]> = {
  zipSearch: async (id, opts) => enqueueZipSearch(id, opts),
  tdlrSync: () => enqueueTdlrSync(),
  websiteRecheck: (ids, ownerId) => enqueueWebsiteRecheck(ids, ownerId),
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function describe(w: Work): string {
  switch (w.kind) {
    case "tdlr_sync": return "TDLR sync";
    case "zip_search": return `Zip search ${w.zip}`;
    case "resume_search": return `Resuming zip search ${w.zip}`;
    case "website_recheck": return `Re-checking ${w.businessIds.length} websites`;
    case "busy": return "Waiting for the running job";
    case "idle": return w.reason;
  }
}

/** One Scanner tick: decide state, enqueue at most one item, record status. Safe to call every 5 minutes. */
export async function runScannerTick(deps: TickDeps = {}): Promise<{ status: ScannerStatus; work: Work | null }> {
  const now = deps.now ? deps.now() : new Date();
  const enqueue = deps.enqueue ?? defaultEnqueue;
  const { id: ownerId } = await getActor();
  const { schedule, state, targets } = await readScanner(ownerId);
  const finish = async (status: ScannerStatus, extra: Parameters<typeof setScannerState>[1] = {}, work: Work | null = null) => {
    await setScannerState(ownerId, { status, lastTickAt: now, ...extra });
    return { status, work };
  };

  // Failure accounting: scanner-origin searches that failed since the last tick.
  const since = state.lastTickAt ?? new Date(0);
  const failed = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: "failed", updatedAt: { gt: since } }, select: { zip: true, error: true } });
  const completed = await prisma.search.count({ where: { ownerId, origin: "scanner", status: "complete", updatedAt: { gt: since } } });
  let consecutiveFailures = completed > 0 ? 0 : state.consecutiveFailures;
  const skipUntil: Record<string, string> = { ...((state.skipUntil as Record<string, string> | null) ?? {}) };
  for (const k of Object.keys(skipUntil)) if (Date.parse(skipUntil[k]) <= now.getTime()) delete skipUntil[k];
  let lastError = state.lastError;
  for (const f of failed) {
    consecutiveFailures++;
    skipUntil[`zip:${f.zip}`] = new Date(now.getTime() + SCANNER_CONFIG.failureSkipHours * HOUR).toISOString();
    lastError = f.error ?? "search failed";
    await logScanner(ownerId, `Zip search ${f.zip} failed: ${lastError}; skipping it for ${SCANNER_CONFIG.failureSkipHours} h`);
  }
  if (consecutiveFailures >= SCANNER_CONFIG.maxConsecutiveFailures) {
    await prisma.scannerState.update({ where: { ownerId }, data: { pauseRequested: true } });
    await logScanner(ownerId, `Paused after ${consecutiveFailures} consecutive failures: ${lastError}`);
    return finish("paused", { consecutiveFailures: 0, skipUntil, lastError, currentActivity: null, nextPlanned: null });
  }

  if (!schedule.enabled) return finish("disabled", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures });
  const win = isWithinWindow(schedule, now);
  if (!win.ok) return finish("outside_window", { currentActivity: null, nextPlanned: { kind: "window", at: schedule.windowStart?.toISOString() ?? null, detail: win.reason }, skipUntil, consecutiveFailures });
  if (state.pauseRequested) return finish("paused", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures });

  const budget = await budgetStatus("google");
  if (budget.exhausted) return finish("budget_exhausted", { currentActivity: `Google budget used ${budget.used}/${budget.limit}; resets at midnight`, nextPlanned: null, skipUntil, consecutiveFailures });

  // Hot zips from TDLR projects
  if (schedule.autoAddHotZips) {
    const hot = await prisma.project.findMany({
      where: { ownerId, exclusion: "none", smbFitScore: { gte: PROJECT_CONFIG.highFitThreshold }, timingWindow: { in: ["opening_soon", "under_construction"] }, zip: { not: null } },
      select: { zip: true },
      distinct: ["zip"],
    });
    for (const p of hot) {
      await prisma.scanTarget.upsert({
        where: { ownerId_zip: { ownerId, zip: p.zip! } },
        update: {},
        create: { ownerId, zip: p.zip!, priority: SCANNER_CONFIG.hotZipPriority, addedBy: "auto_tdlr" },
      });
    }
  }

  // Running work
  const running = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: { in: ["queued", "running"] } }, select: { id: true, zip: true, progress: true } });
  const tdlr = await readSync(SYNC_KEYS.tdlr);
  const tdlrRunning = isSyncRunning(tdlr.cursor, now);
  const runningScannerJobs = running.length + (tdlrRunning && state.currentJobId === "tdlr" ? 1 : 0);
  const pausedSearch = await prisma.search.findFirst({ where: { ownerId, origin: "scanner", status: "paused" }, select: { id: true, zip: true }, orderBy: { updatedAt: "asc" } });
  const staleBefore = new Date(now.getTime() - schedule.websiteRecheckDays * DAY);
  const stale = await prisma.business.findMany({
    where: { ownerId, exclusion: "none", websiteUrl: { not: null }, OR: [{ websiteCheckedAt: null }, { websiteCheckedAt: { lt: staleBefore } }] },
    select: { id: true },
    orderBy: { websiteCheckedAt: "asc" },
    take: SCANNER_CONFIG.recheckBatchSize,
  });
  const freshTargets = await prisma.scanTarget.findMany({ where: { ownerId }, select: { id: true, zip: true, priority: true, paused: true, lastSearchedAt: true } });

  const work = pickNextWork({
    now,
    schedule,
    tdlrLastSuccessfulAt: tdlr.lastSuccessfulAt,
    tdlrRunning,
    runningScannerJobs,
    pausedSearch,
    targets: freshTargets.length ? freshTargets : targets,
    staleBusinessIds: stale.map((b) => b.id),
    skipUntil,
  });

  if (work.kind === "busy") {
    const cur = running[0];
    const p = (cur?.progress as { step?: string; current?: number; total?: number } | null) ?? null;
    const activity = cur ? `Zip search ${cur.zip}${p?.step ? `: ${p.step}` : ""}${p?.total ? ` ${p.current ?? 0}/${p.total}` : ""}` : "TDLR sync running";
    return finish("running", { currentActivity: activity, currentJobId: cur?.id ?? state.currentJobId, nextPlanned: null, skipUntil, consecutiveFailures }, work);
  }
  if (work.kind === "idle") {
    return finish("idle", { currentActivity: null, currentJobId: null, nextPlanned: { kind: "next", at: work.nextDueAt?.toISOString() ?? null, detail: work.reason }, skipUntil, consecutiveFailures }, work);
  }

  let queued = false;
  let jobId: string | null = null;
  if (work.kind === "tdlr_sync") {
    queued = await enqueue.tdlrSync();
    jobId = "tdlr";
  } else if (work.kind === "resume_search") {
    await prisma.search.update({ where: { id: work.searchId }, data: { status: "queued" } });
    queued = await enqueue.zipSearch(work.searchId, { priority: SCANNER_PRIORITY, origin: "scanner" });
    jobId = work.searchId;
  } else if (work.kind === "zip_search") {
    const search = await prisma.search.create({ data: { ownerId, zip: work.zip, origin: "scanner" } });
    await prisma.scanTarget.update({ where: { id: work.targetId }, data: { lastSearchedAt: now, lastSearchId: search.id } });
    queued = await enqueue.zipSearch(search.id, { priority: SCANNER_PRIORITY, origin: "scanner" });
    jobId = search.id;
  } else if (work.kind === "website_recheck") {
    queued = await enqueue.websiteRecheck(work.businessIds, ownerId);
    jobId = "website_recheck";
  }
  const key = workKey(work);
  if (key === "website_recheck") skipUntil[key] = new Date(now.getTime() + HOUR).toISOString(); // one batch per hour at most
  await logScanner(ownerId, `${describe(work)}${queued ? "" : " (already queued)"}`);
  return finish("running", { currentActivity: describe(work), currentJobId: jobId, nextPlanned: null, skipUntil, consecutiveFailures }, work);
}
```

- [ ] **Step 6: Enqueue helpers and worker**

In `src/lib/jobs/enqueue.ts`:
- Change `enqueueZipSearch` to `(searchId: string, opts: { priority?: number; origin?: JobOrigin } = {}): Promise<boolean>`; data `{ searchId, origin: opts.origin ?? "manual" }`; in inline mode, when `origin === "scanner"` pass `shouldPause: scannerPauseCheck((await getActor()).id)`; return `id !== null` (or `true` inline). Update the two existing callers (searches POST and rerun routes) — their `await enqueueZipSearch(search.id)` still works.
- Add:

```ts
export async function enqueueWebsiteRecheck(businessIds: string[], ownerId: string): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    void runWebsiteRecheck(businessIds, ownerId, { providers: getProviders(), log: console.log, shouldPause: scannerPauseCheck(ownerId) }).catch((e) => console.error("[inline website-recheck]", e));
    return true;
  }
  const boss = await getBoss();
  const data: WebsiteRecheckJobData = { businessIds, ownerId };
  const id = await boss.send(QUEUES.websiteRecheck, data, { retryLimit: 1, retryDelay: 60, priority: SCANNER_PRIORITY, singletonKey: "website-recheck" });
  return id !== null;
}

export async function enqueueScannerTick(): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    void runScannerTick().catch((e) => console.error("[inline scanner-tick]", e));
    return true;
  }
  const boss = await getBoss();
  const data: ScannerTickJobData = {};
  const id = await boss.send(QUEUES.scannerTick, data, { retryLimit: 0, priority: MANUAL_PRIORITY, singletonKey: "scanner-tick" });
  return id !== null;
}
```

(`runScannerTick` imports `enqueue.ts` and `enqueue.ts` imports `runScannerTick`: a cycle. Break it by having `enqueueScannerTick` import lazily: `const { runScannerTick } = await import("@/lib/scanner/tick");` inside the inline branch.)

In `src/worker/index.ts`:
- zip-search handler: load the search's owner and pass `shouldPause` for scanner-origin jobs:

```ts
  await boss.work<ZipSearchJobData>(QUEUES.zipSearch, { batchSize: 1 }, async ([job]) => {
    const { searchId, origin } = job.data;
    console.log(`[zip-search] start ${searchId} (${origin ?? "manual"})`);
    const search = await prisma.search.findUnique({ where: { id: searchId }, select: { ownerId: true } });
    const shouldPause = origin === "scanner" && search ? scannerPauseCheck(search.ownerId) : undefined;
    await runZipSearch(searchId, { providers: getProviders(), log: console.log, signal: job.signal, shouldPause });
    console.log(`[zip-search] done ${searchId}`);
  });
```

- Add handlers:

```ts
  await boss.work<WebsiteRecheckJobData>(QUEUES.websiteRecheck, { batchSize: 1 }, async ([job]) => {
    console.log(`[website-recheck] start ${job.data.businessIds.length}`);
    await runWebsiteRecheck(job.data.businessIds, job.data.ownerId, { providers: getProviders(), log: console.log, signal: job.signal, shouldPause: scannerPauseCheck(job.data.ownerId) });
    console.log(`[website-recheck] done`);
  });

  await boss.work<ScannerTickJobData>(QUEUES.scannerTick, { batchSize: 1 }, async () => {
    const r = await runScannerTick();
    console.log(`[scanner-tick] ${r.status}${r.work ? ` ${r.work.kind}` : ""}`);
  });
  await boss.schedule(QUEUES.scannerTick, "*/5 * * * *", {}, { tz: REGION.timezone, singletonKey: "scanner-tick" });
```

with imports `prisma`, `scannerPauseCheck`, `runWebsiteRecheck`, `runScannerTick`, `REGION`, and the two data types. Also make the tdlr-sync handler mark `ScannerState.currentJobId` irrelevant (no change) — the tick derives TDLR running state from `SyncState`.

- [ ] **Step 7: DB tests**

Create `tests/db/websiteRecheck.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runWebsiteRecheck } from "@/lib/jobs/websiteRecheck";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";

const providers = { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher };

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.business.deleteMany();
});

describe("runWebsiteRecheck", () => {
  it("re-scrapes, validates, and re-scores the batch", async () => {
    const b = await prisma.business.create({ data: { name: "Old Site", websiteUrl: "https://old-site.fake.test/", phone: "(713) 555-0100", contactQualityBand: "red" } });
    const dead = await prisma.business.create({ data: { name: "Dead", websiteUrl: "https://dead.old.fake.test/" } });
    const r = await runWebsiteRecheck([b.id, dead.id], "local-user", { providers });
    expect(r.rechecked).toBe(2);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id }, include: { contacts: true } });
    expect(after.websiteReachable).toBe(true);
    expect(after.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")).toBe(true);
    expect(after.contactQualityBand).toBe("green");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: dead.id } })).websiteReachable).toBe(false);
  });
  it("pauses between businesses", async () => {
    const b = await prisma.business.create({ data: { name: "X", websiteUrl: "https://x.fake.test/" } });
    let calls = 0;
    await expect(runWebsiteRecheck([b.id], "local-user", { providers, shouldPause: async () => ++calls > 0 })).rejects.toThrow(/paused/);
  });
});
```

Create `tests/db/scannerTick.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runScannerTick, type TickDeps } from "@/lib/scanner/tick";
import { writeSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

const OWNER = "local-user";
const now = new Date("2026-09-16T15:00:00Z"); // Wednesday 10:00 Central
const DAY = 86_400_000;

function spies() {
  const calls = { zip: [] as { searchId: string; opts: unknown }[], tdlr: 0, recheck: [] as string[][] };
  const enqueue: NonNullable<TickDeps["enqueue"]> = {
    zipSearch: async (searchId, opts) => { calls.zip.push({ searchId, opts }); return true; },
    tdlrSync: async () => { calls.tdlr++; return true; },
    websiteRecheck: async (ids) => { calls.recheck.push(ids); return true; },
  };
  return { calls, enqueue };
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
  await prisma.business.deleteMany();
  await prisma.project.deleteMany();
  await prisma.scanTarget.deleteMany();
  await prisma.scanSchedule.deleteMany();
  await prisma.scannerState.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.providerConfig.deleteMany();
  await writeSync(SYNC_KEYS.tdlr, { status: "idle" }, new Date(now.getTime() - 3_600_000)); // synced 1 h ago: not due
});

describe("runScannerTick", () => {
  it("is disabled until the schedule is enabled", async () => {
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("disabled");
    expect(calls.zip).toHaveLength(0);
  });

  it("reports outside_window when the daily hours exclude now", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true, dailyStartTime: "18:00", dailyEndTime: "22:00" } });
    const r = await runScannerTick({ now: () => now, enqueue: spies().enqueue });
    expect(r.status).toBe("outside_window");
  });

  it("starts the highest-priority due zip search with scanner origin and records it on the target", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.createMany({ data: [{ ownerId: OWNER, zip: "77001", priority: 1 }, { ownerId: OWNER, zip: "77084", priority: 5 }] });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toMatchObject({ kind: "zip_search", zip: "77084" });
    expect(calls.zip).toHaveLength(1);
    expect(calls.zip[0].opts).toEqual({ priority: 1, origin: "scanner" });
    const search = await prisma.search.findUniqueOrThrow({ where: { id: calls.zip[0].searchId } });
    expect(search.origin).toBe("scanner");
    const target = await prisma.scanTarget.findUniqueOrThrow({ where: { ownerId_zip: { ownerId: OWNER, zip: "77084" } } });
    expect(target.lastSearchId).toBe(search.id);
    expect(target.lastSearchedAt?.toISOString()).toBe(now.toISOString());
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentActivity).toBe("Zip search 77084");
    expect(await prisma.activityLog.count({ where: { kind: "scanner" } })).toBe(1);
  });

  it("is busy while a scanner search is running and idle when nothing is due", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77084", lastSearchedAt: new Date(now.getTime() - 2 * DAY) } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "running", progress: { step: "scrape", current: 3, total: 10, doneSteps: [] } } });
    const { calls, enqueue } = spies();
    let r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toEqual({ kind: "busy" });
    expect((await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } })).currentActivity).toBe("Zip search 77084: scrape 3/10");
    await prisma.search.updateMany({ data: { status: "complete" } });
    r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("idle");
    expect(calls.zip).toHaveLength(0);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    // TDLR synced 1 h ago with a 6 h interval → due in 5 h, sooner than the zip (due in 5 d).
    expect((state.nextPlanned as { at: string }).at).toBe(new Date(now.getTime() + 5 * 3_600_000).toISOString());
  });

  it("respects pauseRequested and resumes a paused search first", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    const paused = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "paused" } });
    const { calls, enqueue } = spies();
    expect((await runScannerTick({ now: () => now, enqueue })).status).toBe("paused");
    await prisma.scannerState.update({ where: { ownerId: OWNER }, data: { pauseRequested: false } });
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "resume_search", searchId: paused.id, zip: "77084" });
    expect(calls.zip[0].searchId).toBe(paused.id);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe("queued");
  });

  it("runs a due TDLR sync ahead of zip searches and auto-adds hot zips", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await writeSync(SYNC_KEYS.tdlr, { status: "idle" }, new Date(now.getTime() - 7 * 3_600_000));
    await prisma.project.create({ data: { ownerId: OWNER, projectNumber: "TABS1", projectName: "Hot Nails", zip: "77005", smbFitScore: 80, timingWindow: "opening_soon" } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "tdlr_sync" });
    expect(calls.tdlr).toBe(1);
    const hot = await prisma.scanTarget.findUniqueOrThrow({ where: { ownerId_zip: { ownerId: OWNER, zip: "77005" } } });
    expect(hot.addedBy).toBe("auto_tdlr");
    expect(hot.priority).toBe(100);
  });

  it("stops on budget exhaustion", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 1, usedToday: 1, usageDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) } });
    const { calls, enqueue } = spies();
    expect((await runScannerTick({ now: () => now, enqueue })).status).toBe("budget_exhausted");
    expect(calls.zip).toHaveLength(0);
  });

  it("skips a failed zip for 6 hours and pauses after three consecutive failures", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.createMany({ data: [{ ownerId: OWNER, zip: "77001", priority: 5 }, { ownerId: OWNER, zip: "77002", priority: 1 }] });
    await prisma.scannerState.create({ data: { ownerId: OWNER, lastTickAt: new Date(now.getTime() - 300_000) } });
    // updatedAt is set explicitly so the failure lands inside the fake clock's "since last tick" window.
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77001", origin: "scanner", status: "failed", error: "boom", updatedAt: new Date(now.getTime() - 60_000) } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toMatchObject({ kind: "zip_search", zip: "77002" });
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.consecutiveFailures).toBe(1);
    expect(Object.keys(state.skipUntil as object)).toContain("zip:77001");

    await prisma.scannerState.update({ where: { ownerId: OWNER }, data: { consecutiveFailures: 2, lastTickAt: now } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77002", origin: "scanner", status: "failed", error: "boom again", updatedAt: new Date(now.getTime() + 1000) } });
    const later = new Date(now.getTime() + 300_000);
    const r2 = await runScannerTick({ now: () => later, enqueue });
    expect(r2.status).toBe("paused");
    expect((await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } })).pauseRequested).toBe(true);
    expect(calls.zip).toHaveLength(1);
  });
});
```

Note: the "stops on budget exhaustion" test seeds `providerConfig` with `usageDate` = today in Central time so `budgetStatus` sees the row as exhausted regardless of the fake `now`.

```bash
npm run test:db
npm test
npx tsc --noEmit
npm run lint
```

Expected: all green. Worker smoke: `npm run worker` in the background prints `worker ready`; stop by PID.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Scanner core — window, planner, tick job with pause/backoff, website re-check job, cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Scanner API and paused-search resume

**Files:**
- Create: `src/lib/scanner/schedule.ts`, `src/app/api/scanner/route.ts`, `src/app/api/scanner/schedule/route.ts`, `src/app/api/scanner/pause/route.ts`, `src/app/api/scanner/resume/route.ts`, `src/app/api/scanner/stop/route.ts`, `src/app/api/scanner/run-now/route.ts`, `src/app/api/scanner/targets/route.ts`, `src/app/api/scanner/targets/[id]/route.ts`, `src/app/api/searches/[id]/resume/route.ts`, `tests/unit/scanner/schedule.test.ts`

**Interfaces:**
- Consumes: `readScanner`, `setScannerState`, `logScanner` (Task 4 state.ts); `isWithinWindow`; `budgetStatus`; `enqueueScannerTick`, `enqueueZipSearch`; `handle`, `json`, `parseJson`, `ApiError`; `getActor`.
- Produces:
  - `scheduleUpdateSchema` (zod) and `type ScheduleUpdate`; `applyScheduleUpdate(ownerId, update)` → `ScanSchedule`
  - HTTP:
    - `GET /api/scanner` → `{ state, schedule, targets, budget: { used, limit, exhausted }, window: { ok, reason? }, activity: ActivityLog[] (last 50, kind "scanner") }`
    - `PUT /api/scanner/schedule` `{ enabled?, windowStart?: ISO|null, windowEnd?: ISO|null, dailyStartTime?: "HH:mm"|null, dailyEndTime?: "HH:mm"|null, daysOfWeek?: number[], timezone?: string, zipRefreshDays?, tdlrSyncHours?, websiteRecheckDays?, autoAddHotZips?, maxConcurrentJobs? }` → `{ schedule }`
    - `POST /api/scanner/pause` → `{ state }`; `POST /api/scanner/resume` → `{ state, ticked: boolean }`; `POST /api/scanner/stop` → `{ state, schedule }`; `POST /api/scanner/run-now` → `202 { ticked: boolean }`
    - `GET /api/scanner/targets` → `{ items }`; `POST /api/scanner/targets { zip, priority? }` → `201 { target }`; `PATCH /api/scanner/targets/:id { priority?, paused? }` → `{ target }`; `DELETE /api/scanner/targets/:id` → `{ deleted: true }`
    - `POST /api/searches/:id/resume` → `202 { search }` (only for `paused` searches; re-enqueues the same id with its origin)

- [ ] **Step 1: Failing unit test for the schedule schema**

Create `tests/unit/scanner/schedule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scheduleUpdateSchema } from "@/lib/scanner/schedule";

describe("scheduleUpdateSchema", () => {
  it("accepts a full update and coerces dates", () => {
    const u = scheduleUpdateSchema.parse({
      enabled: true, windowStart: "2026-09-16T13:00:00.000Z", windowEnd: null, dailyStartTime: "06:00", dailyEndTime: "22:00",
      daysOfWeek: [1, 2, 3, 4, 5], timezone: "America/Chicago", zipRefreshDays: 7, tdlrSyncHours: 6, websiteRecheckDays: 30, autoAddHotZips: true, maxConcurrentJobs: 1,
    });
    expect(u.windowStart).toBeInstanceOf(Date);
    expect(u.windowEnd).toBeNull();
    expect(u.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });
  it("rejects bad times, days, timezones, and ranges", () => {
    expect(() => scheduleUpdateSchema.parse({ dailyStartTime: "6am" })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ daysOfWeek: [7] })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ timezone: "Mars/Olympus" })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ zipRefreshDays: 0 })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ maxConcurrentJobs: 3 })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ windowStart: "not a date" })).toThrow();
  });
  it("allows partial updates", () => {
    expect(scheduleUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});
```

Run `npm test -- tests/unit/scanner/schedule` — expect FAIL.

- [ ] **Step 2: Schedule schema and helper**

Create `src/lib/scanner/schedule.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown IANA timezone");

export const scheduleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  windowStart: isoDate.nullable().optional(),
  windowEnd: isoDate.nullable().optional(),
  dailyStartTime: hhmm.nullable().optional(),
  dailyEndTime: hhmm.nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  timezone: timezone.optional(),
  zipRefreshDays: z.number().int().min(1).max(90).optional(),
  tdlrSyncHours: z.number().int().min(1).max(168).optional(),
  websiteRecheckDays: z.number().int().min(1).max(365).optional(),
  autoAddHotZips: z.boolean().optional(),
  maxConcurrentJobs: z.number().int().min(1).max(2).optional(),
});

export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;

export async function applyScheduleUpdate(ownerId: string, update: ScheduleUpdate) {
  const data = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
  return prisma.scanSchedule.upsert({ where: { ownerId }, update: data, create: { ownerId, ...data } });
}
```

Run the unit test — expect PASS.

- [ ] **Step 3: Routes**

Create `src/app/api/scanner/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { readScanner } from "@/lib/scanner/state";
import { isWithinWindow } from "@/lib/scanner/window";
import { budgetStatus } from "@/lib/providers/budget";

export const GET = handle(async () => {
  const actor = await getActor();
  const [{ schedule, state, targets }, budget, activity] = await Promise.all([
    readScanner(actor.id),
    budgetStatus("google"),
    prisma.activityLog.findMany({ where: { ownerId: actor.id, kind: "scanner" }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return json({ state, schedule, targets, budget, window: isWithinWindow(schedule), activity });
});
```

Create `src/app/api/scanner/schedule/route.ts`:

```ts
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { applyScheduleUpdate, scheduleUpdateSchema } from "@/lib/scanner/schedule";
import { logScanner } from "@/lib/scanner/state";

export const PUT = handle(async (req) => {
  const actor = await getActor();
  const update = await parseJson(req, scheduleUpdateSchema);
  const schedule = await applyScheduleUpdate(actor.id, update);
  await logScanner(actor.id, `Schedule updated: ${Object.keys(update).join(", ")}`);
  return json({ schedule });
});
```

Create `src/app/api/scanner/pause/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const state = await prisma.scannerState.update({ where: { ownerId: actor.id }, data: { pauseRequested: true, status: "paused", currentActivity: null } });
  await logScanner(actor.id, "Paused by user");
  return json({ state });
});
```

Create `src/app/api/scanner/resume/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { enqueueScannerTick } from "@/lib/jobs/enqueue";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const state = await prisma.scannerState.update({ where: { ownerId: actor.id }, data: { pauseRequested: false, status: "idle", consecutiveFailures: 0, lastError: null } });
  await logScanner(actor.id, "Resumed by user");
  const ticked = await enqueueScannerTick();
  return json({ state, ticked });
});
```

Create `src/app/api/scanner/stop/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { logScanner, readScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  await readScanner(actor.id);
  const [state, schedule] = await Promise.all([
    prisma.scannerState.update({ where: { ownerId: actor.id }, data: { pauseRequested: true, status: "disabled", currentActivity: null } }),
    prisma.scanSchedule.update({ where: { ownerId: actor.id }, data: { enabled: false } }),
  ]);
  await logScanner(actor.id, "Stopped by user");
  return json({ state, schedule });
});
```

Create `src/app/api/scanner/run-now/route.ts`:

```ts
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { enqueueScannerTick } from "@/lib/jobs/enqueue";
import { logScanner } from "@/lib/scanner/state";

export const POST = handle(async () => {
  const actor = await getActor();
  const ticked = await enqueueScannerTick();
  await logScanner(actor.id, ticked ? "Tick requested by user" : "Tick already queued");
  return json({ ticked }, 202);
});
```

Create `src/app/api/scanner/targets/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { logScanner } from "@/lib/scanner/state";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.scanTarget.findMany({ where: { ownerId: actor.id }, orderBy: [{ priority: "desc" }, { zip: "asc" }] });
  return json({ items });
});

const createSchema = z.object({ zip: z.string().regex(/^\d{5}$/), priority: z.number().int().min(0).max(1000).optional() });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, createSchema);
  const target = await prisma.scanTarget.upsert({
    where: { ownerId_zip: { ownerId: actor.id, zip: body.zip } },
    update: { addedBy: "user", paused: false, ...(body.priority !== undefined && { priority: body.priority }) },
    create: { ownerId: actor.id, zip: body.zip, priority: body.priority ?? 0, addedBy: "user" },
  });
  await logScanner(actor.id, `Target ${body.zip} added`);
  return json({ target }, 201);
});
```

Create `src/app/api/scanner/targets/[id]/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { logScanner } from "@/lib/scanner/state";

const patchSchema = z.object({ priority: z.number().int().min(0).max(1000).optional(), paused: z.boolean().optional() });

async function owned(id: string, ownerId: string) {
  const t = await prisma.scanTarget.findFirst({ where: { id, ownerId } });
  if (!t) throw new ApiError(404, "Target not found");
  return t;
}

export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  await owned(id, actor.id);
  const body = await parseJson(req, patchSchema);
  const target = await prisma.scanTarget.update({ where: { id }, data: body });
  return json({ target });
});

export const DELETE = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const t = await owned(id, actor.id);
  await prisma.scanTarget.delete({ where: { id } });
  await logScanner(actor.id, `Target ${t.zip} removed`);
  return json({ deleted: true });
});
```

Create `src/app/api/searches/[id]/resume/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueZipSearch, MANUAL_PRIORITY, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const search = await prisma.search.findFirst({ where: { id, ownerId: actor.id } });
  if (!search) throw new ApiError(404, "Search not found");
  if (search.status !== "paused") throw new ApiError(409, `Search is ${search.status}, not paused`);
  const updated = await prisma.search.update({ where: { id }, data: { status: "queued", error: null } });
  const origin = search.origin === "scanner" ? "scanner" : "manual";
  await enqueueZipSearch(id, { priority: origin === "scanner" ? SCANNER_PRIORITY : MANUAL_PRIORITY, origin });
  return json({ search: updated }, 202);
});
```

- [ ] **Step 4: Verify with curl and commit**

With the worker and dev server running and a session cookie:

```bash
curl -s -b cookies.txt http://localhost:3000/api/scanner | head -c 400                                         # state.status "disabled"
curl -s -b cookies.txt -X PUT -H "content-type: application/json" -d '{"enabled":true,"dailyStartTime":"06:00","dailyEndTime":"23:00"}' http://localhost:3000/api/scanner/schedule
curl -s -b cookies.txt -X POST -H "content-type: application/json" -d '{"zip":"77084","priority":5}' http://localhost:3000/api/scanner/targets  # 201
curl -s -b cookies.txt -X POST http://localhost:3000/api/scanner/run-now                                         # 202
sleep 8; curl -s -b cookies.txt http://localhost:3000/api/scanner | head -c 400                                # status running, currentActivity "Zip search 77084"
curl -s -b cookies.txt -X POST http://localhost:3000/api/scanner/pause                                            # paused
sleep 5; curl -s -b cookies.txt "http://localhost:3000/api/searches" | head -c 300                              # the scanner search is paused
ID=$(curl -s -b cookies.txt "http://localhost:3000/api/searches" | python -c "import sys,json;print([s for s in json.load(sys.stdin)['items'] if s['origin']=='scanner'][0]['id'])")
curl -s -b cookies.txt -X POST http://localhost:3000/api/scanner/resume                                           # ticked true → resumes it
curl -s -b cookies.txt -X POST http://localhost:3000/api/scanner/stop                                             # disabled, enabled false
```

Then `npm test`, `npm run test:db`, `npx tsc --noEmit`, `npm run lint`; stop servers by PID; commit:

```bash
git add -A
git commit -m "feat: Scanner API (state, schedule, pause/resume/stop/run-now, targets) and paused-search resume

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Scanner page, navbar pill, dashboard card, Resume on Searches

**Files:**
- Create: `src/components/scanner/StatusCard.tsx`, `src/components/scanner/ScheduleForm.tsx`, `src/components/scanner/TargetsCard.tsx`, `src/components/scanner/ScannerActivity.tsx`, `src/components/scanner/ScannerView.tsx`, `src/components/dashboard/ScannerCard.tsx`
- Modify: `src/app/scanner/page.tsx`, `src/components/nav/ScannerPill.tsx`, `src/app/page.tsx`, `src/components/searches/SearchList.tsx`

**Interfaces:**
- Consumes: the Task 5 API. `useLeadFilters` not needed. shadcn `button, card, input, label, checkbox, select, badge, separator`.
- Produces: `<ScannerView />`, `<ScannerPill />` (live), `<ScannerCard />`, a Resume button on paused searches.
- Type used by all scanner components (put in `src/components/scanner/types.ts`):

```ts
export type ScannerPayload = {
  state: { status: string; pauseRequested: boolean; currentActivity: string | null; nextPlanned: { kind: string; at: string | null; detail?: string } | null; lastError: string | null; lastTickAt: string | null; consecutiveFailures: number };
  schedule: { enabled: boolean; windowStart: string | null; windowEnd: string | null; dailyStartTime: string | null; dailyEndTime: string | null; daysOfWeek: number[]; timezone: string; zipRefreshDays: number; tdlrSyncHours: number; websiteRecheckDays: number; autoAddHotZips: boolean; maxConcurrentJobs: number };
  targets: { id: string; zip: string; priority: number; addedBy: string; lastSearchedAt: string | null; lastSearchId: string | null; paused: boolean }[];
  budget: { used: number; limit: number; exhausted: boolean };
  window: { ok: boolean; reason?: string };
  activity: { id: string; message: string; createdAt: string }[];
};
```

- [ ] **Step 1: Status card and activity**

Create `src/components/scanner/types.ts` with the type above.

Create `src/components/scanner/StatusCard.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import type { ScannerPayload } from "./types";

const DOT: Record<string, string> = {
  running: "bg-emerald-500",
  idle: "bg-blue-500",
  paused: "bg-amber-500",
  outside_window: "bg-neutral-400",
  budget_exhausted: "bg-red-500",
  disabled: "bg-neutral-300",
};

export async function scannerAction(action: "pause" | "resume" | "stop" | "run-now"): Promise<boolean> {
  const r = await fetch(`/api/scanner/${action}`, { method: "POST" });
  if (!r.ok) {
    toast.error(`Could not ${action.replace("-", " ")} the Scanner`);
    return false;
  }
  toast.success({ pause: "Scanner paused", resume: "Scanner resumed", stop: "Scanner stopped", "run-now": "Tick requested" }[action]);
  return true;
}

export function StatusCard({ data, onChanged }: { data: ScannerPayload; onChanged: () => void }) {
  const { state, window, budget } = data;
  const status = state.status;
  const act = async (a: Parameters<typeof scannerAction>[0]) => { if (await scannerAction(a)) onChanged(); };
  const next = state.nextPlanned?.at ? new Date(state.nextPlanned.at) : null;
  return (
    <Card data-testid="scanner-status">
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${DOT[status] ?? "bg-neutral-300"}`} />
            <span className="text-2xl font-semibold" data-testid="scanner-state">{titleCase(status)}</span>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {state.currentActivity ?? (status === "outside_window" ? `Outside the operating window (${window.reason ?? "closed"})` : status === "disabled" ? "Enable the schedule below to start scanning." : status === "paused" ? (state.lastError ? `Paused: ${state.lastError}` : "Paused; resume when ready.") : "Nothing running.")}
          </p>
          <p className="text-xs text-neutral-500">
            {next ? `Next: ${state.nextPlanned?.detail ?? state.nextPlanned?.kind} at ${formatDate(next)} ${next.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : state.nextPlanned?.detail ?? ""}
            {state.lastTickAt ? ` · last tick ${timeAgo(state.lastTickAt)}` : ""}
            {` · Google budget ${budget.used}/${budget.limit}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state.pauseRequested || status === "paused" ? (
            <Button onClick={() => act("resume")} data-testid="scanner-resume">Resume</Button>
          ) : (
            <Button variant="outline" onClick={() => act("pause")} data-testid="scanner-pause" disabled={status === "disabled"}>Pause</Button>
          )}
          <Button variant="outline" onClick={() => act("run-now")} data-testid="scanner-run-now" disabled={!data.schedule.enabled}>Run now</Button>
          <Button variant="destructive" onClick={() => act("stop")} data-testid="scanner-stop" disabled={status === "disabled"}>Stop</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Create `src/components/scanner/ScannerActivity.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import type { ScannerPayload } from "./types";

export function ScannerActivity({ items }: { items: ScannerPayload["activity"] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? <p className="text-sm text-neutral-500">No Scanner activity yet.</p> : (
          <ul className="space-y-1 text-sm" data-testid="scanner-activity">
            {items.map((a) => <li key={a.id} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-neutral-400">{timeAgo(a.createdAt)}</span><span>{a.message}</span></li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Schedule form**

Create `src/components/scanner/ScheduleForm.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ScannerPayload } from "./types";

type S = ScannerPayload["schedule"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ISO → value for <input type="datetime-local"> in the browser's local zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export function ScheduleForm({ schedule, onSaved }: { schedule: S; onSaved: () => void }) {
  const [s, setS] = useState<S>(schedule);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(schedule), [schedule]);
  const num = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/scanner/schedule", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...s, windowStart: s.windowStart, windowEnd: s.windowEnd, dailyStartTime: s.dailyStartTime || null, dailyEndTime: s.dailyEndTime || null }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
      toast.success("Schedule saved");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2" data-testid="schedule-form">
          <label className="flex items-center gap-2 md:col-span-2">
            <Checkbox checked={s.enabled} onCheckedChange={(c) => setS({ ...s, enabled: !!c })} data-testid="schedule-enabled" />
            <span className="font-medium">Scanner enabled</span>
          </label>
          <div className="space-y-1">
            <Label htmlFor="ws">Window start</Label>
            <Input id="ws" type="datetime-local" value={toLocalInput(s.windowStart)} onChange={(e) => setS({ ...s, windowStart: fromLocalInput(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="we">Window end</Label>
            <Input id="we" type="datetime-local" value={toLocalInput(s.windowEnd)} onChange={(e) => setS({ ...s, windowEnd: fromLocalInput(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ds">Daily start (HH:mm)</Label>
            <Input id="ds" type="time" value={s.dailyStartTime ?? ""} onChange={(e) => setS({ ...s, dailyStartTime: e.target.value || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="de">Daily end (HH:mm)</Label>
            <Input id="de" type="time" value={s.dailyEndTime ?? ""} onChange={(e) => setS({ ...s, dailyEndTime: e.target.value || null })} />
          </div>
          <div className="md:col-span-2">
            <Label>Days of week (none = every day)</Label>
            <div className="mt-1 flex flex-wrap gap-3">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1 text-sm">
                  <Checkbox checked={s.daysOfWeek.includes(i)} onCheckedChange={(c) => setS({ ...s, daysOfWeek: c ? [...s.daysOfWeek, i].sort() : s.daysOfWeek.filter((x) => x !== i) })} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tz">Timezone</Label>
            <Input id="tz" value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mc">Max concurrent scanner jobs</Label>
            <Input id="mc" type="number" min={1} max={2} value={s.maxConcurrentJobs} onChange={num("maxConcurrentJobs")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="zr">Re-search each zip every (days)</Label>
            <Input id="zr" type="number" min={1} max={90} value={s.zipRefreshDays} onChange={num("zipRefreshDays")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="th">TDLR sync every (hours)</Label>
            <Input id="th" type="number" min={1} max={168} value={s.tdlrSyncHours} onChange={num("tdlrSyncHours")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wr">Re-check websites every (days)</Label>
            <Input id="wr" type="number" min={1} max={365} value={s.websiteRecheckDays} onChange={num("websiteRecheckDays")} />
          </div>
          <label className="flex items-center gap-2">
            <Checkbox checked={s.autoAddHotZips} onCheckedChange={(c) => setS({ ...s, autoAddHotZips: !!c })} />
            <span className="text-sm">Auto-add zips of hot TDLR projects</span>
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy} data-testid="schedule-save">{busy ? "Saving…" : "Save schedule"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Targets card**

Create `src/components/scanner/TargetsCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";
import type { ScannerPayload } from "./types";

type T = ScannerPayload["targets"][number];

export function TargetsCard({ targets, onChanged }: { targets: T[]; onChanged: () => void }) {
  const [zip, setZip] = useState("");

  async function call(url: string, init: RequestInit, okMsg: string) {
    const r = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    if (!r.ok) return toast.error((await r.json().catch(() => ({}))).error ?? "Request failed");
    toast.success(okMsg);
    onChanged();
  }
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) return toast.error("Enter a 5-digit zip");
    call("/api/scanner/targets", { method: "POST", body: JSON.stringify({ zip }) }, `Added ${zip}`).then(() => setZip(""));
  };
  const patch = (t: T, body: Partial<Pick<T, "priority" | "paused">>, msg: string) =>
    call(`/api/scanner/targets/${t.id}`, { method: "PATCH", body: JSON.stringify(body) }, msg);
  const remove = (t: T) => call(`/api/scanner/targets/${t.id}`, { method: "DELETE" }, `Removed ${t.zip}`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Target zips</CardTitle>
        <form onSubmit={add} className="flex gap-2">
          <Input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="Add zip" inputMode="numeric" className="h-8 w-28" aria-label="Add zip" data-testid="target-zip" />
          <Button type="submit" size="sm" data-testid="target-add">Add</Button>
        </form>
      </CardHeader>
      <CardContent>
        {targets.length === 0 ? <p className="text-sm text-neutral-500">No targets yet. Add a zip, or let hot TDLR projects add theirs.</p> : (
          <ul className="divide-y" data-testid="targets">
            {targets.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="target-row">
                <span className="w-16 font-medium">{t.zip}</span>
                <Badge variant="outline">{t.addedBy === "auto_tdlr" ? "TDLR" : "You"}</Badge>
                <span className="text-xs text-neutral-500">priority {t.priority}</span>
                <span className="text-xs text-neutral-500">{t.lastSearchedAt ? `searched ${timeAgo(t.lastSearchedAt)}` : "never searched"}</span>
                {t.paused && <Badge className="border-0 bg-amber-100 text-amber-800">paused</Badge>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => patch(t, { priority: (targets[i - 1]?.priority ?? t.priority) + 1 }, "Moved up")}>↑</Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === targets.length - 1} onClick={() => patch(t, { priority: Math.max(0, (targets[i + 1]?.priority ?? t.priority) - 1) }, "Moved down")}>↓</Button>
                  <Button size="sm" variant="ghost" onClick={() => patch(t, { paused: !t.paused }, t.paused ? "Target resumed" : "Target paused")}>{t.paused ? "Resume" : "Pause"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(t)}>Remove</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

(Ordering is by priority; the up/down buttons adjust priority relative to neighbors, which is the reliable substitute for drag-to-reorder in the spec. Record as a deviation in the plan's ledger.)

- [ ] **Step 4: View, page, pill, dashboard card, Resume**

Create `src/components/scanner/ScannerView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusCard } from "./StatusCard";
import { ScheduleForm } from "./ScheduleForm";
import { TargetsCard } from "./TargetsCard";
import { ScannerActivity } from "./ScannerActivity";
import type { ScannerPayload } from "./types";

export function ScannerView() {
  const [data, setData] = useState<ScannerPayload | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scanner", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
    } catch {
      toast.error("Could not load Scanner status");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, data?.state.status === "running" ? 5000 : 15000);
    return () => clearInterval(t);
  }, [load, data?.state.status]);

  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <StatusCard data={data} onChanged={load} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ScheduleForm schedule={data.schedule} onSaved={load} />
        <TargetsCard targets={data.targets} onChanged={load} />
      </div>
      <ScannerActivity items={data.activity} />
    </div>
  );
}
```

Replace `src/app/scanner/page.tsx`:

```tsx
import { ScannerView } from "@/components/scanner/ScannerView";

export default function ScannerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Scanner</h1>
        <p className="text-sm text-neutral-500">Runs zip searches, TDLR syncs, and website re-checks on their own inside your operating window. Pause or stop at any time.</p>
      </div>
      <ScannerView />
    </div>
  );
}
```

Replace `src/components/nav/ScannerPill.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { scannerAction } from "@/components/scanner/StatusCard";
import { titleCase } from "@/lib/format";

const DOT: Record<string, string> = { running: "bg-emerald-500", idle: "bg-blue-500", paused: "bg-amber-500", outside_window: "bg-neutral-400", budget_exhausted: "bg-red-500", disabled: "bg-neutral-300" };

export function ScannerPill() {
  const [s, setS] = useState<{ status: string; pauseRequested: boolean; currentActivity: string | null } | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/scanner", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setS((await r.json()).state);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  if (!s) return null;
  const paused = s.pauseRequested || s.status === "paused";
  return (
    <span data-testid="scanner-pill" className="hidden max-w-xs items-center gap-2 rounded-full border px-3 py-1 text-xs md:inline-flex">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status] ?? "bg-neutral-300"}`} />
      <span className="truncate">{s.currentActivity ?? `Scanner ${titleCase(s.status).toLowerCase()}`}</span>
      {s.status !== "disabled" && (
        <button type="button" className="ml-1 font-medium text-blue-600 hover:underline" data-testid="pill-toggle"
          onClick={async () => { if (await scannerAction(paused ? "resume" : "pause")) load(); }}>
          {paused ? "Resume" : "Pause"}
        </button>
      )}
    </span>
  );
}
```

Create `src/components/dashboard/ScannerCard.tsx` (server component):

```tsx
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readScanner } from "@/lib/scanner/state";
import { titleCase, timeAgo } from "@/lib/format";

export async function ScannerCard({ ownerId }: { ownerId: string }) {
  const { state, schedule, targets } = await readScanner(ownerId);
  return (
    <Card data-testid="dashboard-scanner">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Scanner</CardTitle>
        <Link href="/scanner" className="text-sm text-blue-600 hover:underline">Open</Link>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="font-medium">{titleCase(state.status)}</div>
        <div className="text-neutral-500">{state.currentActivity ?? (schedule.enabled ? `${targets.length} target zip${targets.length === 1 ? "" : "s"}` : "Not enabled")}{state.lastTickAt ? ` · last tick ${timeAgo(state.lastTickAt)}` : ""}</div>
      </CardContent>
    </Card>
  );
}
```

In `src/app/page.tsx`, render `<ScannerCard ownerId={actor.id} />` as a third card in the lower grid (change `lg:grid-cols-2` to `lg:grid-cols-3`), importing it from `@/components/dashboard/ScannerCard`.

In `src/components/searches/SearchList.tsx`: add a `resume(id)` handler that POSTs `/api/searches/${id}/resume`, toasts, and reloads the list; render `<Button variant="outline" size="sm" onClick={() => resume(s.id)}>Resume</Button>` when `s.status === "paused"` (in place of the Re-run button); show an "auto" badge (`<Badge variant="outline">auto</Badge>`) when `s.origin === "scanner"`.

- [ ] **Step 5: Verify and commit**

`npm run lint`, `npx tsc --noEmit`, `npm test`. Start the worker and dev server; in the browser: /scanner shows Disabled; enable the schedule with a wide daily window and save; add zip 77084; Run now → status Running with "Zip search 77084" within a few seconds and the pill in the navbar shows it; Pause → the running search flips to paused on /searches within seconds and shows a Resume button; Resume on /scanner → the search resumes and completes; Stop → Disabled. Dashboard shows the Scanner card. Stop servers by PID. Commit:

```bash
git add -A
git commit -m "feat: Scanner page, live navbar pill, dashboard card, resume paused searches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Scanner end-to-end test, migration-drift CI check, and deferred cleanups

**Files:**
- Create: `tests/e2e/scanner.spec.ts`
- Modify: `.github/workflows/ci.yml`, `src/lib/projects/filters.ts`, `tests/unit/projects/filters.test.ts` (no expectation change), `src/app/api/projects/sync/route.ts`, `src/app/api/projects/promote-high-fit/route.ts`, `README.md`

**Interfaces:**
- Consumes: Task 5 API and Task 6 testids (`scanner-state`, `schedule-enabled`, `schedule-save`, `target-zip`, `target-add`, `scanner-run-now`, `scanner-pause`, `scanner-resume`, `scanner-stop`, `scanner-pill`, `pill-toggle`, `target-row`, `scanner-activity`); `bandFor` thresholds; `PROJECT_CONFIG.highFitThreshold`.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/scanner.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("scanner is disabled until the schedule is enabled, then runs a target zip", async ({ page }) => {
  await unlock(page);
  await page.goto("/scanner");
  await expect(page.getByTestId("scanner-state")).toHaveText("Disabled");

  await page.getByTestId("schedule-enabled").click();
  await page.getByTestId("schedule-save").click();
  await expect(page.getByText("Schedule saved")).toBeVisible();

  await page.getByTestId("target-zip").fill("77084");
  await page.getByTestId("target-add").click();
  await expect(page.getByTestId("target-row")).toHaveCount(1);

  await page.getByTestId("scanner-run-now").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Running", { timeout: 20_000 });
  await expect(page.getByTestId("scanner-status")).toContainText("Zip search 77084");

  await page.goto("/searches");
  await expect(page.locator('[data-testid="search-card"]').first()).toContainText("77084");
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });
});

test("pause takes effect and resume continues; stop disables", async ({ page }) => {
  await unlock(page);
  await page.goto("/scanner");
  await page.getByTestId("scanner-pause").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Paused");
  await expect(page.getByTestId("scanner-pill")).toContainText("Resume");

  await page.getByTestId("scanner-resume").click();
  await expect(page.getByTestId("scanner-state")).not.toHaveText("Paused", { timeout: 20_000 });

  await page.getByTestId("scanner-stop").click();
  await expect(page.getByTestId("scanner-state")).toHaveText("Disabled");
  await expect(page.getByTestId("scanner-activity")).toContainText("Stopped by user");
});
```

Run `npm run test:e2e` (production build, 10 tests expected: 5 leads + 3 projects + 2 scanner). The first scanner test relies on the inline tick + inline zip search: after "Run now", the tick enqueues a search that runs in-process; in fake mode it completes within seconds. If the "Running" assertion races the job finishing (state may already be idle), assert instead that a search card for 77084 exists and completes, and keep the status assertion as `toHaveText(/Running|Idle/)` — note the change.

- [ ] **Step 2: CI migration-drift check and README**

In `.github/workflows/ci.yml` add after the `npx prisma migrate deploy` step:

```yaml
      - run: npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$TEST_DATABASE_URL" --exit-code
```

(Exit code 2 means the migrations do not produce the schema; the step fails the job.) Verify locally that the same command exits 0 against `TEST_DATABASE_URL` (it uses the shadow database only for computing the diff).

In `README.md` add a "Scanner" section: what it does (window, targets, priority order, hot zips, pause/resume/stop), the 5-minute tick, that manual searches always run first, that the browser suite now runs against a production build (`npm run e2e:server` is what Playwright launches), and the `NEXT_DIST_DIR` convention.

- [ ] **Step 3: Deferred cleanups**

- `src/lib/projects/filters.ts`: replace the literal fit thresholds with `PROJECT_CONFIG.highFitThreshold` (60) and a new `PROJECT_CONFIG.mediumFitThreshold: 30` added to `src/lib/config/projects.ts`; `bandFor` in `src/lib/scoring/smbFit.ts` reads the same two constants. The filters unit test expectations (60/30) are unchanged.
- `src/app/api/projects/sync/route.ts` and `src/app/api/projects/promote-high-fit/route.ts`: call `const actor = await getActor();` at the top of each POST handler (the global constraint) and include `ownerId: actor.id` in the 202 response body so the actor is used, not just fetched.
- `src/lib/jobs/tdlrSync.ts`: replace any remaining `785` literal with `REGION.tdlrCityCode` (Task 2 should have done this; verify with grep).

- [ ] **Step 4: Full check set and commit**

```bash
npm test && npm run test:db && npm run lint && npx tsc --noEmit && npm run test:e2e
git add -A
git commit -m "test: scanner e2e; ci: migration drift check; chore: single-source fit thresholds, actor in sync routes, README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 3

- Unit, DB, and e2e suites pass; e2e runs against `next build`/`next start` (10 tests).
- With the schedule enabled and a target zip, the worker's 5-minute tick starts scanner-origin searches inside the window and reports status; Pause lands within seconds; Resume continues from the last completed step; Stop disables. Manual "Run search" is unaffected and outranks scanner jobs.
- Re-running a zip search makes zero Place Details calls for places fetched within 30 days (ID-only Text Search only).
- CI fails if a schema change lacks a migration.

## Deferred to Plan 4

Apollo enrichment, Settings page (provider keys, budgets, editable SMB categories/package map/exclusion lists, SMB fit threshold, TDLR backfill window, region), SSRF hardening of the scraper, passphrase attempt throttling, Railway deploy config.
