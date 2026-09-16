# SDR Lead Generation Dashboard

A single-user (single-owner, local passphrase) dashboard for finding and
qualifying small-business leads by zip code: a background worker searches
Google Places by category, scrapes each business's website for contact
details, validates emails, and scores contact quality and SMB fit so a solo
SDR can triage and track outreach from one leads table.

This is Plan 1 of the project: zip-code search and the leads table, detail
drawer, and CSV export. Plan 2 (below) adds TDLR construction-project intel.
The always-on scanner, Apollo enrichment, and a settings/API-key UI are
upcoming plans, not yet built.

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

## Testing

```bash
npm test          # unit tests (vitest)
npm run test:db   # integration tests against the sdr_test database
npm run test:e2e  # Playwright end-to-end tests (own server on port 3100)
```

`npm run test:db` and `npm run test:e2e` both require `TEST_DATABASE_URL` in
`.env` to point at a `*_test` database — they reset and reseed it on every
run, so it must never be the dev database.

## More detail

- `docs/superpowers/specs/` - product spec and design notes
- `docs/superpowers/plans/` - implementation plans, including the plan this
  codebase currently implements
