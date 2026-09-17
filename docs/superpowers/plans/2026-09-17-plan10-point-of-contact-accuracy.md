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
- Migrations are additive. Deploy web + worker together (the enrich job data shape changes).
- `npm run test:db` from one process at a time. Commit per task; `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` last line.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + migration `poc_accuracy` | `Business.candidates Json?`, `candidatesAt DateTime?`, `primaryPerson String?`, `suppressedApolloIds String[] @default([])`, `Contact.apolloId String?` |
| `src/lib/enrichment/candidates.ts` (**new**) | `findCandidates(businessId, ownerId, deps)`: free search → ranked candidate list stored on the business; `Candidate` type; suppression filter |
| `src/lib/jobs/enrich.ts` | `runEnrich` accepts `apolloId` (reveal exactly that candidate, no search); honours `suppressedApolloIds` on the auto path |
| `src/lib/jobs/queues.ts` | `EnrichJobData.apolloId?` |
| `src/app/api/businesses/[id]/candidates/route.ts` (**new**) | `POST` runs `findCandidates`; `GET` returns the stored list |
| `src/app/api/businesses/[id]/enrich/route.ts` | body gains `apolloId` |
| `src/app/api/businesses/[id]/people/route.ts` (**new**) | `POST` add a manual person; `PATCH` set primary / suppress an Apollo person |
| `src/lib/leads/pocConfidence.ts` (**new**) | `pocConfidence(people, candidates) → { level, label }` |
| `src/lib/leads/queries.ts` | detail include carries the new columns |
| `src/components/leads/LeadDetail.tsx` (+ `PeopleSection.tsx`, `AddPersonForm.tsx`, `ManualAssists.tsx` **new**) | candidate picker, confidence line, primary marker, add/suppress actions, search links and call prompt |
| `tests/db/candidates.test.ts`, `tests/db/enrich.test.ts`, `tests/db/peopleRoute.test.ts`, `tests/unit/leads/pocConfidence.test.ts`, `tests/unit/leads/manualAssists.test.ts` | behaviour |

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
 * filters out `suppressedApolloIds`; stores the set on Business.candidates/candidatesAt; returns it. Never reveals. */
export async function findCandidates(businessId: string, ownerId: string, deps: JobDeps): Promise<CandidateSet>;
// runEnrich opts gains `apolloId?: string`: when set, skip the search, reveal that id only (credit cap and
// recency rules unchanged; `force` implied), and log `Enriched via Apollo: revealed <title> chosen by you; …`.
// EnrichJobData gains `apolloId?: string`; POST /enrich body gains `apolloId: z.string().min(1).optional()`.
```
- Candidate rows carry the first name and title Apollo already shows for free; last names stay obfuscated until a reveal.

- [ ] **Step 1: Failing tests**
`tests/db/candidates.test.ts`: (a) `findCandidates` on a business with a domain stores a `CandidateSet` with the fake provider's two people ranked Owner first, `scope`/`totalAtDomain` from the result, `candidatesAt` set; (b) a suppressed id is filtered out; (c) org-mismatch on the no-domain branch yields an empty set and no activity row (reuse Task 4's guard via the provider call — assert `calls.enrich === 0`).
`tests/db/enrich.test.ts`: (d) `runEnrich(id, owner, deps, { apolloId: "fake-…-gm" })` reveals exactly that person (`calls.search === 0`, `calls.enrich === 1`), respects the credit cap, writes the "chosen by you" row; (e) the auto path skips a suppressed id and reveals the next candidate.
`tests/db/businessEnrichRoute.test.ts`: (f) `POST /enrich { apolloId }` → 202 with `estimatedCredits: 1`; (g) `POST /candidates` → 200 with the set; `GET /candidates` returns it; 404 for another owner's business.

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement.** Migration first. `findCandidates`: `regionFromAddress`, `domainFromUrl`, `deps.providers.enrichment.searchPeople({ domain, orgName, city, state, metro: cfg.enrichment.metroLocation }, ENRICH_CONFIG.searchPageSize)`; on the no-domain branch keep `orgNameMatches` (import from apollo.ts) exactly as `runEnrich` does; map to `Candidate[]` (rank = index after the provider's ranking), drop `suppressedApolloIds`; persist. Routes: `POST /candidates` = `findCandidates` inline (it is a free call; run it in the request with the same provider checks the enrich route does — configured/enabled/plan-block — and a 409 on `BudgetExhaustedError`); `GET` returns the stored set or `null`. `runEnrich`: when `opts.apolloId` is set, skip search + guards that need search data, `enrichPerson(apolloId)`, one reveal, same contact upsert path, message per Interfaces. Auto path: filter `people` by `!suppressedApolloIds.includes(p.apolloId)` before the loop.

- [ ] **Step 4: tsc, lint, unit, db exit 0.**
- [ ] **Step 5: Commit** `feat(enrich): free "Find people" candidate list stored on the lead; reveal a chosen candidate by Apollo id; suppressed ids never come back`.

---

### Task 2: Confidence you can read

**Files:**
- Create: `src/lib/leads/pocConfidence.ts`
- Modify: `src/components/leads/LeadDetail.tsx` (People section; split into `src/components/leads/PeopleSection.tsx` while there)
- Test: `tests/unit/leads/pocConfidence.test.ts`

**Interfaces:**
```ts
export type PocLevel = "primary" | "decision_maker" | "manager" | "staff" | "none";
export type PocConfidence = { level: PocLevel; label: string };
/** `people` = grouped People rows (name, title, source, isPrimary); `candidates` = stored CandidateSet | null. */
export function pocConfidence(people: PersonLike[], candidates: CandidateSet | null): PocConfidence;
```
Rules, in order: a manual primary → `primary`, label `Primary contact set by you`; a revealed person whose title matches `/owner|founder|co-founder|president|ceo|principal|proprietor|partner/i` → `decision_maker`, `Decision-maker`; matches `/manager|director|head of|operations/i` → `manager`, `Best available: <title> — no owner listed in Apollo`; any other revealed person → `staff`, `Staff contact — no decision-maker listed in Apollo`; nobody revealed → `none`, with label `No people found in Apollo` when `candidates` exists and is empty, `Not searched yet` when `candidates` is null, else `Candidates found — choose who to reveal`.

- [ ] **Step 1: Failing tests** for every rule above, including "Production/Operations Manager" → `manager`, "Store Manager" → `manager`, "Owner" → `decision_maker`, "Barista" → `staff`, precedence of a manual primary over an Apollo owner.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement** the pure function; render the label under the People heading (muted text; amber for `staff`/`manager`), and the candidate picker from Task 1: each candidate row shows title, `has email` / `no email`, and a `Reveal (1 credit)` button (disabled when `!hasEmail`, hint `Apollo has no email for this person`), plus a `Find people` button that calls `POST /candidates` (label `Refresh candidates` when a set exists; show `Searched <time ago>`). Sentence case; 375 px: rows stack; no overflow.
- [ ] **Step 4: tsc, lint, unit exit 0.**
- [ ] **Step 5: Commit** `feat(leads): contact confidence label and candidate picker in the People section`.

---

### Task 3: Your knowledge wins — primary contact, add a person, "not the decision-maker"

**Files:**
- Create: `src/app/api/businesses/[id]/people/route.ts`, `src/components/leads/AddPersonForm.tsx`
- Modify: `src/lib/leads/queries.ts`, `src/components/leads/PeopleSection.tsx`, `src/components/leads/LeadDetail.tsx`
- Test: `tests/db/peopleRoute.test.ts` (new; mirror helpers from `tests/db/businessEnrichRoute.test.ts`)

**Interfaces:**
```ts
// POST /api/businesses/:id/people  body: { name: string (1–120), title?: string (≤120), email?: string, phone?: string, note?: string (≤500), setPrimary?: boolean }
//   → creates Contact rows with source "manual" (email → type email lower-cased through normalizeEmail; phone → type phone; a note goes into
//     Business.notes appended as "Contact note (<name>): …"); when `setPrimary` (default true) sets Business.primaryPerson = name.
//   → 400 when neither email nor phone nor title is given AND the name already exists; 200 { business }.
// PATCH /api/businesses/:id/people  body: { primaryPerson: string | null } | { suppressApolloId: string }
//   → primaryPerson: must match an existing personName on this business (or null to clear); 
//   → suppressApolloId: adds to Business.suppressedApolloIds, deletes that person's Apollo-sourced Contact rows (email/linkedin) and clears
//     primaryPerson if it pointed at them, removes them from Business.candidates, writes activity `Removed <name> (not the decision-maker)`.
```
- Suppression needs the Apollo id of a revealed person: `Contact.apolloId` (added and populated in Task 1) links each Apollo-sourced row to the person, and `candidates` carries the id for people not yet revealed.

- [ ] **Step 1: Failing tests**: add person with email + title sets primary and creates two contacts; add person with only a name → 400; primary must exist; suppress deletes Apollo rows, clears primary, adds the id, logs the row; `groupPeople` output marks `isPrimary`; `pocConfidence` returns `primary` afterwards.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** People rows get a `Primary` badge and a `Set as primary` ghost button; Apollo rows get `Not the decision-maker` (confirm inline, then PATCH suppress). `AddPersonForm`: name, title, email, phone, note, "Set as primary" checkbox (Base UI `Checkbox onCheckedChange(boolean)`), submit `Add person`; validation messages inline; sentence case. Leads table: when `primaryPerson` is set, the contact column shows that name first.
- [ ] **Step 4: tsc, lint, unit, db exit 0.**
- [ ] **Step 5: Commit** `feat(leads): manual primary contact, add a person, and "not the decision-maker" suppression`.

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

- [ ] **Step 1: Failing tests**: URL shapes and encoding (a name with `&` and an apostrophe), city taken from `regionFromAddress`, `tel` null for a missing/unparseable phone.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: tsc, lint, unit exit 0.**
- [ ] **Step 5: Commit** `feat(leads): owner-search links and a call prompt when no decision-maker is known`.

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
