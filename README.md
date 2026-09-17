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
keys. Plan 7 makes that enrichment deliberate and safe on Apollo's free
tier (85 credits/month, one credit per verified net-new email): by default
Apollo enrichment reveals **one** decision-maker per business (configurable
1–5 in Settings), and it never pays to reveal a person Apollo already flags
as having no email. A monthly credit cap (default 80, a few credits under
the free tier as headroom) tracks Apollo-sourced email contacts created
since the cycle's renewal day, which you also set in Settings; every enrich
path (the background job, the single-business route, the bulk route, and
the UI) refuses at the cap with no provider call. Bulk Enrich from the
Leads table is capped at 10 leads per action and confirms the estimated
credit spend before sending it. Apollo enrichment normally searches people
by the business's website domain; businesses without a usable website
domain cost one extra Apollo credit for an Organization Search before the
people lookup. Phone reveals are never requested. Each category search
returns at most `maxPlacesPerCategory` (40) places, ranked by Google
prominence, so a dense zip costs at most about 34 × 40 Place Details calls; a
Resume never repeats the category searches.

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
