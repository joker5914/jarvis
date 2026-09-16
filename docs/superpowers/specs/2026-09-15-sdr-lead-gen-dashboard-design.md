# SDR Lead Gen Dashboard — Design

**Date:** 2026-09-15
**Status:** Approved in brainstorming, pending written review
**Audience:** Comcast Business SMB sales rep (single user today, team-ready later)

## 1. Purpose

A hosted web dashboard that finds small and medium businesses (SMBs) in a Houston-area
zip code, gathers valid contact information for each (phone, email, website, social and
LinkedIn links, decision-maker names), and layers in construction-project intelligence
from the Texas Department of Licensing and Regulation (TDLR) Architectural Barriers
registry so that businesses building or renovating a location surface *before* they open.

The user sells Comcast Business internet, mobile lines, business voice, TV, and add-ons
to SMBs only. Enterprise, government, school, hospital, and chain accounts are out of
scope and must be excluded from the working lead list.

Primary success criteria:

1. Enter a zip code, get a deduplicated list of SMBs with a contact-quality badge
   within a few minutes.
2. See TDLR projects in Houston ranked by SMB fit and by how soon they complete.
3. Track outreach status, products pitched, tags, and notes per business, and filter
   on all of them.
4. Never spend paid API credits without an explicit click.

## 2. Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Data sourcing | Google Places API for discovery, scraping of each business's *own* website for contacts, Apollo.io for optional paid enrichment. No scraping of Google Maps or LinkedIn. |
| Enrichment provider | Provider interface; Apollo first; fully optional (app works with no key). |
| Persistence | Saved searches, deduplicated businesses, outreach tracking (status, notes, tags, products pitched). |
| Hosting | Hosted for a single user (Railway). Minimal passphrase gate. Designed so real auth is a later drop-in. |
| Search definition | Zip code only; the tool fans out across a fixed SMB category list automatically. Each business is tagged with the category that surfaced it. |
| "Valid contact" | Present + well-formed + reachable (website loads, email domain has MX). Deliverability verification is a future optional add-on. |
| Stack | TypeScript end to end: Next.js 15 (App Router), Prisma + Postgres, pg-boss worker. |
| Architecture | Next.js monolith with a separate worker process, same repo. |
| TDLR | Nightly + on-demand sync of Houston projects via the site's JSON search endpoint and HTML detail pages. |
| Enterprise exclusion | Hard exclusion tier (hidden by default) plus a graded SMB fit score. |
| Product fit | Category to suggested Comcast package map, editable in settings. "Products pitched" multi-select per business. |
| Current provider | Detect mentions of AT&T, Spectrum, Verizon, T-Mobile, etc. on website/listing text; store as a low-confidence hint. |
| Promotion of projects | Manual "Find business" per project plus a batch "Promote high-fit" button. |
| TDLR refresh | Re-fetch open projects last checked more than 30 days ago. |
| Background scanning | A Scanner runs autonomously inside a user-defined operating window (start and end date/time, optional daily hours), works through a target zip list and TDLR sync on its own, and can be paused or stopped at any moment. |

## 3. Architecture

### 3.1 Runtime

- **Web:** Next.js 15, App Router, TypeScript. Server components render pages. Route
  handlers under `/api/*` expose the JSON API used by the UI for mutations and polling.
  The same API is what a future mobile client or browser extension would use.
- **Worker:** A second Node process (`src/worker/index.ts`) in the same repo. Uses
  **pg-boss** (queue stored in Postgres; no Redis). The web app enqueues jobs and returns
  immediately; the worker executes them and writes progress the UI polls every 2 s.
- **Database:** Postgres via Prisma. Local dev uses Postgres in Docker Compose; hosted
  uses the Railway Postgres add-on. One schema everywhere.
- **Hosting:** Railway, two services from one repo (`web`, `worker`) plus Postgres.
  Deploy on push.

### 3.2 Provider interfaces (`src/lib/providers`)

Each external dependency sits behind a small TypeScript interface with exactly one
implementation today.

| Interface | Implementation | Input and output |
|---|---|---|
| `DiscoveryProvider` | Google Places (Text Search + Place Details) | `(zip, category)` returns normalized `DiscoveredBusiness[]` |
| `GeocodeProvider` | Google Geocoding | `zip` returns `{lat, lng, city, state, radiusMeters}` |
| `EnrichmentProvider` | Apollo.io | `domain` (or name + address fallback) returns `Person[]` with title, email, LinkedIn URL |
| `ValidationProvider` | built-in | website reachability (HEAD/GET with timeout), email domain MX lookup |
| `ProjectRegistryProvider` | TDLR TABS | `(sinceRegistrationDate, page)` returns `ProjectSummary[]`; `(projectNumber)` returns `ProjectDetail` |

All outbound calls to Google and Apollo pass through a **budget wrapper** that counts
daily usage per provider against a limit set in Settings. When a limit is hit, the
running job pauses with a clear message instead of overspending.

### 3.3 Configuration and secrets

- Environment variables: `DATABASE_URL`, `APP_PASSPHRASE`, `APP_SECRET` (cookie signing
  and key encryption), optional `GOOGLE_MAPS_API_KEY`, `APOLLO_API_KEY`.
- The Settings page can also store provider keys, encrypted with `APP_SECRET`
  (AES-256-GCM) in the `ProviderConfig` table. An env var wins if both are set.

### 3.4 Access gate and auth seam

- `middleware.ts` checks for a signed cookie. Missing or invalid redirects to `/unlock`,
  a single passphrase page. The correct passphrase sets the cookie for 30 days.
- Every route handler and server component obtains the current actor through one
  function, `getActor()`, which today returns a fixed single-user record
  (`id = "local-user"`). Adding real auth (for example Auth.js) means changing
  `getActor()` and the middleware only.
- Every user-data table has an `ownerId` column defaulting to `"local-user"`.
- The navbar reserves a slot on the right for a user menu.

## 4. Data model (Prisma)

All timestamps are UTC. `ownerId String @default("local-user")` on every table below
except `ProviderConfig` and `SyncState`, which are global.

### Search
| Field | Notes |
|---|---|
| id, ownerId, createdAt, updatedAt | |
| zip | 5-digit string |
| city, state, lat, lng, radiusMeters | resolved by geocoder |
| status | `queued`, `running`, `paused`, `complete`, `failed` |
| progress | JSON: `{ step, current, total, message }` |
| countsFound, countsScraped, countsEnriched | integers |
| error | nullable text |

### Business
| Field | Notes |
|---|---|
| id, ownerId, createdAt, updatedAt | |
| googlePlaceId | unique, nullable (TDLR-only businesses have none) |
| name, formattedAddress, zip, lat, lng | |
| phone | as returned by Google |
| websiteUrl | nullable |
| googleRating, googleReviewCount | nullable |
| googleTypes | string[] |
| primaryCategory | slug from the fixed SMB category list |
| source | `zip_search`, `tdlr`, `manual` (first source) |
| exclusion | `none`, `enterprise` |
| exclusionReasons | string[] |
| smbFitScore | 0 to 100 |
| contactQualityScore | 0 to 100 |
| contactQualityBand | `green`, `yellow`, `red` |
| contactQualityReasons | JSON array of `{ code, points, detail }` |
| suggestedPackage | slug from the package map |
| currentProviderHint | nullable, e.g. `"att"` |
| currentProviderEvidence | nullable text snippet |
| outreachStatus | `not_contacted`, `contacted`, `interested`, `not_a_fit`, `customer` |
| productsPitched | string[] of product slugs |
| notes | text, autosaved |
| websiteReachable, websiteCheckedAt, websiteError | |
| lastEnrichedAt | nullable |

### SearchBusiness
`(searchId, businessId)` composite key, plus `surfacedByCategory`.

### Contact
| Field | Notes |
|---|---|
| id, ownerId, businessId | |
| type | `email`, `phone`, `linkedin`, `facebook`, `instagram`, `twitter`, `yelp`, `other` |
| value | normalized (lowercase email, E.164 phone, canonical URL) |
| personName, personTitle | nullable |
| source | `google`, `website`, `apollo`, `tdlr`, `manual` |
| validationStatus | `unchecked`, `valid`, `invalid`, `unreachable` |
| validatedAt | nullable |
| unique on `(businessId, type, value)` | |

### Tag and BusinessTag
`Tag { id, ownerId, name, color, isSystem }`. System tags are the SMB categories,
auto-created. `BusinessTag (businessId, tagId)`.

### Project (TDLR)
| Field | Notes |
|---|---|
| id, ownerId, createdAt, updatedAt | |
| tdlrProjectId | GUID from TDLR |
| projectNumber | unique, e.g. `TABS2027001089` |
| projectName, facilityName | |
| locationAddress, city, zip, county | parsed from detail page |
| statusCode, statusLabel | TDLR status |
| workType | `new_construction`, `renovation`, `addition`, `historic`, `row` |
| estimatedCost, squareFootage | |
| tenantFunded | boolean, from "Are the private funds provided by the tenant?" |
| fundsType, scopeOfWork | text |
| startDate, completionDate, registrationDate | |
| ownerName, ownerAddress, ownerPhone, contactName | |
| tenantName, designFirmName, rasName, rasPhone | nullable |
| smbFitScore | 0 to 100 |
| smbFitReasons | JSON |
| exclusion, exclusionReasons | as on Business |
| timingWindow | derived, see 6.3 |
| businessId | nullable FK once promoted |
| detailFetchedAt, lastCheckedAt, parseError | |

### ProviderConfig
`{ provider (unique), encryptedKey, enabled, dailyBudget, usedToday, usageDate }`.

### SyncState
`{ key (unique, e.g. "tdlr"), lastSuccessfulAt, cursor JSON }`.

### ActivityLog
`{ id, ownerId, businessId?, projectId?, kind, message, createdAt }`. What the tool did
and when, shown on the lead detail page.

### ScanSchedule
One row per owner (upserted). Controls the background Scanner (see 5.6).

| Field | Notes |
|---|---|
| id, ownerId, updatedAt | |
| enabled | master switch; `false` means the Scanner never enqueues work |
| windowStart, windowEnd | datetimes; the Scanner only works between them |
| dailyStartTime, dailyEndTime | optional `HH:mm` local time bounds within the window, e.g. only 06:00 to 22:00 |
| daysOfWeek | int[] (0 to 6); empty means every day |
| timezone | IANA name, default `America/Chicago` |
| zipRefreshDays | re-search a target zip after this many days (default 7) |
| tdlrSyncHours | run TDLR sync after this many hours (default 6) |
| websiteRecheckDays | re-scrape a business website after this many days (default 30) |
| autoAddHotZips | add the zip of any high-fit `opening_soon` or `under_construction` project to the target list (default true) |
| maxConcurrentJobs | default 1 |

### ScanTarget
The zip list the Scanner works through.

| Field | Notes |
|---|---|
| id, ownerId, zip | unique on `(ownerId, zip)` |
| priority | integer, higher first |
| addedBy | `user`, `auto_tdlr` |
| lastSearchedAt | nullable |
| lastSearchId | nullable |
| paused | per-zip pause |

### ScannerState
Singleton per owner, written by the Scanner tick and read by the UI.

| Field | Notes |
|---|---|
| status | `idle`, `running`, `paused`, `outside_window`, `budget_exhausted`, `disabled` |
| pauseRequested | set by the Pause button; running jobs check it between steps |
| currentJobId, currentActivity | e.g. `"Zip search 77084: contact extraction 12/34"` |
| lastTickAt, nextPlanned | next planned work item and when |
| lastError | nullable |

## 5. Jobs and data flow

All jobs run on the worker. Job payloads are small (IDs only). Progress is written to the
parent row's `progress` JSON after every step. Steps are idempotent via upserts so a
retry resumes safely.

### 5.1 Zip search job
1. Geocode zip to center, radius, city, state. Save on Search.
2. For each category in the SMB category list, run Places Text Search
   (`"<category> in <zip>"` biased to the center and radius), paging up to 60 results.
   Collect unique Place IDs. Fetch Place Details for new IDs only.
3. Apply enterprise exclusion (6.1). Excluded businesses are still stored, flagged.
4. Upsert Business rows; link to Search via SearchBusiness with the surfacing category.
   Existing businesses refresh Google fields but keep outreach fields untouched.
5. **Contact extraction** for each business with a website (concurrency 4, 10 s timeout,
   plain descriptive user agent): fetch the homepage plus up to three likely pages
   (`/contact`, `/about`, and any link whose text matches contact or about). Extract
   emails (including `mailto:` and simple obfuscations like `name [at] domain`), phones
   (`tel:` and regex, normalized to E.164), social links (LinkedIn, Facebook, Instagram,
   X/Twitter, Yelp), and current-provider mentions (6.5).
6. MX lookup per new email domain; website reachability recorded from step 5.
7. Recompute contact quality (6.2), mark Search complete.

Apollo enrichment is **never** part of this job. It runs only from "Enrich" (one
business) or "Enrich all" (a search) actions, which enqueue an enrich job per business.

### 5.2 Enrich job (Apollo)
1. Derive domain from `websiteUrl`; fall back to name + city search if none.
2. Call Apollo, capped at 5 people per business, preferring owner, general manager, and
   office manager titles.
3. Upsert Contact rows with `source = apollo`, person name and title, LinkedIn URL.
4. MX-check new email domains, recompute contact quality, set `lastEnrichedAt`.

### 5.3 TDLR sync job
1. Read `SyncState.tdlr.lastSuccessfulAt`. The first run uses the backfill window from
   Settings (default 12 months).
2. POST to `https://www.tdlr.texas.gov/TABS/Search/SearchProjects` with DataTables
   paging (`draw`, `start`, `length=100`, `order[0][column]=3`, `order[0][dir]=desc`)
   and filters `LocationCity=785` (Houston), `RegistrationDateBegin`,
   `RegistrationDateEnd`, `DataVersionId` empty (all). Headers
   `Content-Type: application/x-www-form-urlencoded`, `X-Requested-With: XMLHttpRequest`.
   Response is JSON: `{ recordsTotal, recordsFiltered, data: [{ ProjectId,
   ProjectNumber, ProjectName, ProjectCreatedOn, ProjectStatus, FacilityName, City,
   County, TypeOfWork, EstimatedCost, DataVersionId, EstimatedStartDate,
   EstimatedEndDate }] }`.
3. Skip projects whose `EstimatedEndDate` is more than 90 days in the past.
4. For each new project number, GET `/TABS/Search/Project/<number>` (serialized,
   1 request per second) and parse the detail page: location address and zip, county,
   start and completion dates, cost, type of work, type of funds, scope of work, square
   footage, tenant-funded flag, current status, owner name, address, phone, contact
   name, tenant, design firm, RAS name and phone.
5. Score SMB fit (6.1), apply exclusion, derive timing window (6.3), upsert Project.
6. Re-fetch details for projects with `businessId = null`, not excluded, and
   `lastCheckedAt` older than 30 days.
7. Update `SyncState`.

Runs nightly (pg-boss cron) and on demand from the Projects page.

Code lookups from TDLR's client script: status `3001 Inspection Completed, 3002
Inspection Process, 3003 Inspection Scheduled, 3004 Preliminary Plan Review, 3005
Miscellaneous, 3006 Preliminary Review Pending, 3007 Project Closed, 3008 Project
Registered, 3009 Review Complete, 3010 Review Pending`; work type `9001 New
Construction, 9002 Renovation/Alteration, 9003 Additions to Existing Building, 9004
Historic Preservation, 9005 Public Right of Way`; Houston city code `785`.

### 5.4 Promote job
Triggered by "Find business" on one project or "Promote high-fit" (all non-excluded
projects with `smbFitScore >= threshold` and no `businessId`).
1. Places Text Search for `facilityName` (fallback `projectName`) near the project
   address. If the top result's address matches the project zip and the name similarity
   is high (normalized token overlap at or above 0.8), auto-link. Otherwise the UI shows
   up to 3 candidates to confirm, or "Create from project".
2. If no match, or the user chooses "Create from project": create a Business with
   `source = tdlr`, name from facility or project name, address from the project, and a
   Contact of type `phone`, `source = tdlr`, from the owner phone, with `personName =
   contactName`.
3. Run contact extraction and validation for that business (steps 5.1.5 to 5.1.7).

### 5.5 Rate limits, retries, and errors
- Website failures are per business: record `websiteError`, continue the job.
- Provider errors (quota, 5xx, network): the job fails with retry after 60 s, up to 3
  attempts, then the Search or sync shows `failed` with the reason and a Retry button.
- Budget exhaustion: job status `paused` with a message; Retry resumes from the last
  completed step.
- TDLR HTML parse failure on a detail page: store the error in `parseError` on the
  Project row, skip, continue. A failing parser test is the primary early warning for
  a site layout change.

### 5.6 Scanner (autonomous background scanning)

The Scanner is a pg-boss cron job that ticks every 5 minutes on the worker. Each tick:

1. Load `ScanSchedule`. If `enabled = false`, set state `disabled` and stop. If now is
   outside `windowStart`/`windowEnd`, or outside the daily hours or days of week (in the
   schedule's timezone), set state `outside_window` and stop.
2. If `ScannerState.pauseRequested`, set state `paused` and stop.
3. If a Scanner-owned job is already running (up to `maxConcurrentJobs`), update
   `currentActivity` from its progress and stop.
4. If any provider budget is exhausted, set state `budget_exhausted` and stop; the
   budget resets at midnight in the schedule's timezone.
5. Otherwise pick **one** work item by priority and enqueue it, tagging the job
   `origin = scanner`:
   1. TDLR sync, if `lastSuccessfulAt` is older than `tdlrSyncHours`.
   2. The highest-priority `ScanTarget` that is not paused and whose `lastSearchedAt`
      is null or older than `zipRefreshDays`. Ties go to the oldest `lastSearchedAt`.
   3. A batch of up to 25 non-excluded businesses whose `websiteCheckedAt` is older
      than `websiteRecheckDays`, re-running contact extraction and validation only.
   4. Nothing due: state `idle`, `nextPlanned` set to the soonest future due time.
6. After a TDLR sync, if `autoAddHotZips`, upsert a `ScanTarget` for each zip that has a
   high-fit project with timing window `opening_soon` or `under_construction`, with
   `addedBy = auto_tdlr` and a priority above user-added zips.

**Stop and pause semantics.** Every job checks `pauseRequested` between steps and
between individual website fetches, so a pause takes effect within seconds, not at the
end of a 10-minute search. A paused job records where it stopped; Resume clears the
flag and the next tick re-enqueues the same item, which continues from its last
completed step because steps are idempotent. "Stop" is Pause plus `enabled = false`.
Manual searches and promotes from the UI are unaffected by the Scanner's window or
pause state; they only share the budget wrapper.

**Backoff.** If a Scanner-owned job fails after its retries, the Scanner skips that
item for 6 hours and records `lastError`. Three consecutive failures across different
items set state `paused` with the error so the user sees it rather than the Scanner
burning budget against a broken provider.

**Concurrency with manual work.** Manual jobs and Scanner jobs run on the same worker.
The worker processes at most 2 jobs at once, and a manual job always gets priority in
pg-boss so clicking "Run search" during the day is not stuck behind background work.

## 6. Scoring and classification (`src/lib/scoring`)

All lists and thresholds below are defaults, editable in Settings.

### 6.1 Enterprise exclusion and SMB fit
**Hard exclusion** (`exclusion = enterprise`) if any of:
- Name matches the chain and franchise list (for example Walmart, HEB, Kroger,
  Starbucks, McDonald's, CVS, Walgreens, Home Depot, Memorial Hermann, Methodist, HCA,
  Texas Children's, Kelsey-Seybold).
- Name matches government, education, or health-system patterns (`ISD`, `City of`,
  `County`, `Hospital`, `Medical Center`, `University`, `Federal`, `USPS`).
- Project `estimatedCost > 2,000,000` (default) or `workType = row`.
- Google Places: more than 5 results with the same normalized name in the metro.

**SMB fit score** (0 to 100) for projects and businesses not hard-excluded, summing:
- Positive name keywords (+25): salon, nails, spa, barber, coffee, cafe, bakery,
  taqueria, restaurant, bar, grill, boutique, dental, dentist, chiropractic, optometry,
  daycare, day care, fitness, yoga, pilates, tutoring, clinic, veterinary, pet, cleaners,
  auto, tire, insurance, realty, law office, CPA.
- Tenant-funded build-out (+25).
- Square footage under 5,000 (+15), under 10,000 (+5).
- Estimated cost under 250k (+20), under 750k (+10).
- Work type renovation/alteration (+10), new construction (+5).
- Soft negative keywords (-30 each, floor 0): apartments, church, school, park,
  sidewalk, warehouse, distribution, industrial, "building 0N" shell patterns.

Bands: `high` at 60 or more, `medium` 30 to 59, `low` under 30. Businesses from zip
searches get the same scorer with the project-only inputs treated as absent.

### 6.2 Contact quality
Points: website reachable (25), phone present and well-formed (20), at least one email
with valid MX (30), at least one named person with title (15), at least one social or
LinkedIn link (10). Bands: `green` at 70 or more, `yellow` 40 to 69, `red` under 40.
Stored with the reasons that contributed. Recomputed whenever contacts or website
status change.

### 6.3 Timing window (projects)
Based on today versus `startDate` and `completionDate`:
- `opening_soon`: completion within the next 45 days.
- `under_construction`: started, completion more than 45 days out.
- `planned`: start date in the future.
- `just_completed`: completed within the last 60 days.
- `stale`: completed more than 60 days ago, or status closed.

### 6.4 Category to suggested package
Default map (slugs): `restaurant, bar, cafe` to `internet_tv_voice`; `medical, dental,
veterinary, legal, accounting, insurance` to `internet_voice_multiline`; `salon, retail,
fitness, auto` to `internet_mobile`; `daycare, tutoring` to `internet_voice`; any
project with `workType = new_construction` to `full_bundle`. Product slugs for "products
pitched": `internet, mobile, voice, tv, security, wifi_pro, other`.

### 6.5 Current provider detection
Regex over website text and Google listing text for `AT&T, Spectrum, Charter, Verizon,
T-Mobile, Frontier, Xfinity, Comcast, Google Fiber, Tachus` and phrases like "powered
by", "wifi by", "internet provided by". Store the first match as
`currentProviderHint` with the surrounding sentence as evidence. Always displayed with a
"hint" label; never used in scoring.

## 7. SMB category list (fan-out)

Default categories, each mapped to a Places text query: restaurant, cafe/coffee shop,
bar, bakery, nail salon, hair salon, barber shop, spa, boutique/clothing store, gift
shop, florist, dentist, medical clinic, chiropractor, optometrist, veterinarian, pet
grooming, daycare, tutoring center, gym/fitness studio, yoga/pilates studio, auto repair,
tire shop, car wash, dry cleaner, laundromat, insurance agency, real estate office,
law office, accounting/CPA, tattoo studio, phone repair, print shop, independent
pharmacy. About 34 queries with up to 3 pages each per zip search, within the free
Places tier for a few searches a day; the daily budget guards the rest.

## 8. UI

**Shell.** Top navbar: product name left; links Dashboard, Leads, Projects, Searches,
Scanner, Settings; a compact Scanner status pill (state dot, current activity, and a
Pause/Resume button) and the reserved user-menu slot on the right. Hamburger below the
`md` breakpoint. Max-width container, card layout, Tailwind + shadcn/ui, light and dark
mode.

**Scanner.** Control page for background scanning. Top card: big state indicator
(`Running`, `Paused`, `Outside window`, `Idle`, `Budget exhausted`, `Disabled`), current
activity with progress, next planned item and time, and three buttons: Pause/Resume,
Stop (pause plus disable), and Run now (forces a tick). Schedule card: enabled toggle,
window start and end date/time pickers, daily hours, days of week, timezone, and the
refresh intervals. Targets card: the zip list with priority, source (you or auto from
TDLR), last searched, per-zip pause, drag to reorder, add zip, remove zip. Activity
card: the last 50 Scanner actions with timestamps and outcomes.

**Dashboard.** Stat tiles: total leads, green-quality leads, projects opening in 60
days, contacted this week. Zip input plus "Run search" as the primary action. A Scanner
card mirroring the status pill with a link to the Scanner page. Two lists: recent
searches with status; hot projects by soonest completion.

**Leads.** Filterable table of all Businesses. Columns: name, category, zip, quality
badge, source badge, timing window, outreach status, suggested package, provider hint.
Filters (left panel on desktop, sheet on mobile): text, category, zip, source, quality
band, outreach status, tags, products pitched, timing window, show-excluded toggle.
Bulk actions: set status, add tag, enrich, export CSV. Rows stream in while a search
runs.

**Lead detail.** Slide-over drawer from the table; also a full route `/leads/[id]`.
Header: name, address, category, quality badge, copy buttons for phone and email.
Sections: contacts grouped by type with validation status and source, social links open
in a new tab, LinkedIn company search link, Apollo people with profile links; outreach
panel (status, products pitched, tags, autosaving notes); TDLR project card when linked;
activity log.

**Projects.** Table: project name, facility, zip, work type, cost, completion date,
timing window, SMB fit, linked indicator. Excluded hidden behind a toggle. Row action
"Find business"; batch "Promote high-fit"; sync status bar with "Sync now".

**Searches.** History with status, counts, re-run. Clicking one opens Leads filtered to
that search.

**Settings.** Provider keys with configured indicators; daily budgets; SMB category
list; category-to-package map; exclusion lists and cost threshold; SMB fit threshold for
batch promote; TDLR backfill window.

**Unlock.** Single passphrase page.

Responsive: all tables collapse to card lists below `md`; filters become a bottom sheet;
the drawer becomes full-screen.

## 9. Testing

- **Vitest** unit tests, no network or database:
  - SMB fit scorer and exclusion rules against a fixture of real TDLR rows (for
    example "La Dulce Vida Adult Day Care" $60k tenant-funded is high; "TIRR Memorial
    Hermann" is excluded; "Hightower Business Park - Building 05" $28.8M is excluded).
  - Contact extractor against saved HTML fixtures (mailto, obfuscated email, tel links,
    social links, provider mentions).
  - TDLR detail page parser against a saved copy of a real detail page.
  - TDLR search response mapper against a saved JSON response.
  - Contact quality scoring, timing window, package mapping, provider detection.
  - Scanner tick decision logic with a fake clock: outside window, paused, budget
    exhausted, item priority order, backoff after failures, auto-added hot zips.
  - Provider wrappers with recorded responses.
- **Playwright** end-to-end against a local database with mocked providers: run a zip
  search and see leads appear; change outreach status; filter the Leads table; promote a
  project; pause the Scanner mid-search and confirm it stops within one step.

## 10. Repository layout

```
src/app/            pages, layouts, route handlers (/api/*)
src/components/     UI components (shadcn/ui based)
src/lib/providers/  discovery, geocode, enrichment, validation, tdlr, and interfaces
src/lib/scoring/    smbFit, contactQuality, timingWindow, packageMap, providerDetect
src/lib/extract/    website contact extractor, tdlr detail parser
src/lib/db.ts       Prisma client
src/lib/actor.ts    getActor(), the auth seam
src/worker/         job definitions and worker entry
prisma/             schema.prisma, migrations, seed (categories, package map)
tests/              fixtures, unit tests, playwright specs
docker-compose.yml  local Postgres
```

## 11. Delivery order

1. Repo scaffold, Prisma schema, Docker Postgres, passphrase gate, navbar shell.
2. Zip search job: geocode, Places fan-out, exclusion, contact extraction, validation,
   contact quality. Searches page with progress.
3. Leads table, filters, lead detail drawer, outreach fields, tags, CSV export.
4. TDLR sync job, parser, SMB fit scoring, Projects page.
5. Promote job, timing windows, package map, dashboard.
6. Scanner: schedule, targets, tick loop, pause/stop semantics, Scanner page, navbar
   status pill.
7. Apollo enrichment with budget wrapper.
8. Settings page (keys, budgets, lists), current provider detection, dark mode polish,
   Playwright suite, Railway deploy config.

## 12. Out of scope for v1

Real multi-user auth, email deliverability verification, sending outreach from the tool,
CRM sync, cities other than Houston for TDLR, scraping Google Maps or LinkedIn.
