# Plan 10: Point-of-Contact Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rep, not the ranking, decides who the point of contact is: see every candidate before spending a credit, know how confident the pick is, record field knowledge as the primary contact, and get quick manual assists when no database knows the owner.

**Architecture:** Apollo People Search is free, so "Find people" becomes a first-class step that stores the candidate list on the business; a reveal spends one credit for one chosen person. Contact confidence is derived, not stored (title class of the revealed person plus what the candidate list showed). Field knowledge lives in `Contact` rows with `source: manual` and a `primaryPerson` pointer on the business; a suppressed-Apollo-ID list keeps a wrong person from coming back. No new provider; an officer-records source is scoped as a spike only.

**Tech Stack:** Next.js 15.5 App Router, React 19, Prisma 6.19 / Postgres 16, pg-boss 12, zod 4, Vitest 5, shadcn Base UI. Node 22.22.3 via nvm.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` §5.2 (enrichment) and §6 (lead detail). Motivating case in `.superpowers/sdd/2026-09-17-plan9-targeting-credits/progress.md` ("POC accuracy investigation"): Pearland Coffee Roasters — Apollo lists 3 baristas, a Store Manager (no email) and a Production/Operations Manager (email); the real contact, Albert, is in no database we have.

## Global Constraints

- Node `22.22.3`, Next `15.5.x` (not 16), Prisma `6.x` (not 7), pg-boss `12.x`.
- Providers all-or-nothing by `PROVIDER_MODE`; every new provider call has a fake counterpart; DB tests pin `PROVIDER_MODE=fake`.
- Apollo key only in the `x-api-key` header; never in URLs, logs, activity rows, or responses. Credited calls through `withBudget("apollo", …)`; a reveal costs a credit only when an email comes back.
- No region literals outside `src/lib/config/region.ts` (Texas/Houston never hard-coded; UI copy included).
- `"local-user"` literal only in `src/lib/actor.ts`. Base UI: no `asChild`; `nativeButton={false}` on `Button` rendered as a link; `Select` needs `items`; `onValueChange` may pass `null`.
- Sentence case in UI copy. Activity messages keep their fixed prefixes (`Enriched via Apollo:`, `Enrichment skipped:`, …) because `src/lib/leads/enrichActivity.ts` matches on them.
- Migrations are additive. **Deploy order (whole-branch review, M2 — corrects this line's earlier "deploy web + worker together"):** deploy **web first** (`npm run start:web` runs `prisma migrate deploy` before `next start`, so the new columns/migrations land before either service reads them), **then** the worker. Don't click Reveal on a lead between the two deploys: an old worker process still enqueued from before the web deploy reads `EnrichJobData` with its old-build client, ignores the new `apolloId`/candidate-marking fields it doesn't know about, and silently runs a full auto-enrich instead of the specific reveal the rep asked for. See README's "Deploy to Railway" section for the general two-service deploy-order rule this follows.
- `npm run test:db` from one process at a time. Commit per task; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` last line.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `poc_accuracy` | `Business.candidates Json?`, `candidatesAt DateTime?`, `primaryPerson String?`, `suppressedApolloIds String[] @default([])`, `Contact.apolloId String?` |
| `prisma/schema.prisma` + migration `poc_primary_title` (**new**, decided in Task 3 — see its Amendment note) | `Business.primaryPersonTitle String?` — the title paired with a hand-typed `primaryPerson` who has no `Contact` row of their own |
| `src/lib/enrichment/candidates.ts` (**new**) | `findCandidates(businessId, ownerId, deps)`: free search → ranked candidate list stored on the business; `Candidate` type; suppression filter |
| `src/lib/jobs/enrich.ts` | `runEnrich` accepts `apolloId` (reveal exactly that candidate, no search); honours `suppressedApolloIds` on the auto path; `domainFromUrl` moved out to `src/lib/extract/domains.ts` (fix round for 3eed43d) and is re-exported here for existing callers/tests |
| `src/lib/extract/domains.ts` (**new**, fix round for 3eed43d) | `domainFromUrl` + its `SHARED_HOSTS` list, pulled out of `src/lib/jobs/enrich.ts` (which imports prisma) so the client (`LeadDetail.tsx`) can compute the same "no usable domain" hint the server's `costsCredit` uses, instead of a looser `websiteUrl == null` check |
| `src/lib/jobs/queues.ts` | `EnrichJobData.apolloId?` |
| `src/lib/jobs/enqueue.ts` | `enqueueEnrich`'s pg-boss `singletonKey` is per-target (`` `${businessId}:${apolloId ?? "auto"}` ``), not a bare `businessId`, so a queued auto-enrich can't dedupe away a reveal-by-id (or vice versa) |
| `src/app/api/businesses/[id]/candidates/route.ts` (**new**) | `POST` runs `findCandidates`; `GET` returns the stored list |
| `src/app/api/businesses/[id]/enrich/route.ts` | body gains `apolloId`; `queued === false` (pg-boss refused the per-target key) is a 409, not a 202 |
| `src/app/api/businesses/[id]/people/route.ts` (**new**) | `POST` add a manual person; `PATCH` set primary / suppress an Apollo person |
| `src/lib/leads/pocConfidence.ts` (**new**) | `pocConfidence(people, candidates) → { level, label }` |
| `src/lib/leads/queries.ts` | `getBusinessDetail`'s include carries the new columns; `listBusinesses` explicitly `omit`s them (list/CSV rows never need the candidate JSON) |
| `src/components/leads/LeadDetail.tsx` (+ `PeopleSection.tsx`, `AddPersonForm.tsx`, `ManualAssists.tsx` **new**) | candidate picker, confidence line, primary marker, add/suppress actions, search links and call prompt |
| `src/components/leads/LeadsTable.tsx` (Task 3, not originally listed here) | new "Contact" column — `primaryPerson` when set, else the first named contact |
| `src/lib/leads/groupPeople.ts` (**new**, Task 3 fix round) | `groupPeople` pulled out of `LeadDetail.tsx`, pure — unit-tested directly; the `Person` type itself moved here (Task 4 re-review) so `PeopleSection.tsx` imports it from the lib, not the other way around |
| `src/lib/leads/leadContactName.ts` (**new**, Task 3 fix round) | `leadContactName` pulled out of `LeadsTable.tsx`, pure — unit-tested directly |
| `src/lib/extract/address.ts` (**new**, Task 4 fix round) | `regionFromAddress`/`cityFromAddress` pulled out of `src/lib/jobs/enrich.ts` (prisma-importing) — same move as `domainFromUrl` before it — so `src/lib/leads/manualAssists.ts` (client-rendered) can compute a lead's city; re-exported from `enrich.ts` for existing callers/tests |
| `src/lib/leads/manualAssists.ts` / `src/components/leads/ManualAssists.tsx` (**new**, Task 4) | `assistLinks(b)`: LinkedIn/Facebook/Google owner-search links + a `tel:` call prompt with a nationally-formatted display number (`telDisplay`, whole-branch review L4); a local +1 regex parser, not `normalizePhone`, so `libphonenumber-js`/`tlds` never reach the client bundle |
| `src/app/api/businesses/bulk/route.ts` | Unmodified by this plan's own tasks, but exercised by its test suite (`estimatedCredits`, the same credit-cap/provider gates as the single-lead enrich route) — added to this table since `tests/db/businessEnrichRoute.test.ts` asserts against it directly |
| `src/components/leads/LeadDrawer.tsx` | Wraps `LeadDetail` with `key={id}` so switching leads fully remounts the drawer instead of leaving stale per-lead state (e.g. an in-flight enrich watch) behind |
| **Whole-branch review H1** — `prisma/schema.prisma` + migration `apollo_org_domain` | `Business.apolloOrgDomain String?` — the domain a no-website lead's Organization Search fallback resolved, memoized so later "Find people"/enrich calls route through the free, domain-filtered branch instead of paying for Organization Search again |
| **H1** — migration `credit_ledger_backfill` (data-only, no schema change) | Backfills one `credit_spent` `ActivityLog` row per pre-existing Apollo-sourced email `Contact` row, so `creditsUsed()`'s new counting rule (below) doesn't read history from before this migration as zero |
| **H1** — `src/lib/providers/types.ts`, `src/lib/providers/apollo.ts`, `src/lib/providers/fake.ts` | `PeopleSearchResult` gains `resolvedDomain?`/`orgSearchCredits?`; `ApolloEnrichmentProvider.searchPeople` reports both from its Organization Search fallback; `FakeEnrichmentProvider.searchPeople` mirrors it (increments `calls.orgSearch`, resolves a synthetic domain) whenever `q.domain` is null |
| **H1** — `src/lib/enrichment/credits.ts` | `creditsUsed(ownerId, since)` counts `ActivityLog` rows with `kind: "credit_spent"` instead of Apollo-sourced email `Contact` rows — fixes M1 (a "not the decision-maker" suppression hard-deletes Contact rows, which used to make an already-spent credit vanish from the count) and covers Organization Search spend (which never creates a Contact row at all) |
| **H1** — `src/lib/jobs/enrich.ts`'s `logCreditSpent`, `src/lib/enrichment/candidates.ts`'s `findCandidates` | Write one `ActivityLog { kind: "credit_spent" }` row per real spend: a reveal that returned an email, or each Organization Search page |
| **H1** — `src/app/api/businesses/[id]/candidates/route.ts` | `POST` body gains `force?: boolean`; a repeat no-domain call within `ENRICH_CONFIG.noDomainCandidatesReuseHours` (24h) is a 409 `{ error, retryable: true }` unless `force` |
| **L2** — `src/lib/enrichment/candidates.ts`'s `Candidate.revealedAt`, `markCandidateRevealed` | `runEnrich` stamps a revealed candidate's `revealedAt` in the stored set (whether or not the reveal produced a Contact row); `PeopleSection` treats `revealedAt` OR a matching Contact `apolloId` as "already revealed" |
| ActivityLog `kind` values this plan introduces | `poc_updated` (Task 3 — add/set-primary/suppress rows on `PeopleSection`); `credit_spent` (H1, above). `enriched` predates this plan. |
| `tests/db/candidates.test.ts`, `tests/db/enrich.test.ts`, `tests/db/enrichCredits.test.ts`, `tests/db/peopleRoute.test.ts`, `tests/db/businessEnrichRoute.test.ts`, `tests/unit/leads/pocConfidence.test.ts`, `tests/unit/leads/groupPeople.test.ts`, `tests/unit/leads/leadContactName.test.ts`, `tests/unit/leads/manualAssists.test.ts`, `tests/unit/extract/domains.test.ts` | behaviour |

---

### Task 1: "Find people" — candidates before credits

**Files:**
- Modify: `prisma/schema.prisma` (migration `poc_accuracy`: the four `Business` columns plus `Contact.apolloId String?`, all in one migration so later tasks need none; `runEnrich` sets `apolloId` on every Apollo contact row it creates or updates)
- Create: `src/lib/enrichment/candidates.ts`, `src/app/api/businesses/[id]/candidates/route.ts`
- Modify: `src/lib/jobs/enrich.ts`, `src/lib/jobs/queues.ts`, `src/app/api/businesses/[id]/enrich/route.ts`, `src/lib/leads/queries.ts`
- Test: `tests/db/candidates.test.ts` (new), `tests/db/enrich.test.ts`, `tests/db/businessEnrichRoute.test.ts`

**Interfaces:**
```ts
// src/lib/enrichment/candidates.ts
export type Candidate = {
  apolloId: string; firstName: string | null; title: string | null; hasEmail: boolean;
  orgName: string | null; rank: number;           // 0 = best by titleRank/hasEmail
};
export type CandidateSet = { fetchedAt: string; scope: PeopleSearchScope; totalAtDomain: number | null; candidates: Candidate[] };
/** Free People Search via the provider (goes through withBudget, plan-block, org-mismatch guard when domain is null);
 * filters out `suppressedApolloIds`; stores the set on Business.candidates/candidatesAt; returns it. Never reveals.
 * On the no-domain branch the search falls back to Apollo's Organization Search, which — unlike People Search
 * itself — costs one real Apollo credit; the route gates that case behind the same credit-cap check the enrich
 * route uses and reports it back as `costsCredit: true` in the 200 body (false when a domain search was free). */
export async function findCandidates(businessId: string, ownerId: string, deps: JobDeps): Promise<CandidateSet>;
// runEnrich opts gains `apolloId?: string`: when set, skip the search, reveal that id only (credit cap
// unchanged; recency gate bypassed — `force` implied), and log `Enriched via Apollo: revealed <title> chosen
// by you; …`. When the provider has no match for that id, logs `Enrichment failed: Apollo could not reveal the
// chosen person`, leaves lastEnrichedAt untouched, and returns `skipped: "reveal_failed"`.
// EnrichJobData gains `apolloId?: string`; POST /enrich body gains `apolloId: z.string().min(1).optional()`.
// enqueueEnrich's pg-boss singletonKey is `${businessId}:${apolloId ?? "auto"}`, not a bare businessId — the
// enrich queue is `policy: "stately"` (one job per state per singletonKey), so a bare businessId key would let
// a queued auto-enrich silently dedupe away (boss.send returns null) a later reveal-by-id for a *different*
// candidate, or two different reveals queued back to back. POST /enrich now turns `queued === false` into a 409
// `{ error: "An enrichment for this lead is already queued" }` instead of a false-positive 202.
```
- Candidate rows carry the first name and title Apollo already shows for free; last names stay obfuscated until a reveal.
- `POST /candidates` also refuses an excluded business with the same 409 `"Excluded businesses are not enriched"` the enrich route uses, and turns a live `ProviderPlanError`/`ProviderNotConfiguredError`/`ProviderDisabledError` from the search call itself into the same 409 + `settingsHref` shape the proactive configured/enabled/plan-block checks give (defense in depth, mirroring `runEnrich`'s own catch block).

- [x] **Step 1: Failing tests**
`tests/db/candidates.test.ts`: (a) `findCandidates` on a business with a domain stores a `CandidateSet` with the fake provider's two people ranked Owner first, `scope`/`totalAtDomain` from the result, `candidatesAt` set; (b) a suppressed id is filtered out; (c) org-mismatch on the no-domain branch yields an empty set and no activity row (reuse Plan 9 Task 4's guard — `orgNameMatches` — via the provider call — assert `calls.enrich === 0`).
`tests/db/enrich.test.ts`: (d) `runEnrich(id, owner, deps, { apolloId: "fake-…-gm" })` reveals exactly that person (`calls.search === 0`, `calls.enrich === 1`), respects the credit cap, writes the "chosen by you" row; (e) the auto path skips a suppressed id and reveals the next candidate.
`tests/db/businessEnrichRoute.test.ts`: (f) `POST /enrich { apolloId }` → 202 with `estimatedCredits: 1`; (g) `POST /candidates` → 200 with the set; `GET /candidates` returns it; 404 for another owner's business.

- [x] **Step 2: Run, expect failures.**

- [x] **Step 3: Implement.** Migration first. `findCandidates`: `regionFromAddress`, `domainFromUrl`, `deps.providers.enrichment.searchPeople({ domain, orgName, city, state, metro: cfg.enrichment.metroLocation }, ENRICH_CONFIG.searchPageSize)`; on the no-domain branch keep `orgNameMatches` (import from apollo.ts) exactly as `runEnrich` does; map to `Candidate[]` (rank = index after the provider's ranking), drop `suppressedApolloIds`; persist. Routes: `POST /candidates` = `findCandidates` inline (it is a free call; run it in the request with the same provider checks the enrich route does — configured/enabled/plan-block — and a 409 on `BudgetExhaustedError`); `GET` returns the stored set or `null`. `runEnrich`: when `opts.apolloId` is set, skip search + guards that need search data, `enrichPerson(apolloId)`, one reveal, same contact upsert path, message per Interfaces. Auto path: filter `people` by `!suppressedApolloIds.includes(p.apolloId)` before the loop.

- [x] **Step 4: tsc, lint, unit, db exit 0.**
- [x] **Step 5: Commit** `feat(enrich): free "Find people" candidate list stored on the lead; reveal a chosen candidate by Apollo id; suppressed ids never come back`.

---

### Task 2: Confidence you can read

**Files:**
- Create: `src/lib/leads/pocConfidence.ts`
- Modify: `src/components/leads/LeadDetail.tsx` (People section; split into `src/components/leads/PeopleSection.tsx` while there)
- Test: `tests/unit/leads/pocConfidence.test.ts`
- Fix round for 3eed43d, also touched: Create `src/lib/extract/domains.ts` (client-safe `domainFromUrl`, moved out of `src/lib/jobs/enrich.ts`); Test `tests/unit/extract/domains.test.ts`.

**Interfaces:**
```ts
export type PocLevel = "primary" | "decision_maker" | "manager" | "staff" | "none";
export type PocConfidence = { level: PocLevel; label: string };
/** `people` = grouped People rows (name, title, source, isPrimary); `candidates` = stored CandidateSet | null;
 * `primaryPerson` = `Business.primaryPerson` directly (not derived from `people`'s own `isPrimary` flags — see
 * Task 3's amendment below for why `people` alone can't always be trusted to carry it). */
export function pocConfidence(people: PersonLike[], candidates: CandidateSet | null, primaryPerson: string | null): PocConfidence;
```
Rules, in order: `primaryPerson` is set → `primary`, label `Primary contact set by you` (checked directly, regardless of whether any `people` row carries that name); a revealed person whose title matches `/\b(owner|owner\/operator|founder|co-founder|president|ceo|chief|principal|proprietor|partner)\b/i` **and does not match** `/\b(assistant|coordinator|to the)\b/i` → `decision_maker`, `Decision-maker`; matches `/\b(manager|director|head of|operations)\b/i` → `manager`, `Best available: <title> — no owner listed in Apollo`; any other revealed person → `staff`, `Staff contact — no decision-maker listed in Apollo`; nobody revealed → `none`, with label `No people found in Apollo` when `candidates` exists and is empty, `Not searched yet` when `candidates` is null, else `Candidates found — choose who to reveal`.

Fix round for 3eed43d: the decision-maker regex is word-bounded (an unbounded `partner` matched inside "Partnerships", misreading a coordinator as a decision-maker), gained `chief` and an explicit `owner/operator` compound, and now excludes support-role titles ("Owner's assistant", "Assistant to the Owner", "Partnerships Coordinator") that otherwise contain a decision-maker word — those fall through to the manager/staff rules on their own title instead. Pinned cases: "Chief Executive Officer" → `decision_maker`; "Owner's assistant", "Assistant to the Owner", "Partnerships Coordinator", "Managing Barista" → `staff`; "Barista Manager", "Managing Director" → `manager`.

- [x] **Step 1: Failing tests** for every rule above, including "Production/Operations Manager" → `manager`, "Store Manager" → `manager`, "Owner" → `decision_maker`, "Barista" → `staff`, precedence of a manual primary over an Apollo owner.
- [x] **Step 2: Run, expect failures.**
- [x] **Step 3: Implement** the pure function; render the label under the People heading (muted text; amber for `staff`/`manager`), and the candidate picker from Task 1: each candidate row shows title, `has email` / `no email`, and a `Reveal (1 credit)` button (disabled when `!hasEmail`, hint `Apollo has no email for this person`), plus a `Find people` button that calls `POST /candidates` (label `Refresh candidates` when a set exists; show `Searched <time ago>`) — no domain on the business means that call costs a credit (Task 1's fix round, R7), so a business with no usable website domain (`domainFromUrl` would return null) renders the button as `Find people (1 credit)` / `Refresh candidates (1 credit)` up front, and the `costsCredit` flag the route's 200 body carries confirms it after the call. Sentence case; 375 px: rows stack; no overflow.
- [x] **Step 4: tsc, lint, unit exit 0.**
- [x] **Step 5: Commit** `feat(leads): contact confidence label and candidate picker in the People section`.

---

### Task 3: Your knowledge wins — primary contact, add a person, "not the decision-maker"

**Files:**
- Create: `src/app/api/businesses/[id]/people/route.ts`, `src/components/leads/AddPersonForm.tsx`
- Modify: `src/lib/leads/queries.ts`, `src/components/leads/PeopleSection.tsx`, `src/components/leads/LeadDetail.tsx`, `src/components/leads/LeadsTable.tsx` (new "Contact" column — not originally listed, needed for the Leads-table requirement below), `src/lib/leads/pocConfidence.ts` (Task 2 review fix, folded in here — see Amendment note)
- Test: `tests/db/peopleRoute.test.ts` (new; mirror helpers from `tests/db/businessEnrichRoute.test.ts`), `tests/db/leadQueriesOmit.test.ts` (updated), `tests/unit/leads/pocConfidence.test.ts` (updated)

**Interfaces:**
```ts
// POST /api/businesses/:id/people  body: { name: string (1–120), title?: string (≤120), email?: string, phone?: string, note?: string (≤500), setPrimary?: boolean }
//   → creates Contact rows with source "manual" (email → type email lower-cased through normalizeEmail; phone →
//     type phone, normalized to E.164 through normalizePhone — the same normalizer zipSearch/promote already use,
//     not the raw typed string — 400 when it doesn't normalize, same as an invalid email; a note goes into
//     Business.notes appended as "Contact note (<name>): …" via a single parameterized
//     `UPDATE ... CASE` statement inside the same $transaction as the rest of the call — atomic
//     AND serialized against a concurrent add, not a read-then-write of a pre-fetched value (fix
//     round, Task 4 re-review — see that task's own follow-up (a) for why the read-then-write
//     version wasn't actually serialized against a second concurrent writer));
//     when `setPrimary` (default true) sets Business.primaryPerson = name; writes activity
//     `Added <name>[, <title>] by hand[ (set as primary)]`.
//   → 400 when neither email nor phone nor title is given AND the name already exists; 200 { business }.
//   → fix round (review): adding a person whose email/phone already exists as a Contact row never rewrites that
//     row's `source`/`apolloId` (an Apollo-sourced row stays Apollo-sourced, and therefore still suppressible —
//     see PATCH below), and only fills a *missing* `personName` rather than overwriting one (an existing name
//     mismatch would otherwise split that person's email/LinkedIn rows into two different "people" the next time
//     `groupPeople` runs). A blank form title never wipes an existing row's title; a non-blank one does overwrite it.
// PATCH /api/businesses/:id/people  body: { primaryPerson: string | null } | { suppressApolloId: string }
//   → primaryPerson: must match an existing person on this business, case-insensitively and after the same
//     trim+collapse-whitespace normalization POST uses — either a Contact row's personName, OR (fix round,
//     review: widened) the business's own *current* primaryPerson, so re-confirming an already-synthesized
//     primary (no Contact row at all) doesn't 400 against itself; stores the matched Contact row's own
//     personName/personTitle (case-preserving), or preserves the current primaryPersonTitle when only the
//     current-primaryPerson branch matched; null clears both primaryPerson and primaryPersonTitle.
//   → suppressApolloId: adds to Business.suppressedApolloIds, deletes Contact rows matching `source: "apollo" AND
//     apolloId: <id>` (never a website/manual row that merely shares an email/linkedin value — see Task 1's fix
//     round, R3: apolloId is only ever backfilled onto an already-Apollo-sourced row in the first place) and
//     clears primaryPerson if it pointed at them, removes them from Business.candidates, writes activity
//     `Removed <name> (not the decision-maker)`.
//   → fix round (review): idempotent — an id already in suppressedApolloIds is a 200 no-op (no deletes, no second
//     activity row); an id matching neither a Contact row nor the stored candidate list is a 404 "Unknown person".
```
- Suppression needs the Apollo id of a revealed person: `Contact.apolloId` (added and populated in Task 1, scoped to `source: "apollo"` rows only) links each Apollo-sourced row to the person, and `candidates` carries the id for people not yet revealed.
- Plan gap closed (fix round for 3eed43d, ahead of this task's own implementation): only an email or a phone produces a `Contact` row — a name + title alone (the 400 rule above only fires when the name *also* already exists) creates zero contact rows, so `Business.primaryPerson` can legitimately point at a name no `Contact` row carries. `pocConfidence`'s `primary` check already reads `primaryPerson` directly rather than scanning `people` for an `isPrimary` flag (see Task 2's amended interface), so it doesn't need this task to do anything extra. `groupPeople` (in `LeadDetail.tsx`) synthesizes a bare row — `{ name: primaryPerson, title: null, source: "manual", isPrimary: true }` — for a `primaryPerson` with no matching contact, so the name still leads the People section and gets its `Primary` badge even though POST /people never wrote it a `Contact` row. Both pieces are already in place; this task's own `groupPeople`/`AddPersonForm` work should build on them, not duplicate them.

**Amendment (this task's own implementation, decided ahead of coding since the plan's synthesized-row sketch above elided it): where does a name+title-only primary's *title* live?** A synthesized `{ title: null, ... }` row loses the title the rep just typed. Rejected options: a fourth Contact row shaped `{ type: "email", value: "" }` (the `@@unique([businessId, type, value])` constraint and an empty value both make this unworkable); stuffing the title into `Business.notes` (unstructured, `groupPeople` would need to parse it back out). **Decision:** add `Business.primaryPersonTitle String?` via a small additive migration (`poc_primary_title` — this ships in Task 3, not Task 1, since the need only became concrete here; still additive, so it doesn't conflict with the "no new migration" note in the global file structure). `groupPeople`'s synthesized row uses it for `title`; a `primaryPerson` that *does* match a `Contact` row still takes its title from that row's own `personTitle` (unchanged) — `primaryPersonTitle` is only ever read for the no-Contact-row case. `POST /people` sets it alongside `primaryPerson` whenever `setPrimary` is true; `PATCH { primaryPerson }` re-derives it from the matched Contact row (or preserves it, re-confirming an already-synthesized primary to the same name).

Also decided ahead of coding, from the Task 2 review: `PeopleSection`'s `Person` type gained a fourth field, `apolloId: string | null`, alongside `key`/`email`/`linkedin` — `groupPeople` sets it from whichever contact row is first seen for that name — so "Not the decision-maker" can be scoped to `source === "apollo" && apolloId != null` rather than to `source === "apollo"` alone (a manual row can theoretically share the `apollo` source label without ever carrying an id). The Leads table gained a "Contact" column (it had none before): `primaryPerson` when set, else the first named contact — `src/lib/leads/queries.ts`'s `listOnlyOmit` drops `primaryPerson` from its omit list to support this (keeping `candidates`/`candidatesAt`/`suppressedApolloIds`/`primaryPersonTitle` omitted), and `tests/db/leadQueriesOmit.test.ts` was updated to match. Two loose ends from the Task 2 review were also closed here rather than left for a later fix round: `pocConfidence`'s `chief` match was tightened to `chief executive|chief\s+\w+\s+officer`, and each "Reveal" button's visible label now includes the candidate's first name ("Reveal Lee (1 credit)") instead of carrying a differing `aria-label` — both in `src/lib/leads/pocConfidence.ts` / `src/components/leads/PeopleSection.tsx`, with tests in `tests/unit/leads/pocConfidence.test.ts`.

**Fix round (review of c971c52):** `chief\s+\w+\s+officer` only matched a single word between "chief" and "officer," missing real multi-word C-suite titles ("Chief Human Resources Officer," "Chief Diversity and Inclusion Officer") — widened to `chief(?:\s+\w+){1,3}\s+officer`; "Chief Barista" is still excluded (no trailing "officer"). `groupPeople` and `LeadsTable`'s `leadContactName` were both extracted into pure, dependency-free modules (`src/lib/leads/groupPeople.ts`, `src/lib/leads/leadContactName.ts`) so they're unit-tested directly (`tests/unit/leads/groupPeople.test.ts`, `tests/unit/leads/leadContactName.test.ts`) instead of only indirectly through the components. `PeopleSection`'s 5s "Confirm remove" timer now clears on unmount. `AddPersonForm` catches a `fetch` rejection (not just a non-2xx response) and surfaces it inline plus a toast. `POST /people`'s contact-row upsert no longer rewrites an existing row's `source`/`apolloId`, and only fills a missing `personName` (see the Interfaces block above); phone is normalized through `normalizePhone`/E.164; the whole handler runs in one `$transaction`, and the `notes` append is atomic and serialized (a single `UPDATE ... CASE` statement, not a read-then-write — fix round, Task 4 re-review, follow-up (a)). `PATCH { suppressApolloId }` is now idempotent (repeat suppress of an already-suppressed id is a no-op 200) and 404s on an id that matches neither a Contact row nor the stored candidate list.

- [x] **Step 1: Failing tests**: add person with email + title sets primary and creates two contacts; add person with only a name → 400; add person with only a name + title (no email/phone) and a new name → 200, zero contact rows, `primaryPerson` still set, `groupPeople`/`pocConfidence` still see them via the synthesized row; primary must exist; suppress deletes Apollo rows, clears primary, adds the id, logs the row; `groupPeople` output marks `isPrimary`; `pocConfidence` returns `primary` afterwards.
- [x] **Step 2: Run, expect failures.**
- [x] **Step 3: Implement.** People rows get a `Primary` badge and a `Set as primary` ghost button; Apollo rows get `Not the decision-maker` (confirm inline, then PATCH suppress). `AddPersonForm`: name, title, email, phone, note, "Set as primary" checkbox (Base UI `Checkbox onCheckedChange(boolean)`), submit `Add person`; validation messages inline; sentence case. Leads table: when `primaryPerson` is set, the contact column shows that name first.
- [x] **Step 4: tsc, lint, unit, db exit 0.**
- [x] **Step 5: Commit** `feat(leads): manual primary contact, add a person, and "not the decision-maker" suppression`.

---

### Task 4: Manual assists when no database knows the owner

**Files:**
- Create: `src/lib/leads/manualAssists.ts`, `src/components/leads/ManualAssists.tsx`
- Modify: `src/components/leads/PeopleSection.tsx`
- Test: `tests/unit/leads/manualAssists.test.ts`

**Interfaces:**
```ts
export function assistLinks(b: { name: string; formattedAddress: string | null; websiteUrl: string | null; phone: string | null }): {
  linkedinPeople: string; facebookPages: string; googleOwner: string; tel: string | null;
};
// linkedinPeople = https://www.linkedin.com/search/results/people/?keywords=<encoded "name city">
// facebookPages  = https://www.facebook.com/search/pages/?q=<encoded "name city">
// googleOwner    = https://www.google.com/search?q=<encoded "\"name\" city owner">
// tel            = tel:+1<digits> when phone parses, else null
```
- Render as a compact row under the confidence label when level is `manager`, `staff` or `none`: `Find the owner: LinkedIn · Facebook · Google`, and when `tel` exists: `Call and ask for the owner` (a `tel:` link with the number). Links open in a new tab (`rel="noopener noreferrer"`). `Button` rendered as `<a>` uses `nativeButton={false}`.

- [x] **Step 1: Failing tests**: URL shapes and encoding (a name with `&` and an apostrophe), city taken from `regionFromAddress`, `tel` null for a missing/unparseable phone.
- [x] **Step 2: Run, expect failures.**
- [x] **Step 3: Implement.**
- [x] **Step 4: tsc, lint, unit exit 0.**
- [x] **Step 5: Commit** `feat(leads): owner-search links and a call prompt when no decision-maker is known`.

---

### Task 5 (spike, optional): officer records for registered entities

**Question:** would an officer-records source (OpenCorporates API, paid for commercial use; jurisdiction filter from the lead's state) name the owner for a useful share of leads that Apollo misses?

- [ ] **Step 1:** `scripts/officer-spike.ts` (throwaway, not wired to the app): takes `--limit 20`, reads `OPENCORPORATES_API_TOKEN` from the environment (exit with a clear message when absent), queries `/v0.4/companies/search?q=<name>&jurisdiction_code=us_<state>` then `/companies/<jurisdiction>/<number>/officers` for the best name match, prints `business | matched entity | officers`.
- [ ] **Step 2:** run on 20 yellow/green leads with no decision-maker; report hit rate and false-match rate in the ledger.
- [ ] **Step 3:** decision with the user: build a provider (own plan) or drop it. Nothing from this task is committed to `src/`.

---

## Done criteria for Plan 10

- On any lead, "Find people" lists Apollo's candidates for free, and "Reveal (1 credit)" on a chosen candidate produces that person's email and LinkedIn.
- The People section states plainly whether the contact is a decision-maker, a manager as best available, staff, or unknown.
- A person you add by hand becomes the primary contact, leads the People section and the Leads table, and a wrong Apollo person can be removed so it never returns.
- Links to LinkedIn, Facebook and Google plus a call prompt appear whenever no decision-maker is known.
- Live check on Pearland Coffee Roasters: candidates show the Store Manager (no email) and the Production/Operations Manager (email); adding "Albert" as primary shows `Primary contact set by you`; suppressing Addison Neel removes the rows and keeps them out of a later auto-enrich.

## Follow-ups (not in this plan)

Bulk enrich progress UI; re-score on Settings chain-list edits; skip the paid reveal on a national fallback; officer-records provider if the spike pays off.
