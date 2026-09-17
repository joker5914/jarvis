# SDR Lead Gen Dashboard — Plan 7: Apollo Credit Strategy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Apollo enrichment deliberate and safe on the free tier (85 credits per month, one credit per verified net-new email): one decision-maker per business by default, no paid reveal where Apollo already says there is no email, a monthly credit cap aligned to the user's renewal date, small confirmed bulk actions, and a Leads filter that surfaces the leads worth a credit.

**Architecture:** A pure credit module (`src/lib/enrichment/credits.ts`) derives the current cycle from a renewal day stored in `AppConfig` and counts credits used as Apollo-sourced email contacts created since the cycle start (the only thing Apollo charges for that we store). `runEnrich` reads `maxPeople`/cap from `loadConfig`, skips search hits with `hasEmail === false` before any paid call, and stops with a `CreditCapReachedError` (swallowed by the worker like the budget errors). Routes expose the credit status and refuse work at the cap; the UI shows estimates and a "needs enrichment" filter.

**Tech Stack:** Same as Plans 1–6 (Next.js 15.5, Prisma 6.19, zod 4, Vitest 5, Playwright). No migration: settings live in the existing `AppConfig.overrides` JSON; credits are derived from `Contact` rows.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` 3.2 (budget wrapper), 5.2 (enrich job), 8 (Leads bulk enrich, Settings budgets). User ruling (2026-09-17): "use credits strategically, not shotgun blast"; free tier 85 credits renewing Oct 15.

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` before npm commands). Pinned majors unchanged.
- `getActor()` in every route/server component; `"local-user"` only in `src/lib/actor.ts`, schema defaults, seed, tests. Every Apollo HTTP call inside `withBudget("apollo")`; keys never in responses/logs; fake mode never touches the network; phone reveals are never requested.
- shadcn Base UI: no `asChild`; `render` prop; `Select` takes `items`; `Checkbox` uses `onCheckedChange(boolean)`.
- Existing invariants: one `enriched` activity row per run; `ProviderDisabledError`/`ProviderNotConfiguredError`/`BudgetExhaustedError` are swallowed by the worker handler (`handleEnrichJob`), never retried.
- Browser suite stays at 13; unit/db suites only grow. The dev database holds real data (do not reset; no migration in this plan).
- Commit per task, conventional message ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; author flags `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`. `npx tsc --noEmit` is the source of truth. Stop servers by PID only.

## File structure

```
src/lib/config/enrichment.ts            ENRICH_CONFIG: maxPeople 1, monthlyCreditCap 80, cycleRenewsOn null (+ existing)
src/lib/config/runtime.ts               overrides.enrichment {maxPeople, monthlyCreditCap, cycleRenewsOn}; cfg.enrichment
src/lib/enrichment/credits.ts           creditCycleStart, creditsUsed, creditStatus, estimateCredits
src/lib/providers/errors.ts             CreditCapReachedError
src/lib/jobs/enrich.ts                  maxPeople from cfg/opts, has_email gate, cap enforcement
src/lib/jobs/enrichHandler.ts           swallow CreditCapReachedError
src/lib/jobs/queues.ts, enqueue.ts      EnrichJobData.people?: number; enqueueEnrich opts.people
src/app/api/enrichment/credits/route.ts GET credit status
src/app/api/businesses/[id]/enrich/route.ts   409 at cap; body { force?, people? }
src/app/api/businesses/bulk/route.ts    enrich cap 10; estimatedCredits in response
src/lib/leads/filters.ts                needs=enrichment
src/components/leads/{LeadFilters,LeadDetail,BulkBar}.tsx
src/components/settings/{EnrichmentCard,ProviderKeysCard,SettingsView,types}.tsx, src/app/api/settings/route.ts
tests/unit/enrichment/credits.test.ts, tests/unit/config/runtime.test.ts (+cases), tests/db/enrichCredits.test.ts, tests/db/businessEnrichRoute.test.ts (+cases), tests/db/leadsNeedsEnrichment.test.ts
```

---

### Task 1: Credit policy in the job (config, credit module, has_email gate, cap)

**Files:**
- Create: `src/lib/enrichment/credits.ts`, `tests/unit/enrichment/credits.test.ts`, `tests/db/enrichCredits.test.ts`
- Modify: `src/lib/config/enrichment.ts`, `src/lib/config/runtime.ts`, `src/lib/providers/errors.ts`, `src/lib/jobs/enrich.ts`, `src/lib/jobs/enrichHandler.ts`, `src/lib/jobs/queues.ts`, `src/lib/jobs/enqueue.ts`, `src/worker/index.ts` (if the handler signature changes), `tests/unit/config/runtime.test.ts`, `tests/db/enrich.test.ts` (fixture expectations for maxPeople 1)

**Interfaces:**
- Produces:
  - `ENRICH_CONFIG = { maxPeople: 1, maxPeopleLimit: 5, monthlyCreditCap: 85, monthlyCreditCapDefault: 80, preferredTitles, seniorities, recheckDays: 30 }` — keep the existing fields; `maxPeople` becomes 1.
  - `overridesSchema.enrichment?: { maxPeople?: int 1..5; monthlyCreditCap?: int 0..1000; cycleRenewsOn?: "YYYY-MM-DD" | null }` (strict); `RuntimeConfig.enrichment = { maxPeople, monthlyCreditCap, cycleRenewsOn }` (defaults 1 / 80 / null).
  - `creditCycleStart(now: Date, cycleRenewsOn: string | null, tz: string): Date` — if `cycleRenewsOn` is null → first day of the current month 00:00 in `tz`; else the most recent occurrence (≤ now) of that date's day-of-month at 00:00 in `tz` (day 31 clamps to the month's last day).
  - `creditsUsed(ownerId: string, since: Date): Promise<number>` — `Contact.count({ ownerId, source: "apollo", type: "email", createdAt: { gte: since } })`.
  - `creditStatus(ownerId, cfg: RuntimeConfig, now = new Date()): Promise<{ used: number; cap: number; remaining: number; cycleStart: Date; cycleRenewsOn: string | null }>` (`remaining = max(0, cap - used)`).
  - `estimateCredits(businesses: number, people: number): number` = `businesses * people`.
  - `class CreditCapReachedError extends Error { constructor(public used: number, public cap: number) }` (message `Apollo monthly credit cap reached (${used}/${cap})`).
  - `runEnrich(businessId, ownerId, deps, opts?: { force?: boolean; people?: number })` — `people` defaults to `cfg.enrichment.maxPeople`, clamped to `1..ENRICH_CONFIG.maxPeopleLimit`.
  - `EnrichJobData.people?: number`; `enqueueEnrich(businessId, ownerId, { force?, people? })`.

- [ ] **Step 1: Failing unit tests**

`tests/unit/enrichment/credits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { creditCycleStart, estimateCredits } from "@/lib/enrichment/credits";

const TZ = "America/Chicago";
describe("creditCycleStart", () => {
  it("defaults to the first of the current month in the schedule timezone", () => {
    expect(creditCycleStart(new Date("2026-09-17T05:00:00Z"), null, TZ).toISOString()).toBe("2026-09-01T05:00:00.000Z"); // 00:00 CDT
  });
  it("uses the renewal day-of-month: before the day → last month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-10T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-09-15T05:00:00.000Z");
  });
  it("on/after the renewal day → this month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-20T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });
  it("clamps day 31 to shorter months", () => {
    expect(creditCycleStart(new Date("2026-04-30T12:00:00Z"), "2026-01-31", TZ).toISOString()).toBe("2026-04-30T05:00:00.000Z");
  });
});
describe("estimateCredits", () => {
  it("is businesses × people", () => expect(estimateCredits(10, 1)).toBe(10));
});
```
(Compute local-midnight instants with the existing `utcForLocal(y, m, d, hh, mm, tz)` from `src/lib/scanner/window.ts`.)

`tests/unit/config/runtime.test.ts` — add: `mergeConfig({}).enrichment` equals `{ maxPeople: 1, monthlyCreditCap: 80, cycleRenewsOn: null }`; `overridesSchema.parse({ enrichment: { maxPeople: 2, monthlyCreditCap: 50, cycleRenewsOn: "2026-10-15" } })` succeeds; `maxPeople: 6`, `cycleRenewsOn: "15 Oct"` reject.

- [ ] **Step 2: Failing DB test**

`tests/db/enrichCredits.test.ts` (conventions as `tests/db/enrich.test.ts`: unique owner, `deleteMany`, six-fake `Providers`; also `appConfig.deleteMany({ where: { ownerId } })`):

```ts
it("enriches one person by default and skips people Apollo flags as having no email", async () => {
  const b = await biz();                       // fake search returns Maria (hasEmail true) then Lee (hasEmail false)
  const d = deps();
  const r = await runEnrich(b.id, OWNER, d);   // default maxPeople 1
  expect(d.enrichment.calls).toEqual({ search: 1, enrich: 1, orgSearch: 0 });
  expect(await prisma.contact.count({ where: { businessId: b.id, type: "email" } })).toBe(1);
  expect(r.added).toBe(1);
});
it("with people=2 still skips the no-email hit instead of paying to reveal it", async () => {
  const b = await biz(); const d = deps();
  await runEnrich(b.id, OWNER, d, { people: 2 });
  expect(d.enrichment.calls.enrich).toBe(1);    // Lee (hasEmail false) never revealed
});
it("refuses at the monthly cap without any provider call and logs one activity", async () => {
  await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 1 } });
  const b1 = await biz(); await runEnrich(b1.id, OWNER, deps());           // uses the 1 credit
  const b2 = await biz({ name: "Corner Cafe", websiteUrl: "https://cornercafe.com" });
  const d = deps();
  await expect(runEnrich(b2.id, OWNER, d)).rejects.toBeInstanceOf(CreditCapReachedError);
  expect(d.enrichment.calls).toEqual({ search: 0, enrich: 0, orgSearch: 0 });
  const log = await prisma.activityLog.findMany({ where: { businessId: b2.id } });
  expect(log).toHaveLength(1); expect(log[0].message).toMatch(/credit cap/i);
  const status = await creditStatus(OWNER, await loadConfig(OWNER));
  expect(status).toMatchObject({ used: 1, cap: 1, remaining: 0 });
});
it("stops mid-run when the cap is hit between people (people=2, cap=1) and still finishes the business", async () => {
  await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 1 } });
  // fake with two hasEmail hits: subclass FakeEnrichmentProvider to mark Lee hasEmail true for this test
  ...expect(calls.enrich).toBe(1); expect(lastEnrichedAt).not.toBeNull(); // partial but complete run
});
```
(Read `FakeEnrichmentProvider` in `src/lib/providers/fake.ts` — Maria `hasEmail: true`, Lee `hasEmail: false` — and adjust the fourth case by subclassing.) Update `tests/db/enrich.test.ts` expectations for the new default (`added: 1`, contacts 1 email + 1 linkedin for Maria only; `calls.enrich: 1`) — keep every other assertion.

- [ ] **Step 3: Implement**

`src/lib/config/enrichment.ts` — add `maxPeopleLimit: 5`, `monthlyCreditCapDefault: 80`, set `maxPeople: 1`.
`src/lib/config/runtime.ts` — schema: `enrichment: z.object({ maxPeople: z.number().int().min(1).max(5).optional(), monthlyCreditCap: z.number().int().min(0).max(1000).optional(), cycleRenewsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict().optional()`; `mergeConfig` adds `enrichment: { maxPeople: o.enrichment?.maxPeople ?? ENRICH_CONFIG.maxPeople, monthlyCreditCap: o.enrichment?.monthlyCreditCap ?? ENRICH_CONFIG.monthlyCreditCapDefault, cycleRenewsOn: o.enrichment?.cycleRenewsOn ?? null }`.

`src/lib/enrichment/credits.ts`:
```ts
import { prisma } from "@/lib/db";
import { utcForLocal } from "@/lib/scanner/window";
import type { RuntimeConfig } from "@/lib/config/runtime";

function localYmd(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return { y: g("year"), m: g("month"), d: g("day") };
}
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function creditCycleStart(now: Date, cycleRenewsOn: string | null, tz: string): Date {
  const { y, m, d } = localYmd(now, tz);
  const renewDay = cycleRenewsOn ? Number(cycleRenewsOn.slice(8, 10)) : 1;
  let yy = y, mm = m;
  if (d < Math.min(renewDay, daysIn(y, m))) { mm -= 1; if (mm === 0) { mm = 12; yy -= 1; } }
  return utcForLocal(yy, mm, Math.min(renewDay, daysIn(yy, mm)), 0, 0, tz);
}
export async function creditsUsed(ownerId: string, since: Date) {
  return prisma.contact.count({ where: { ownerId, source: "apollo", type: "email", createdAt: { gte: since } } });
}
export async function creditStatus(ownerId: string, cfg: RuntimeConfig, now = new Date()) {
  const tz = REGION.timezone; // import from @/lib/config/region
  const cycleStart = creditCycleStart(now, cfg.enrichment.cycleRenewsOn, tz);
  const used = await creditsUsed(ownerId, cycleStart);
  const cap = cfg.enrichment.monthlyCreditCap;
  return { used, cap, remaining: Math.max(0, cap - used), cycleStart, cycleRenewsOn: cfg.enrichment.cycleRenewsOn };
}
export const estimateCredits = (businesses: number, people: number) => businesses * people;
```
`errors.ts` — `CreditCapReachedError`. `enrich.ts` — at the top of `runEnrich` (after the excluded/recent checks): `const cfg = await loadConfig(ownerId); const people = Math.min(ENRICH_CONFIG.maxPeopleLimit, Math.max(1, opts.people ?? cfg.enrichment.maxPeople)); let { remaining } = await creditStatus(ownerId, cfg); if (remaining <= 0) { await log("Enrichment skipped: Apollo monthly credit cap reached"); throw new CreditCapReachedError(used, cap); }` — then `searchPeople(..., people)`; in the loop: `if (!p.hasEmail && !p.email) continue;` before the reveal; before each `enrichPerson` call `if (remaining <= 0) break;`; after a reveal that yields an email, `remaining--`. The catch block logs the cap error like the budget one. `enrichHandler.ts` swallows `CreditCapReachedError` (reason = message). `queues.ts`/`enqueue.ts`: `people?: number` threaded like `force`.

- [ ] **Step 4: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A && git commit -m "feat(apollo): credit policy — one person by default, no paid reveal without an email, monthly credit cap on the renewal cycle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Routes, Settings, Leads filter, and UI estimates

**Files:**
- Create: `src/app/api/enrichment/credits/route.ts`, `src/components/settings/EnrichmentCard.tsx`, `tests/db/leadsNeedsEnrichment.test.ts`
- Modify: `src/app/api/businesses/[id]/enrich/route.ts`, `src/app/api/businesses/bulk/route.ts`, `src/app/api/settings/route.ts`, `src/components/settings/{SettingsView,ProviderKeysCard,types}.tsx`, `src/lib/leads/filters.ts`, `src/components/leads/{LeadFilters,LeadDetail,BulkBar}.tsx`, `tests/db/businessEnrichRoute.test.ts`, `README.md`

**Interfaces:**
- Consumes: Task 1 (`creditStatus`, `estimateCredits`, `cfg.enrichment`, `CreditCapReachedError`, `people`).
- Produces:
  - `GET /api/enrichment/credits` → `{ used, cap, remaining, cycleStart, cycleRenewsOn, maxPeople }`.
  - `POST /api/businesses/[id]/enrich` body `{ force?: boolean; people?: 1..5 }` → `202 { queued, estimatedCredits }`; `409 { error: "Apollo monthly credit cap reached (used/cap)", settingsHref: "/settings" }` at the cap (checked after not-configured/disabled/excluded, before enqueue).
  - `POST /api/businesses/bulk` with `enrich: true`: max **10** ids (`400 "Enrich at most 10 leads per action"`), `409` at cap, response gains `estimatedCredits`.
  - `leadFiltersSchema.needs: z.enum(["enrichment"]).optional()` → where: `websiteUrl: { not: null }`, `exclusion: "none"`, `contactQualityBand: { in: ["green", "yellow"] }`, `lastEnrichedAt: null`, `contacts: { none: { type: "email" } }`.
  - `GET /api/settings` gains `enrichment: { maxPeople, monthlyCreditCap, cycleRenewsOn }` in `config` and `credits: { used, cap, remaining, cycleStart }`; `PUT /api/settings/config` accepts `enrichment` overrides.
  - Testids: `needs-enrichment` (checkbox), `enrich-estimate` (text next to the button), `bulk-enrich` (existing), `enrichment-max-people`, `enrichment-cap`, `enrichment-renews`, `credits-used`.

- [ ] **Step 1: Failing DB tests**

`tests/db/businessEnrichRoute.test.ts` — add: (a) with `saveOverrides(owner, { enrichment: { monthlyCreditCap: 0 } })` the single route returns 409 with `settingsHref` and the bulk route returns 409; (b) bulk with 11 ids → 400; (c) single 202 body has `estimatedCredits: 1` (default) and `{ people: 3 }` → `estimatedCredits: 3`; (d) `GET /api/enrichment/credits` returns `{ used: 0, cap: 80, remaining: 80, maxPeople: 1 }` for a fresh owner (call the handler directly).
`tests/db/leadsNeedsEnrichment.test.ts` — seed three businesses: A (website, yellow, no email, not enriched) → included; B (website, green, has an email contact) → excluded; C (no website) → excluded; D (excluded chain) → excluded; E (website, red band) → excluded; assert the where-builder (`buildLeadWhere`/whatever `filters.ts` exports) with `needs: "enrichment"` returns exactly A.

- [ ] **Step 2: Routes and filter**

Implement per the interfaces. The cap check helper: `async function assertCredits(ownerId) { const cfg = await loadConfig(ownerId); const s = await creditStatus(ownerId, cfg); if (s.remaining <= 0) return json({ error: `Apollo monthly credit cap reached (${s.used}/${s.cap})`, settingsHref: "/settings" }, 409); return null; }` used by both routes. `estimatedCredits = estimateCredits(ids.length, people)`.

- [ ] **Step 3: UI**

- `LeadDetail`: fetch `/api/enrichment/credits` once on mount (and after an enrich); button text `Enrich with Apollo` / `Re-enrich`, next to it `<span data-testid="enrich-estimate">~{maxPeople} credit{s} · {remaining} left this cycle</span>`; when `remaining === 0` the button is disabled with the note "Monthly Apollo credit cap reached — adjust in Settings".
- `BulkBar`: before posting, `if (!window.confirm(\`Enrich ${n} leads for up to ${n * maxPeople} Apollo credits (${remaining} left this cycle)?\`)) return;`; block with a toast when `n > 10`.
- `LeadFilters`: `<Checkbox data-testid="needs-enrichment" checked={params.get("needs") === "enrichment"} onCheckedChange={(c) => set("needs", c ? "enrichment" : "")} />` labelled "Needs enrichment"; both instances via the shared component.
- Settings: `EnrichmentCard` (people per business `Select` 1–5 with `items`; monthly cap number; renewal date `<Input type="date">`; saved through the existing config save flow, diff-only) and in `ProviderKeysCard`'s Apollo row `Credits used this cycle: {used}/{cap}` (`credits-used`) with the cycle start date. `SettingsView.buildOverrides` includes `enrichment` when it differs from defaults.
- README: replace the "up to 5 people" wording with the policy (1 person by default, cap, renewal date, bulk max 10, no phone reveals).

- [ ] **Step 4: Verify, commit**

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint && npm run test:e2e   # 13
git add -A && git commit -m "feat(apollo): credit status endpoint, cap-aware routes, bulk cap 10 with confirm, needs-enrichment filter, Settings enrichment card

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 7

- Default enrichment reveals at most one person per business and never pays to reveal a hit Apollo marks as having no email.
- The monthly cap (default 80) follows the renewal day set in Settings; credits used are counted from Apollo email contacts since the cycle start; at the cap every enrich path (job, single route, bulk route, UI) refuses with a clear message and no provider call.
- Bulk Enrich is capped at 10 leads and confirms the estimated spend; the Enrich button shows the estimate and remaining credits.
- Leads has a "Needs enrichment" filter that returns only website-bearing, non-excluded, yellow-or-better leads without an email that were never enriched.
- Suites green (e2e 13); no migration.
