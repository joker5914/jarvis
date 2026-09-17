# SDR Lead Generation Dashboard

A single-user (single-owner, local passphrase) dashboard for finding and
qualifying small-business leads by zip code: a background worker searches
Google Places by category, scrapes each business's website for contact
details, validates emails, and scores contact quality and SMB fit so a solo
SDR can triage and track outreach from one leads table.

This is Plan 1 of the project: zip-code search and the leads table, detail
drawer, and CSV export. Plan 2 (below) adds TDLR construction-project intel.
Plan 3 (below) adds the always-on Scanner. Plan 4 adds Apollo enrichment
(owner/GM contact search and match) and a Settings page for pasting API
keys. Plan 7 makes that enrichment deliberate and safe; Plan 9 assumes a
paid Apollo plan with API access (2,500+ credits/month) rather than the
free tier, and adds a live read of Apollo's own account balance. By default
Apollo enrichment reveals **one** decision-maker per business (configurable
1–5 in Settings), and it never pays to reveal a person Apollo already flags
as having no email. How many credits remain is
`min(app cap, Apollo's own account balance)`: the app's own monthly cap
(default 80, raise it in Settings up to a ceiling of **5,000**) tracks
Apollo-sourced email contacts created since the cycle's renewal day, and
Settings also shows Apollo's live account balance and cycle-end date (read
from `usage_stats/credit_usage_stats`) next to it. Leave the renewal date
blank in Settings to have it derive from Apollo's own billing cycle instead
of tracking a separately-typed date. Every enrich path (the background job,
the single-business route, the bulk route, and the UI) refuses at whichever
limit binds first, with no provider call once refused — the 409 wording
names which one: **"Apollo monthly credit cap reached (`used`/`cap`)"**
when the app's own cap is the binding constraint, or **"Apollo account is
out of credits (Apollo reports 0 left)"** when Apollo's own balance is
already at or below zero regardless of what the app cap would still allow.
Bulk Enrich from the Leads table is capped at 10 leads per action and
confirms the estimated credit spend before sending it. Apollo enrichment
normally searches people by the business's website domain; businesses
without a usable website domain cost one extra Apollo credit for an
Organization Search before the people lookup. Phone reveals are never
requested. Each category search returns at most `maxPlacesPerCategory` (40)
places, ranked by Google prominence, so a dense zip costs at most about
34 × 40 Place Details calls; a Resume never repeats the category searches.

**Google-budget-interrupted searches finish on what they found.** If the
Google daily budget (`GOOGLE_DAILY_BUDGET`) runs out mid-search — whether
still searching categories or already fetching Place Details — the search
completes normally instead of sitting paused: everything discovered so far
is linked, scored, scraped, validated, and quality-scored, and the leads
table shows those results right away. The Searches list marks it Complete
with a note — naming how many more places were found but not yet fetched
when that count is known, or simply that more places may exist when the
budget ran out before every category was even searched — and a nightly job
(00:15, after the daily budget resets at midnight) picks it back up
automatically and finishes the rest — no user action needed. A "Find more"
button on the search resumes it immediately instead of waiting for the
nightly run.

**Local-first People Search (Plan 9).** People Search itself costs no
Apollo credits, so every enrich run makes an unlocated ("any") call first
to learn the org's total decision-maker count at that domain
(`totalAtDomain`) before spending anything. A single-location SMB (whose
whole page came back on that first call) stops there — one call total.
Otherwise the search cascades **city → metro → state**, stopping at the
first scope with any candidates, so a franchise-brand domain surfaces the
local owner/manager instead of a national head office: worst case (a large
org with no local match anywhere) costs 4 People Search calls, not 1. The
**metro area** Settings field (e.g. "Houston, Texas") is the fallback the
cascade tries when the lead's own city scope is empty or skipped (a bare
city needs a state to disambiguate — "Pearland" alone is ambiguous); leave
it blank to skip that scope. The activity log names which scope actually
matched — "(matched in Pearland, TX)", "(matched in Houston, Texas)",
"(matched in Texas)" — and, when the cascade ran but every located scope
came back empty, "(no local match; searched nationally)" so a head-office
fallback is visible rather than looking identical to "no location
information was available to search with."

**Chains never get a credit spent on them (Plan 9).** A domain with **1,000
or more** decision-maker hits in Apollo's People Search — title/seniority-
filtered (owner, founder, GM, manager, etc. — never a raw employee
headcount), at any location — is treated as a national chain, not an SMB,
and excluded before any paid reveal (`exclusionReasons` gets
`chain:apollo_headcount:<n>`). The threshold is deliberately high so a
franchise brand (e.g. Snap Fitness, where the *local* owner is a real SMB
prospect even though the brand nationally is huge) stays eligible. The lead
drawer's **"Not an SMB (chain)"** action adds that business's name to the
owner's chain list and re-scores the *whole table* so look-alikes are
excluded in the same pass — the chain list becomes **user-owned** the first
time this is clicked: it starts as a snapshot of the built-in seed list plus
that one new entry, so a seed chain added in a later release no longer
applies to that owner unless they add it again themselves. **"Restore as
SMB"** (shown once a lead is chain-excluded) undoes this for *that business
only*: it removes the chain-list entry that excluded it — even a *seed*
entry, if that's what matched — and clears that lead's chain-derived
exclusion reasons, without re-scoring (or restoring) any other business.
`scripts/chain-sweep.ts` runs the same headcount check across the whole
table outside of a live Enrich click: dry run by default (prints
`domain / totalAtDomain / chain?` for every non-excluded business with a
usable domain), `--apply` marks the matches the same way the live guard
does, `--limit N` caps how many businesses one run examines. It's bounded
by the app's own daily Apollo call budget (Settings → Apollo) — raise the
budget to at least the business count first for full coverage — and stops
cleanly (partial results already printed stay valid) the moment it hits
that budget, a missing/misconfigured API key, or an Apollo plan block,
rather than looping through the rest of the table re-printing the same
error.

**Apollo's free and trial plans do not include the People Search or People
Enrichment API** — every plan tier can call Organization Enrichment, but
People Search and People Match return HTTP 403 (`API_INACCESSIBLE`, or on some
accounts `AUTH.AUTHORIZATION.ENDPOINT_ACCESS_DENIED`) even with a
valid key on both the Free plan and the Basic 14-day trial, regardless of
the monthly credit balance above. The app detects this the first time it
happens, records an `Enrichment unavailable: …` row (with the raw Apollo
error code) on the lead's activity log so a failed Enrich click stays
visible after a refresh, and persists the block (on the `ProviderConfig`
row, not just in the worker's memory) for 6 hours so both the background
job and the single/bulk Enrich routes — including the Next.js web
process, which never itself makes the *credited* People Search/People
Enrichment/Organization Search calls this block applies to (only the
worker does, in `JOB_MODE=queue`) — refuse up front with a 409 during that
window instead of wasting retries or budget. (The web process does call
Apollo directly for one thing: reading the live credit balance for
Settings/the credits route — see "Local-first People Search" above — which
is why Railway's **web** service needs egress to `api.apollo.io` too, not
just the worker; see Deploy below.) Saving a new key or
re-enabling Apollo in Settings clears the block immediately, in every web
process/replica: each 409 check revalidates its own remembered block
against that `ProviderConfig` row rather than trusting it outright, so a
stale in-memory block never outlives the database row that backs it. A
paid Apollo plan is required for API-based people enrichment; without one,
use Apollo's web app to find and paste in contacts manually, then save
your API key again in Settings once you upgrade. Any other enrichment
failure (rate limits, 5xx, network errors) also now leaves an
`Enrichment failed: …` row on the lead instead of failing silently, so a
lead that hit a transient error is easy to tell apart from one that was
never attempted.

## Running the app day to day

For actual prospecting, use `npm run serve` — it builds a production bundle
and starts it on port 3000, so page navigation is fast (tens of
milliseconds instead of seconds). Use `npm run dev` only while changing
code; it compiles each page the first time you visit it and recompiles on
every file change, which is what makes dev mode feel slow. Run on Node 22
via `nvm use` (reads `.nvmrc`). Either way, the background worker is a
separate process: start it with `npm run worker`.

## Prerequisites

- Node 22, via nvm: `nvm use 22.22.3`
- Docker Desktop (for the Postgres dev/test databases)

## Setup

```bash
cp .env.example .env
# edit .env: set APP_PASSPHRASE and APP_SECRET (32+ random chars)

npm install
npm run db:up        # starts Postgres via docker compose
npm run db:migrate    # applies Prisma migrations
npm run db:seed       # seeds reference data (categories, tags)
```

## Running

The app needs two processes: the Next.js server and the pg-boss worker that
runs zip searches in the background.

```bash
npm run dev     # terminal 1 - Next.js on http://localhost:3000
npm run worker  # terminal 2 - pg-boss worker
```

Relevant env vars (see `.env.example`):

- `PROVIDER_MODE`: `fake` (default) uses deterministic in-memory providers
  for local development and tests; `real` calls the Google Places API and
  requires `GOOGLE_MAPS_API_KEY`.
- `JOB_MODE`: `queue` (default) enqueues zip searches to the worker via
  pg-boss; `inline` runs a search inside the web process instead, so a single
  `npm run dev` is enough (used by the e2e tests).

## Projects (TDLR)

The Projects page tracks Texas Department of Licensing and Regulation (TDLR)
construction-project registrations for Houston: new businesses building out
or renovating a space are strong SMB leads before they've even opened.

- TDLR is always the real registry (`https://www.tdlr.texas.gov/TABS`)
  unless `PROVIDER_MODE=fake`, which is used for local dev and tests.
- The worker schedules a sync nightly at 03:00 America/Chicago, and it dedupes
  against any sync already running so the cron fire can't queue behind a
  manual one.
- **Sync now** on the Projects page enqueues an on-demand sync. Each run
  scores projects for SMB fit, excludes enterprise-scale work, computes a
  timing window (opening soon / under construction / planned / just
  completed / stale), and refreshes previously-seen open projects whose
  details are more than 30 days old.
- **Find business** looks up a matching Google Places business for a project
  (by name, address, and zip) and offers candidates to link; a confident
  match can be linked automatically. **Promote high-fit** batch-runs that
  same matching step across every high-scoring, unlinked project.
- The first sync backfills 12 months of Houston registrations at one request
  per second (TDLR's own rate limit), which is roughly 2,500-4,000 detail
  fetches — expect it to take up to an hour.

## Scanner

The Scanner runs the dashboard unattended. A pg-boss cron job (`scanner-tick`)
fires every 5 minutes, reads the schedule, targets, and current state, and
enqueues at most one scanner-origin job at a time (`maxConcurrentJobs`,
default 1):

- **Window**: the schedule has an absolute `windowStart`/`windowEnd`, an
  optional daily `dailyStartTime`/`dailyEndTime` (in the configured
  timezone), and optional `daysOfWeek`. Outside the window the scanner is
  idle even if enabled.
- **Targets**: `ScanTarget` rows are zip codes to search, each with a
  priority and a refresh interval (`zipRefreshDays`).
- **Priority order** each tick: (1) a TDLR sync if it hasn't succeeded
  recently (`tdlrSyncHours`); (2) resuming a paused scanner-origin zip
  search; (3) the highest-priority target whose zip hasn't been searched
  recently, ties broken by oldest `lastSearchedAt`; (4) up to 25 businesses
  whose website hasn't been rechecked recently (`websiteRecheckDays`);
  otherwise the scanner goes idle until the next planned item.
- **Hot zips**: when `autoAddHotZips` is on, any non-excluded project that
  scores `smbFitScore >= 60` and is `opening_soon` or `under_construction`
  automatically upserts a high-priority (100) `ScanTarget` for its zip.
- **Pause / resume / stop**: pause takes effect within seconds — every
  scanner-origin job checks the pause flag between steps and around website
  fetches. Resume clears the flag and the next tick picks the paused item
  back up where it left off. Stop pauses and disables the schedule.
- Manual searches (started from the Leads page) are sent at a higher queue
  priority than scanner-origin searches and run on the worker via
  `localConcurrency: 2` on the zip-search queue, so a manual search never has
  to wait behind an in-flight scanner search; they ignore the window and
  pause state. The Scanner itself still self-limits to `maxConcurrentJobs`
  concurrent scanner-origin jobs.

The Scanner page (`/scanner`) shows live state, the schedule form, targets,
and a scanner-origin activity log; a pill in the navbar and a dashboard card
mirror the current state with quick pause/resume controls.

## Testing

```bash
npm test          # unit tests (vitest)
npm run test:db   # integration tests against the sdr_test database
npm run test:e2e  # Playwright end-to-end tests (own server on port 3100)
```

`npm run test:db` and `npm run test:e2e` both require `TEST_DATABASE_URL` in
`.env` to point at a `*_test` database — they reset and reseed it on every
run, so it must never be the dev database.

`npm run test:e2e` runs the browser suite against a **production build**,
not the dev server: Playwright's `webServer` runs `npm run e2e:server`
(`scripts/e2e-server.mjs`), which builds with `next build` and serves with
`next start` on port 3100. The build uses `NEXT_DIST_DIR=.next-e2e` so it
writes to a separate build directory (`next.config.ts` reads it into
`distDir`) and never clobbers a `.next` build from a running `npm run dev`.

### Known advisories

`npm audit` reports advisories that are blocked by the version pins in this
project:

- `postcss` (high; XSS/source-map path traversal) — vendored inside
  `next@15.5`; only exercised at build time by Next's CSS pipeline on our own
  stylesheets, never on user input. Fix requires Next 16, which is out of
  scope until the App Router migration is planned.
- `deepmerge-ts` (high; stack exhaustion when merging recursive object
  graphs) — via `@prisma/config`, used only by the Prisma CLI (migrations),
  not at runtime.

CI fails on any **critical** advisory affecting runtime dependencies; re-run
`npm audit --omit=dev` when bumping Next or Prisma.

## Deploy to Railway

The app deploys as two Railway services (web + worker) built from the same
repo and `Dockerfile`, plus a Railway Postgres plugin.

**Deploy order for the metro area setting (Plan 9).** Deploy both the
**web** and **worker** services on a build that includes Plan 9 *before*
typing a value into the Settings "Metro area for enrichment" field.
`overridesSchema` only recognizes `enrichment.metroLocation` starting with
this build; a pre-Plan-9 build's zod schema doesn't know that key and
rejects the *whole* settings row as invalid rather than ignoring the one
unknown field — this happened live. The same risk runs in reverse: **clear
the metro area field back to blank before rolling either service back to a
pre-Plan-9 build**, so the stored overrides row doesn't carry a key the
older build will choke on.

### 1. Create the project

- New Railway project, add the **PostgreSQL** plugin.
- Add two services from this GitHub repo:
  - **web** — uses `railway.json` as-is (build via `Dockerfile`, start
    command `npm run start:web`, health check `/api/health`).
  - **worker** — same repo/Dockerfile, but override the service's **Start
    Command** in the Railway dashboard to `npm run start:worker`. (Railway's
    config-as-code, `railway.json`, applies per-service from the repo root,
    so it only describes the web service; the worker's start command is set
    in the dashboard instead.)

### 2. Shared variables

Set these on both services (or as shared/project-level variables):

- `DATABASE_URL` — reference the Postgres plugin's connection string; don't
  hardcode it.
- `APP_SECRET` — 32+ random characters (cookie signing + key encryption).
- `APP_PASSPHRASE` — the single-user login passphrase.
- `PROVIDER_MODE=real`
- `JOB_MODE=queue`
- `TRUST_PROXY=1` — Railway proxies requests, so the passphrase rate limiter
  needs this to throttle by real client IP instead of collapsing every
  client onto one bucket.
- `GOOGLE_MAPS_API_KEY` and `APOLLO_API_KEY` — optional here; both can
  instead be pasted into the Settings page after first deploy (env wins over
  a stored key when both are present).
- Optional: `GOOGLE_DAILY_BUDGET`, `APOLLO_DAILY_BUDGET` (call-per-day caps;
  default 2000/300).

### 3. Health check and migrations

- Railway's health check hits `/api/health` (excluded from the auth
  middleware), which returns 200 only after a successful `SELECT 1` against
  the database.
- `npm run start:web` runs `prisma migrate deploy` before `next start`, so
  schema migrations apply automatically on every web deploy. The worker
  service does not run migrations.

### 4. pg-boss queue policy (one-time note)

The worker reconciles pg-boss queue policies (e.g. `stately`) on startup,
but it refuses to change an existing queue's policy in place unless
`NODE_ENV` is `development`/`test` or `PGBOSS_RECREATE_QUEUES=1` — Railway's
image runs with `NODE_ENV=production`, so this is normally a safe no-op. If
you point the worker at a database provisioned before a queue-policy change
(e.g. migrating an existing dev database to Railway), set
`PGBOSS_RECREATE_QUEUES=1` on the worker service for one deploy so it can
drop and recreate the mismatched queue (this discards anything currently
queued for it), then remove the variable.

### 5. Operational notes

- **Run a single web instance.** The passphrase-attempt rate limiter
  (`src/lib/auth/rateLimit.ts`) is in-process, per instance — horizontally
  scaling the web service would let an attacker reset their throttle by
  hitting a different instance.
- **Scraping egress.** The website scraper and checker (`safeFetch`) make
  outbound requests from Railway's own egress IPs; if a target site
  allowlists or geofences traffic, allow Railway's IP ranges (see Railway's
  docs for the current list) rather than your own.
- **Apollo egress from the web service too.** The worker is the only
  process that makes credited Apollo calls, but as of Plan 9 the **web**
  service also calls `api.apollo.io` directly (an uncredited read of the
  live account balance for Settings/the credits route — see "Local-first
  People Search" above). If you firewall outbound traffic per-service, the
  web service needs egress to `api.apollo.io`, not just the worker.
- **Pinned base image.** The `Dockerfile`'s `FROM` lines pin
  `node:22.22.3-bookworm-slim` to a specific digest (both stages carry the
  same one) so the runner isn't rebuilt against a base image that changed
  underneath it, and it runs as the image's built-in non-root `node` user
  (uid 1000). To bump the pin: `docker pull node:<tag>`, then
  `docker image inspect node:<tag> --format '{{index .RepoDigests 0}}'`, and
  paste the printed `node@sha256:…` into both `FROM` lines.

## More detail

- `docs/superpowers/specs/` - product spec and design notes
- `docs/superpowers/plans/` - implementation plans, including the plan this
  codebase currently implements
