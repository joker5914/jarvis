# SDR Lead Gen Dashboard — Plan 1: Foundation, Zip Search, Leads UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable core of the dashboard: a passphrase-gated Next.js app with a Postgres schema, a worker that runs a zip-code search (Google Places fan-out, website contact extraction, validation, contact-quality scoring), and a Leads UI with filters, detail drawer, outreach tracking, bulk actions, and CSV export.

**Architecture:** Next.js 15 App Router monolith serving pages and `/api/*` route handlers, plus a separate Node worker process using pg-boss (queue stored in Postgres). External services sit behind provider interfaces with a `fake` implementation used by tests and end-to-end runs. Pure logic (scoring, extraction, filters, CSV) lives in `src/lib` and is unit-tested without network or database.

**Tech Stack:** Next.js 15.5 (App Router, TypeScript), React 19, Tailwind 4, shadcn/ui, Prisma 6.19 + Postgres 16, pg-boss 12, cheerio, zod, libphonenumber-js, p-limit, jose, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` (this plan implements delivery slices 1 to 3; TDLR/promote, Scanner, and Apollo/Settings are later plans).

## Global Constraints

- Node 20.17 (`fetch`, `--env-file`, `import.meta.dirname` available). npm 11.
- Pin majors: `next@15`, `react@19`, `prisma@6`, `@prisma/client@6`, `pg-boss@12`, `zod@4`, `cheerio@1`, `vitest@5`. Do not upgrade to Next 16 or Prisma 7 in this plan (they change `middleware.ts` and the Prisma client setup).
- Every user-data table has `ownerId String @default("local-user")`. Every route handler and server component gets the owner through `getActor()` from `src/lib/actor.ts`. Never hardcode `"local-user"` outside `src/lib/actor.ts`.
- Paid providers (Google, later Apollo) are only called through `withBudget()` in `src/lib/providers/budget.ts`.
- Apollo enrichment is never automatic. It is not implemented in this plan.
- Website scraping: concurrency 4, 10 s timeout per request, user agent `SDR-LeadGen/1.0 (+contact info research)`.
- Contact quality points: website reachable 25, phone present and well-formed 20, at least one email with valid MX 30, at least one named person with title 15, at least one social or LinkedIn link 10. Bands: green >= 70, yellow 40 to 69, red < 40.
- Enterprise hard-exclusion: chain list match, government/education/health-system pattern match, `estimatedCost > 2_000_000`, `workType = row`, or more than 5 same-name results in one search.
- Outreach statuses: `not_contacted`, `contacted`, `interested`, `not_a_fit`, `customer`. Product slugs: `internet, mobile, voice, tv, security, wifi_pro, other`.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Windows host: use Git Bash syntax in commands (forward slashes). Prisma and Next work the same.

## File structure (what this plan creates)

```
docker-compose.yml                 local Postgres 16 (dbs: sdr, sdr_test)
.env.example                       documented env vars
vitest.config.ts                   unit tests (tests/unit)
vitest.db.config.ts                DB integration tests (tests/db), serial
playwright.config.ts               e2e with fake providers and inline jobs
prisma/schema.prisma               full schema from spec section 4
prisma/seed.ts                     system tags for categories
src/middleware.ts                  passphrase gate
src/lib/actor.ts                   getActor() auth seam
src/lib/session.ts                 signed cookie tokens (jose)
src/lib/crypto.ts                  AES-256-GCM for stored provider keys
src/lib/db.ts                      Prisma client singleton
src/lib/api.ts                     route handler helpers (json, parse, errors)
src/lib/config/categories.ts       SMB category fan-out list + package slug
src/lib/config/packages.ts         package and product slugs/labels
src/lib/config/exclusion.ts        chain list, patterns, keywords, thresholds
src/lib/scoring/smbFit.ts          exclusion + SMB fit score
src/lib/scoring/contactQuality.ts  contact quality score
src/lib/scoring/packageMap.ts      suggestPackage()
src/lib/scoring/providerDetect.ts  current-provider hint
src/lib/extract/normalize.ts       email/phone/social URL normalization
src/lib/extract/website.ts         website contact extractor
src/lib/providers/types.ts         provider interfaces + DTOs
src/lib/providers/google.ts        Geocoding + Places (New) Text Search
src/lib/providers/validation.ts    website reachability + MX
src/lib/providers/budget.ts        daily budget wrapper
src/lib/providers/fake.ts          deterministic fakes
src/lib/providers/index.ts         getProviders() by PROVIDER_MODE
src/lib/jobs/zipSearch.ts          runZipSearch(searchId, deps)
src/lib/jobs/enqueue.ts            enqueueZipSearch (queue or inline)
src/lib/jobs/queues.ts             queue name constants
src/lib/leads/filters.ts           parseLeadFilters, buildBusinessWhere
src/lib/leads/csv.ts               businessesToCsv
src/lib/leads/stats.ts             dashboard counts
src/worker/index.ts                pg-boss worker entry
src/app/layout.tsx, page.tsx       shell + dashboard
src/app/unlock/page.tsx            passphrase page
src/app/api/unlock/route.ts
src/app/api/searches/route.ts, [id]/route.ts, [id]/rerun/route.ts
src/app/api/businesses/route.ts, [id]/route.ts, bulk/route.ts
src/app/api/tags/route.ts
src/app/api/export/route.ts
src/app/searches/page.tsx
src/app/leads/page.tsx, [id]/page.tsx
src/app/projects/page.tsx, scanner/page.tsx, settings/page.tsx   stubs
src/components/nav/Navbar.tsx
src/components/leads/*             table, filters, badges, detail, bulk bar
src/components/searches/*          zip form, progress
tests/unit/**                      vitest unit tests
tests/db/**                        vitest DB tests
tests/fixtures/html/*.html         scraped-site fixtures
tests/e2e/*.spec.ts                playwright
```

---

### Task 1: Scaffold the Next.js app, test runners, and local Postgres

**Files:**
- Create: `package.json` (via create-next-app, then edited), `docker-compose.yml`, `.env.example`, `.env`, `vitest.config.ts`, `vitest.db.config.ts`, `tests/unit/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`, `test:db`, `worker`, `db:up`, `db:migrate`, `db:seed`; env vars `DATABASE_URL`, `TEST_DATABASE_URL`, `APP_PASSPHRASE`, `APP_SECRET`, `PROVIDER_MODE`, `JOB_MODE`, `GOOGLE_MAPS_API_KEY`.

- [ ] **Step 1: Create the app in the existing directory**

Run from `C:/Users/cgill/Documents/Projects/SDR`:

```bash
npx create-next-app@15 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack --yes
```

Expected: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `next.config.ts`, `tsconfig.json` exist. `docs/` and `.gitignore` are preserved (create-next-app allows them).

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
npm i @prisma/client@6 pg-boss@12 cheerio@1 zod@4 libphonenumber-js p-limit jose
npm i -D prisma@6 vitest@5 tsx @playwright/test dotenv
```

- [ ] **Step 3: Add Postgres via Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: sdr
      POSTGRES_DB: sdr
    ports:
      - "5432:5432"
    volumes:
      - sdr_pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql
volumes:
  sdr_pgdata:
```

Create `scripts/init-test-db.sql`:

```sql
CREATE DATABASE sdr_test;
```

- [ ] **Step 4: Add env files**

Create `.env.example`:

```bash
# Postgres (docker-compose defaults)
DATABASE_URL="postgresql://postgres:sdr@localhost:5432/sdr"
TEST_DATABASE_URL="postgresql://postgres:sdr@localhost:5432/sdr_test"

# Access gate: the single passphrase and a 32+ char secret for cookie signing + key encryption
APP_PASSPHRASE="change-me"
APP_SECRET="change-me-to-a-long-random-string-at-least-32-chars"

# "real" calls Google; "fake" uses deterministic in-memory providers (tests, demos)
PROVIDER_MODE="fake"
# "queue" enqueues to the pg-boss worker; "inline" runs jobs inside the web process (e2e, no worker)
JOB_MODE="queue"

# Optional in fake mode
GOOGLE_MAPS_API_KEY=""
# Daily budget caps (calls per day)
GOOGLE_DAILY_BUDGET="2000"
```

Copy it to `.env` (kept out of git; `.gitignore` already lists `.env`).

```bash
cp .env.example .env
```

- [ ] **Step 5: Add Vitest configs**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
```

Create `vitest.db.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["tests/db/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
```

- [ ] **Step 6: Write a smoke test**

Create `tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Add npm scripts**

Edit `package.json` `"scripts"` to be exactly:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run --config vitest.config.ts",
  "test:watch": "vitest --config vitest.config.ts",
  "test:db": "vitest run --config vitest.db.config.ts",
  "test:e2e": "playwright test",
  "worker": "node --env-file=.env --import=tsx src/worker/index.ts",
  "db:up": "docker compose up -d db",
  "db:migrate": "prisma migrate dev",
  "db:seed": "prisma db seed",
  "db:reset": "prisma migrate reset --force"
}
```

Also add at the top level of `package.json`:

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

- [ ] **Step 8: Run the smoke test and start the database**

```bash
npm test
npm run db:up
```

Expected: `1 passed`; docker shows the `db` container running (`docker compose ps`).

- [ ] **Step 9: Append to .gitignore and commit**

Append to `.gitignore`:

```
.env
playwright-report/
test-results/
```

```bash
git add -A
git commit -m "chore: scaffold Next.js app, vitest, docker postgres

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Prisma schema, client singleton, seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/db.ts`, `tests/db/setup.ts`, `tests/db/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Search`, `Business`, `SearchBusiness`, `Contact`, `Tag`, `BusinessTag`, `Project`, `ProviderConfig`, `SyncState`, `ActivityLog`, `ScanSchedule`, `ScanTarget`, `ScannerState` and enums as listed below; `prisma` client from `@/lib/db`.

- [ ] **Step 1: Write the schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum JobStatus {
  queued
  running
  paused
  complete
  failed
}

enum BusinessSource {
  zip_search
  tdlr
  manual
}

enum Exclusion {
  none
  enterprise
}

enum QualityBand {
  green
  yellow
  red
}

enum OutreachStatus {
  not_contacted
  contacted
  interested
  not_a_fit
  customer
}

enum ContactType {
  email
  phone
  linkedin
  facebook
  instagram
  twitter
  yelp
  other
}

enum ContactSource {
  google
  website
  apollo
  tdlr
  manual
}

enum ValidationStatus {
  unchecked
  valid
  invalid
  unreachable
}

enum WorkType {
  new_construction
  renovation
  addition
  historic
  row
}

enum TimingWindow {
  opening_soon
  under_construction
  planned
  just_completed
  stale
}

enum ScannerStatus {
  idle
  running
  paused
  outside_window
  budget_exhausted
  disabled
}

model Search {
  id             String     @id @default(cuid())
  ownerId        String     @default("local-user")
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  zip            String
  city           String?
  state          String?
  lat            Float?
  lng            Float?
  radiusMeters   Int?
  status         JobStatus  @default(queued)
  progress       Json?
  countsFound    Int        @default(0)
  countsScraped  Int        @default(0)
  countsEnriched Int        @default(0)
  error          String?
  origin         String     @default("manual")
  businesses     SearchBusiness[]

  @@index([ownerId, createdAt])
}

model Business {
  id                      String          @id @default(cuid())
  ownerId                 String          @default("local-user")
  createdAt               DateTime        @default(now())
  updatedAt               DateTime        @updatedAt
  googlePlaceId           String?         @unique
  name                    String
  formattedAddress        String?
  zip                     String?
  lat                     Float?
  lng                     Float?
  phone                   String?
  websiteUrl              String?
  googleRating            Float?
  googleReviewCount       Int?
  googleTypes             String[]        @default([])
  primaryCategory         String?
  source                  BusinessSource  @default(zip_search)
  exclusion               Exclusion       @default(none)
  exclusionReasons        String[]        @default([])
  smbFitScore             Int             @default(0)
  contactQualityScore     Int             @default(0)
  contactQualityBand      QualityBand     @default(red)
  contactQualityReasons   Json?
  suggestedPackage        String?
  currentProviderHint     String?
  currentProviderEvidence String?
  outreachStatus          OutreachStatus  @default(not_contacted)
  productsPitched         String[]        @default([])
  notes                   String          @default("")
  websiteReachable        Boolean?
  websiteCheckedAt        DateTime?
  websiteError            String?
  lastEnrichedAt          DateTime?
  searches                SearchBusiness[]
  contacts                Contact[]
  tags                    BusinessTag[]
  projects                Project[]
  activity                ActivityLog[]

  @@index([ownerId, zip])
  @@index([ownerId, outreachStatus])
  @@index([ownerId, contactQualityBand])
}

model SearchBusiness {
  searchId           String
  businessId         String
  surfacedByCategory String
  search             Search   @relation(fields: [searchId], references: [id], onDelete: Cascade)
  business           Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@id([searchId, businessId])
  @@index([businessId])
}

model Contact {
  id               String           @id @default(cuid())
  ownerId          String           @default("local-user")
  createdAt        DateTime         @default(now())
  businessId       String
  type             ContactType
  value            String
  personName       String?
  personTitle      String?
  source           ContactSource
  validationStatus ValidationStatus @default(unchecked)
  validatedAt      DateTime?
  business         Business         @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@unique([businessId, type, value])
}

model Tag {
  id         String        @id @default(cuid())
  ownerId    String        @default("local-user")
  name       String
  color      String        @default("#64748b")
  isSystem   Boolean       @default(false)
  businesses BusinessTag[]

  @@unique([ownerId, name])
}

model BusinessTag {
  businessId String
  tagId      String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([businessId, tagId])
}

model Project {
  id               String        @id @default(cuid())
  ownerId          String        @default("local-user")
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  tdlrProjectId    String?
  projectNumber    String        @unique
  projectName      String
  facilityName     String?
  locationAddress  String?
  city             String?
  zip              String?
  county           String?
  statusCode       Int?
  statusLabel      String?
  workType         WorkType?
  estimatedCost    Float?
  squareFootage    Int?
  tenantFunded     Boolean?
  fundsType        String?
  scopeOfWork      String?
  startDate        DateTime?
  completionDate   DateTime?
  registrationDate DateTime?
  ownerName        String?
  ownerAddress     String?
  ownerPhone       String?
  contactName      String?
  tenantName       String?
  designFirmName   String?
  rasName          String?
  rasPhone         String?
  smbFitScore      Int           @default(0)
  smbFitReasons    Json?
  exclusion        Exclusion     @default(none)
  exclusionReasons String[]      @default([])
  timingWindow     TimingWindow?
  businessId       String?
  detailFetchedAt  DateTime?
  lastCheckedAt    DateTime?
  parseError       String?
  business         Business?     @relation(fields: [businessId], references: [id], onDelete: SetNull)

  @@index([ownerId, completionDate])
  @@index([ownerId, smbFitScore])
}

model ProviderConfig {
  provider     String    @id
  encryptedKey String?
  enabled      Boolean   @default(true)
  dailyBudget  Int       @default(1000)
  usedToday    Int       @default(0)
  usageDate    String?
}

model SyncState {
  key              String    @id
  lastSuccessfulAt DateTime?
  cursor           Json?
}

model ActivityLog {
  id         String    @id @default(cuid())
  ownerId    String    @default("local-user")
  createdAt  DateTime  @default(now())
  businessId String?
  projectId  String?
  kind       String
  message    String
  business   Business? @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@index([businessId, createdAt])
}

model ScanSchedule {
  id                 String   @id @default(cuid())
  ownerId            String   @unique @default("local-user")
  updatedAt          DateTime @updatedAt
  enabled            Boolean  @default(false)
  windowStart        DateTime?
  windowEnd          DateTime?
  dailyStartTime     String?
  dailyEndTime       String?
  daysOfWeek         Int[]    @default([])
  timezone           String   @default("America/Chicago")
  zipRefreshDays     Int      @default(7)
  tdlrSyncHours      Int      @default(6)
  websiteRecheckDays Int      @default(30)
  autoAddHotZips     Boolean  @default(true)
  maxConcurrentJobs  Int      @default(1)
}

model ScanTarget {
  id             String    @id @default(cuid())
  ownerId        String    @default("local-user")
  zip            String
  priority       Int       @default(0)
  addedBy        String    @default("user")
  lastSearchedAt DateTime?
  lastSearchId   String?
  paused         Boolean   @default(false)

  @@unique([ownerId, zip])
}

model ScannerState {
  ownerId         String        @id @default("local-user")
  status          ScannerStatus @default(disabled)
  pauseRequested  Boolean       @default(false)
  currentJobId    String?
  currentActivity String?
  lastTickAt      DateTime?
  nextPlanned     Json?
  lastError       String?
}
```

- [ ] **Step 2: Add the Prisma client singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Write the seed**

Create `prisma/seed.ts` (categories module arrives in Task 5; the seed imports it, so create Task 5's `src/lib/config/categories.ts` file first if running this task in isolation, or run the seed after Task 5):

```ts
import { PrismaClient } from "@prisma/client";
import { CATEGORIES } from "../src/lib/config/categories";

const prisma = new PrismaClient();

async function main() {
  for (const c of CATEGORIES) {
    await prisma.tag.upsert({
      where: { ownerId_name: { ownerId: "local-user", name: c.slug } },
      update: { isSystem: true },
      create: { ownerId: "local-user", name: c.slug, isSystem: true, color: "#0ea5e9" },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} system tags`);
}

main().finally(() => prisma.$disconnect());
```

Note: the seed is the one place allowed to write `"local-user"` literally because it runs outside the app.

- [ ] **Step 4: Create the migration**

```bash
npx prisma migrate dev --name init
npx prisma generate
```

Expected: `prisma/migrations/<timestamp>_init/migration.sql` created; "Your database is now in sync".

- [ ] **Step 5: Write the DB test setup and a schema test**

Create `tests/db/setup.ts`:

```ts
import { execSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env" });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL missing in .env");
process.env.DATABASE_URL = testUrl;

execSync("npx prisma db push --skip-generate --accept-data-loss", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
```

Create `tests/db/schema.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
});

describe("schema", () => {
  it("creates a search and a business linked through SearchBusiness", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    const biz = await prisma.business.create({
      data: {
        name: "Test Nails",
        zip: "77084",
        searches: { create: { searchId: search.id, surfacedByCategory: "nail_salon" } },
      },
      include: { searches: true },
    });
    expect(biz.ownerId).toBe("local-user");
    expect(biz.searches[0].searchId).toBe(search.id);
    expect(biz.outreachStatus).toBe("not_contacted");
  });
});
```

- [ ] **Step 6: Run the DB test**

```bash
npm run test:db
```

Expected: `1 passed`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: prisma schema, client singleton, seed, db test harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Passphrase gate and the auth seam

**Files:**
- Create: `src/lib/actor.ts`, `src/lib/session.ts`, `src/middleware.ts`, `src/app/unlock/page.tsx`, `src/app/api/unlock/route.ts`, `tests/unit/session.test.ts`

**Interfaces:**
- Produces: `getActor(): Promise<Actor>` where `Actor = { id: string; name: string }`; `createSessionToken(secret: string): Promise<string>`; `verifySessionToken(token: string, secret: string): Promise<{ sub: string } | null>`; cookie name constant `SESSION_COOKIE = "sdr_session"`.

- [ ] **Step 1: Write the failing session test**

Create `tests/unit/session.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/session";

const secret = "0123456789abcdef0123456789abcdef";

describe("session tokens", () => {
  it("round-trips a signed token", async () => {
    const token = await createSessionToken(secret);
    const payload = await verifySessionToken(token, secret);
    expect(payload?.sub).toBe("local-user");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(secret);
    expect(await verifySessionToken(token, "another-secret-another-secret-1234")).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySessionToken("not.a.token", secret)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm test -- tests/unit/session.test.ts
```

Expected: FAIL, cannot resolve `@/lib/session`.

- [ ] **Step 3: Implement session and actor**

Create `src/lib/session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sdr_session";
const SESSION_DAYS = 30;

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("local-user")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
```

Create `src/lib/actor.ts`:

```ts
/**
 * The auth seam. Today there is exactly one user. When real auth arrives,
 * this function reads the session and returns the signed-in user; nothing
 * else in the app needs to change.
 */
export type Actor = { id: string; name: string };

const LOCAL_USER: Actor = { id: "local-user", name: "You" };

export async function getActor(): Promise<Actor> {
  return LOCAL_USER;
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- tests/unit/session.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Add the middleware**

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    return new NextResponse("APP_SECRET is not configured", { status: 500 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = token ? await verifySessionToken(token, secret) : null;
  if (ok) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!unlock|api/unlock|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 6: Add the unlock page and route**

Create `src/app/api/unlock/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const passphrase = String(form.get("passphrase") ?? "");
  const next = String(form.get("next") ?? "/");
  const expected = process.env.APP_PASSPHRASE ?? "";
  const secret = process.env.APP_SECRET ?? "";
  if (!expected || !secret) {
    return new NextResponse("APP_PASSPHRASE/APP_SECRET not configured", { status: 500 });
  }
  if (!safeEqual(passphrase, expected)) {
    const url = new URL("/unlock", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }
  const token = await createSessionToken(secret);
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), {
    status: 303,
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
```

Create `src/app/unlock/page.tsx`:

```tsx
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form
        method="post"
        action="/api/unlock"
        className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm dark:bg-neutral-900"
      >
        <h1 className="text-xl font-semibold">Unlock SDR Lead Gen</h1>
        <p className="text-sm text-neutral-500">Enter the passphrase to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          name="passphrase"
          type="password"
          autoFocus
          required
          className="w-full rounded-md border px-3 py-2"
          placeholder="Passphrase"
        />
        {error && <p className="text-sm text-red-600">That passphrase is not right.</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white dark:bg-white dark:text-neutral-900"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Verify manually**

```bash
npm run dev
```

Open http://localhost:3000. Expected: redirect to `/unlock?next=%2F`; wrong passphrase shows the error; the passphrase from `.env` redirects to `/` and the cookie `sdr_session` is set. `curl -i http://localhost:3000/api/searches` returns `401 {"error":"locked"}`. Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: passphrase gate, signed session cookie, getActor auth seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: App shell, navbar, shadcn/ui, stub pages

**Files:**
- Create: `components.json` (via shadcn), `src/components/ui/*` (via shadcn), `src/components/nav/Navbar.tsx`, `src/components/nav/ScannerPill.tsx`, `src/app/leads/page.tsx`, `src/app/searches/page.tsx`, `src/app/projects/page.tsx`, `src/app/scanner/page.tsx`, `src/app/settings/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: `<Navbar />` rendered in the root layout; shadcn components `button, input, badge, card, table, sheet, select, textarea, dropdown-menu, checkbox, dialog, separator, skeleton, tabs, sonner, label`.

- [ ] **Step 1: Initialize shadcn and add components**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button input badge card table sheet select textarea dropdown-menu checkbox dialog separator skeleton tabs sonner label
```

Expected: `components.json` and `src/components/ui/*.tsx` exist; `src/lib/utils.ts` exports `cn`.

- [ ] **Step 2: Write the navbar**

Create `src/components/nav/ScannerPill.tsx` (a placeholder slot the Scanner plan fills in):

```tsx
export function ScannerPill() {
  return (
    <span
      data-testid="scanner-pill"
      className="hidden items-center gap-2 rounded-full border px-3 py-1 text-xs text-neutral-500 md:inline-flex"
    >
      <span className="h-2 w-2 rounded-full bg-neutral-400" />
      Scanner off
    </span>
  );
}
```

Create `src/components/nav/Navbar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ScannerPill } from "./ScannerPill";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/projects", label: "Projects" },
  { href: "/searches", label: "Searches" },
  { href: "/scanner", label: "Scanner" },
  { href: "/settings", label: "Settings" },
];

function NavLinks({ onNavigate, vertical }: { onNavigate?: () => void; vertical?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex gap-1", vertical ? "flex-col" : "items-center")}>
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur dark:bg-neutral-950/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          SDR Lead Gen
        </Link>
        <div className="hidden md:block">
          <NavLinks />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ScannerPill />
          {/* user-menu slot: real auth adds a menu here */}
          <div data-testid="user-menu-slot" />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetTitle className="mb-4">Menu</SheetTitle>
              <NavLinks vertical onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Wire the layout and stub pages**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/nav/Navbar";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "SDR Lead Gen",
  description: "SMB prospecting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Navbar />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
```

The unlock page renders inside this layout too; that is acceptable because the navbar links all redirect back to `/unlock` until unlocked.

Replace `src/app/page.tsx` with a temporary dashboard (Task 11 replaces it):

```tsx
export default function DashboardPage() {
  return <h1 className="text-2xl font-semibold">Dashboard</h1>;
}
```

Create each stub with the same shape, changing the title. `src/app/leads/page.tsx`:

```tsx
export default function LeadsPage() {
  return <h1 className="text-2xl font-semibold">Leads</h1>;
}
```

`src/app/searches/page.tsx`:

```tsx
export default function SearchesPage() {
  return <h1 className="text-2xl font-semibold">Searches</h1>;
}
```

`src/app/projects/page.tsx`:

```tsx
export default function ProjectsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Projects</h1>
      <p className="mt-2 text-neutral-500">TDLR project intel arrives in the next plan.</p>
    </div>
  );
}
```

`src/app/scanner/page.tsx`:

```tsx
export default function ScannerPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Scanner</h1>
      <p className="mt-2 text-neutral-500">Background scanning arrives in a later plan.</p>
    </div>
  );
}
```

`src/app/settings/page.tsx`:

```tsx
export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-neutral-500">
        Provider keys are read from environment variables for now. A settings UI arrives in a
        later plan.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify the shell**

```bash
npm run dev
```

Unlock, then confirm: navbar shows six links, the active link is highlighted, the hamburger appears below 768px and opens a side sheet, each link renders its page. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: app shell with responsive navbar, shadcn/ui, stub pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Configuration defaults (categories, packages, exclusion lists)

**Files:**
- Create: `src/lib/config/categories.ts`, `src/lib/config/packages.ts`, `src/lib/config/exclusion.ts`, `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `CATEGORIES: Category[]` with `Category = { slug: string; label: string; query: string; packageSlug: PackageSlug }`; `PACKAGES`, `PRODUCTS`, types `PackageSlug`, `ProductSlug`; `DEFAULT_EXCLUSION_CONFIG: ExclusionConfig` with fields `chains: string[]`, `entityPatterns: RegExp[]`, `positiveKeywords: string[]`, `softNegativeKeywords: string[]`, `costHardLimit: number`, `sameNameLimit: number`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CATEGORIES } from "@/lib/config/categories";
import { PACKAGES, PRODUCTS } from "@/lib/config/packages";
import { DEFAULT_EXCLUSION_CONFIG } from "@/lib/config/exclusion";

describe("config defaults", () => {
  it("has unique category slugs and a known package for each", () => {
    const slugs = CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const packageSlugs = new Set(PACKAGES.map((p) => p.slug));
    for (const c of CATEGORIES) expect(packageSlugs.has(c.packageSlug)).toBe(true);
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(30);
  });

  it("defines the seven product slugs", () => {
    expect(PRODUCTS.map((p) => p.slug)).toEqual([
      "internet",
      "mobile",
      "voice",
      "tv",
      "security",
      "wifi_pro",
      "other",
    ]);
  });

  it("has sane exclusion thresholds", () => {
    expect(DEFAULT_EXCLUSION_CONFIG.costHardLimit).toBe(2_000_000);
    expect(DEFAULT_EXCLUSION_CONFIG.sameNameLimit).toBe(5);
    expect(DEFAULT_EXCLUSION_CONFIG.chains).toContain("walmart");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm test -- tests/unit/config.test.ts
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Write the config modules**

Create `src/lib/config/packages.ts`:

```ts
export const PACKAGES = [
  { slug: "internet_tv_voice", label: "Internet + TV + Voice" },
  { slug: "internet_voice_multiline", label: "Internet + Multi-line Voice" },
  { slug: "internet_mobile", label: "Internet + Mobile" },
  { slug: "internet_voice", label: "Internet + Voice" },
  { slug: "full_bundle", label: "Full Bundle (new build)" },
] as const;

export type PackageSlug = (typeof PACKAGES)[number]["slug"];

export const PRODUCTS = [
  { slug: "internet", label: "Internet" },
  { slug: "mobile", label: "Mobile" },
  { slug: "voice", label: "Voice" },
  { slug: "tv", label: "TV" },
  { slug: "security", label: "Security" },
  { slug: "wifi_pro", label: "WiFi Pro" },
  { slug: "other", label: "Other" },
] as const;

export type ProductSlug = (typeof PRODUCTS)[number]["slug"];
export const PRODUCT_SLUGS = PRODUCTS.map((p) => p.slug) as ProductSlug[];

export function packageLabel(slug: string | null | undefined): string {
  return PACKAGES.find((p) => p.slug === slug)?.label ?? "";
}
```

Create `src/lib/config/categories.ts`:

```ts
import type { PackageSlug } from "./packages";

export type Category = {
  slug: string;
  label: string;
  /** Text sent to Places Text Search, e.g. "nail salon in 77084" */
  query: string;
  packageSlug: PackageSlug;
};

export const CATEGORIES: Category[] = [
  { slug: "restaurant", label: "Restaurant", query: "restaurant", packageSlug: "internet_tv_voice" },
  { slug: "cafe", label: "Cafe / Coffee shop", query: "coffee shop", packageSlug: "internet_tv_voice" },
  { slug: "bar", label: "Bar", query: "bar", packageSlug: "internet_tv_voice" },
  { slug: "bakery", label: "Bakery", query: "bakery", packageSlug: "internet_tv_voice" },
  { slug: "nail_salon", label: "Nail salon", query: "nail salon", packageSlug: "internet_mobile" },
  { slug: "hair_salon", label: "Hair salon", query: "hair salon", packageSlug: "internet_mobile" },
  { slug: "barber", label: "Barber shop", query: "barber shop", packageSlug: "internet_mobile" },
  { slug: "spa", label: "Spa", query: "day spa", packageSlug: "internet_mobile" },
  { slug: "boutique", label: "Boutique / Clothing", query: "boutique clothing store", packageSlug: "internet_mobile" },
  { slug: "gift_shop", label: "Gift shop", query: "gift shop", packageSlug: "internet_mobile" },
  { slug: "florist", label: "Florist", query: "florist", packageSlug: "internet_mobile" },
  { slug: "dentist", label: "Dentist", query: "dentist", packageSlug: "internet_voice_multiline" },
  { slug: "medical_clinic", label: "Medical clinic", query: "medical clinic", packageSlug: "internet_voice_multiline" },
  { slug: "chiropractor", label: "Chiropractor", query: "chiropractor", packageSlug: "internet_voice_multiline" },
  { slug: "optometrist", label: "Optometrist", query: "optometrist", packageSlug: "internet_voice_multiline" },
  { slug: "veterinarian", label: "Veterinarian", query: "veterinarian", packageSlug: "internet_voice_multiline" },
  { slug: "pet_grooming", label: "Pet grooming", query: "pet grooming", packageSlug: "internet_mobile" },
  { slug: "daycare", label: "Daycare", query: "daycare", packageSlug: "internet_voice" },
  { slug: "tutoring", label: "Tutoring center", query: "tutoring center", packageSlug: "internet_voice" },
  { slug: "gym", label: "Gym / Fitness studio", query: "gym", packageSlug: "internet_mobile" },
  { slug: "yoga", label: "Yoga / Pilates studio", query: "yoga studio", packageSlug: "internet_mobile" },
  { slug: "auto_repair", label: "Auto repair", query: "auto repair shop", packageSlug: "internet_mobile" },
  { slug: "tire_shop", label: "Tire shop", query: "tire shop", packageSlug: "internet_mobile" },
  { slug: "car_wash", label: "Car wash", query: "car wash", packageSlug: "internet_mobile" },
  { slug: "dry_cleaner", label: "Dry cleaner", query: "dry cleaner", packageSlug: "internet_mobile" },
  { slug: "laundromat", label: "Laundromat", query: "laundromat", packageSlug: "internet_mobile" },
  { slug: "insurance", label: "Insurance agency", query: "insurance agency", packageSlug: "internet_voice_multiline" },
  { slug: "real_estate", label: "Real estate office", query: "real estate office", packageSlug: "internet_voice_multiline" },
  { slug: "law_office", label: "Law office", query: "law office", packageSlug: "internet_voice_multiline" },
  { slug: "accounting", label: "Accounting / CPA", query: "accountant", packageSlug: "internet_voice_multiline" },
  { slug: "tattoo", label: "Tattoo studio", query: "tattoo studio", packageSlug: "internet_mobile" },
  { slug: "phone_repair", label: "Phone repair", query: "phone repair", packageSlug: "internet_mobile" },
  { slug: "print_shop", label: "Print shop", query: "print shop", packageSlug: "internet_voice" },
  { slug: "pharmacy", label: "Independent pharmacy", query: "independent pharmacy", packageSlug: "internet_voice_multiline" },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export function categoryLabel(slug: string | null | undefined): string {
  return (slug && CATEGORY_BY_SLUG.get(slug)?.label) || slug || "";
}
```

Create `src/lib/config/exclusion.ts`:

```ts
export type ExclusionConfig = {
  /** lowercase substrings matched against the lowercase business/project name */
  chains: string[];
  /** patterns for government, education, health systems */
  entityPatterns: RegExp[];
  positiveKeywords: string[];
  softNegativeKeywords: string[];
  costHardLimit: number;
  sameNameLimit: number;
};

export const DEFAULT_EXCLUSION_CONFIG: ExclusionConfig = {
  chains: [
    "walmart", "h-e-b", "heb ", "kroger", "starbucks", "mcdonald", "cvs", "walgreens",
    "home depot", "lowe's", "target", "costco", "sam's club", "chick-fil-a", "whataburger",
    "taco bell", "wendy's", "burger king", "subway", "domino", "pizza hut", "dunkin",
    "7-eleven", "shell", "exxon", "chevron", "buc-ee", "memorial hermann", "methodist",
    "hca ", "texas children", "kelsey-seybold", "md anderson", "st. luke", "baylor",
    "amazon", "fedex", "ups store", "bank of america", "chase", "wells fargo",
  ],
  entityPatterns: [
    /\bisd\b/i,
    /\bcity of\b/i,
    /\bcounty\b/i,
    /\bhospital\b/i,
    /\bmedical center\b/i,
    /\buniversity\b/i,
    /\bcollege\b/i,
    /\bfederal\b/i,
    /\busps\b/i,
    /\bpost office\b/i,
    /\bschool district\b/i,
    /\bmetro\b/i,
    /\bport of\b/i,
  ],
  positiveKeywords: [
    "salon", "nails", "spa", "barber", "coffee", "cafe", "bakery", "taqueria", "restaurant",
    "bar", "grill", "boutique", "dental", "dentist", "chiropractic", "optometry", "daycare",
    "day care", "fitness", "yoga", "pilates", "tutoring", "clinic", "veterinary", "pet",
    "cleaners", "auto", "tire", "insurance", "realty", "law office", "cpa",
  ],
  softNegativeKeywords: [
    "apartments", "church", "school", "park", "sidewalk", "warehouse", "distribution",
    "industrial", "building 0",
  ],
  costHardLimit: 2_000_000,
  sameNameLimit: 5,
};
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- tests/unit/config.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Seed and commit**

```bash
npm run db:seed
git add -A
git commit -m "feat: category fan-out list, package map, exclusion defaults

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected seed output: `Seeded 34 system tags`.

---

### Task 6: Scoring — SMB fit, contact quality, package map, provider detection

**Files:**
- Create: `src/lib/scoring/types.ts`, `src/lib/scoring/smbFit.ts`, `src/lib/scoring/contactQuality.ts`, `src/lib/scoring/packageMap.ts`, `src/lib/scoring/providerDetect.ts`, `tests/unit/scoring/smbFit.test.ts`, `tests/unit/scoring/contactQuality.test.ts`, `tests/unit/scoring/packageMap.test.ts`, `tests/unit/scoring/providerDetect.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_EXCLUSION_CONFIG`, `CATEGORY_BY_SLUG` (Task 5).
- Produces:
  - `type ScoreReason = { code: string; points: number; detail: string }`
  - `type SmbWorkType = "new_construction" | "renovation" | "addition" | "historic" | "row"`
  - `scoreSmbFit(input: SmbFitInput, config?: ExclusionConfig): SmbFitResult` where `SmbFitInput = { name: string; facilityName?: string | null; estimatedCost?: number | null; squareFootage?: number | null; tenantFunded?: boolean | null; workType?: SmbWorkType | null; sameNameCount?: number | null }` and `SmbFitResult = { excluded: boolean; exclusionReasons: string[]; score: number; band: "high" | "medium" | "low"; reasons: ScoreReason[] }`
  - `scoreContactQuality(input: ContactQualityInput): ContactQualityResult` where `ContactQualityInput = { websiteReachable: boolean | null; phone: string | null; contacts: QualityContact[] }`, `QualityContact = { type: string; validationStatus: string; personName?: string | null; personTitle?: string | null }`, `ContactQualityResult = { score: number; band: "green" | "yellow" | "red"; reasons: ScoreReason[] }`
  - `suggestPackage(categorySlug: string | null | undefined, workType?: SmbWorkType | null): PackageSlug | null`
  - `detectProvider(text: string): { provider: string; evidence: string } | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/scoring/smbFit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreSmbFit } from "@/lib/scoring/smbFit";

describe("scoreSmbFit", () => {
  it("scores a tenant-funded adult day care renovation as high", () => {
    const r = scoreSmbFit({
      name: "La Dulce Vida Adult Day Care",
      facilityName: "La Dulce Vida Adult Day Car",
      estimatedCost: 60_000,
      squareFootage: 3_175,
      tenantFunded: true,
      workType: "renovation",
    });
    expect(r.excluded).toBe(false);
    expect(r.band).toBe("high");
    expect(r.score).toBe(95);
    expect(r.reasons.map((x) => x.code)).toEqual([
      "positive_keyword",
      "tenant_funded",
      "sqft_under_5k",
      "cost_under_250k",
      "work_type",
    ]);
  });

  it("hard-excludes a health system by chain name", () => {
    const r = scoreSmbFit({ name: "TIRR MH Dialysis EVS", facilityName: "TIRR Memorial Hermann", estimatedCost: 1_705_000 });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons[0]).toMatch(/^chain:memorial hermann/);
    expect(r.score).toBe(0);
  });

  it("hard-excludes by cost over the limit", () => {
    const r = scoreSmbFit({ name: "Hightower Business Park - Building 05", estimatedCost: 28_800_000, workType: "new_construction" });
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons).toContain("cost_over_2000000");
  });

  it("hard-excludes government and right-of-way work", () => {
    expect(scoreSmbFit({ name: "City of Houston Fire Station 12" }).excluded).toBe(true);
    expect(scoreSmbFit({ name: "Taylor Lester Park Entry Sidewalk", workType: "row" }).excluded).toBe(true);
  });

  it("hard-excludes same-name counts over the limit", () => {
    expect(scoreSmbFit({ name: "Quick Cuts", sameNameCount: 6 }).excluded).toBe(true);
    expect(scoreSmbFit({ name: "Quick Cuts", sameNameCount: 5 }).excluded).toBe(false);
  });

  it("applies soft negatives with a floor of zero", () => {
    const r = scoreSmbFit({ name: "Riverside Apartments Clubhouse", estimatedCost: 100_000 });
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(0);
    expect(r.band).toBe("low");
  });

  it("scores keyword alone as low and keyword plus small cost as medium", () => {
    const r = scoreSmbFit({ name: "Bella Nails & Spa" });
    expect(r.score).toBe(25);
    expect(r.band).toBe("low");
    const r2 = scoreSmbFit({ name: "Bella Nails & Spa", estimatedCost: 100_000 });
    expect(r2.band).toBe("medium");
  });
});
```

Create `tests/unit/scoring/contactQuality.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";

describe("scoreContactQuality", () => {
  it("returns red with nothing", () => {
    const r = scoreContactQuality({ websiteReachable: null, phone: null, contacts: [] });
    expect(r.score).toBe(0);
    expect(r.band).toBe("red");
  });

  it("scores website + phone + valid email as green", () => {
    const r = scoreContactQuality({
      websiteReachable: true,
      phone: "(713) 555-0100",
      contacts: [{ type: "email", validationStatus: "valid" }],
    });
    expect(r.score).toBe(75);
    expect(r.band).toBe("green");
    expect(r.reasons.map((x) => x.code)).toEqual(["website_reachable", "phone", "email_valid_mx"]);
  });

  it("ignores emails whose domain has no MX", () => {
    const r = scoreContactQuality({
      websiteReachable: false,
      phone: null,
      contacts: [{ type: "email", validationStatus: "invalid" }],
    });
    expect(r.score).toBe(0);
  });

  it("counts a named person with title and a social link", () => {
    const r = scoreContactQuality({
      websiteReachable: false,
      phone: "not a phone",
      contacts: [
        { type: "linkedin", validationStatus: "unchecked", personName: "Ana Ruiz", personTitle: "Owner" },
        { type: "facebook", validationStatus: "unchecked" },
      ],
    });
    expect(r.score).toBe(25);
    expect(r.band).toBe("red");
  });

  it("accepts a valid phone contact when the Google phone is missing", () => {
    const r = scoreContactQuality({
      websiteReachable: null,
      phone: null,
      contacts: [{ type: "phone", validationStatus: "valid" }],
    });
    expect(r.score).toBe(20);
  });
});
```

Create `tests/unit/scoring/packageMap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suggestPackage } from "@/lib/scoring/packageMap";

describe("suggestPackage", () => {
  it("maps categories", () => {
    expect(suggestPackage("restaurant")).toBe("internet_tv_voice");
    expect(suggestPackage("dentist")).toBe("internet_voice_multiline");
    expect(suggestPackage("nail_salon")).toBe("internet_mobile");
    expect(suggestPackage("daycare")).toBe("internet_voice");
  });
  it("prefers full_bundle for new construction", () => {
    expect(suggestPackage("restaurant", "new_construction")).toBe("full_bundle");
  });
  it("returns null for unknown", () => {
    expect(suggestPackage("nope")).toBeNull();
    expect(suggestPackage(null)).toBeNull();
  });
});
```

Create `tests/unit/scoring/providerDetect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectProvider } from "@/lib/scoring/providerDetect";

describe("detectProvider", () => {
  it("detects strong brands anywhere", () => {
    const r = detectProvider("Welcome! Free WiFi powered by AT&T Business. Open daily.");
    expect(r?.provider).toBe("att");
    expect(r?.evidence).toContain("powered by AT&T");
  });
  it("requires context for ambiguous brands", () => {
    expect(detectProvider("Spectrum Dental Care is accepting new patients")).toBeNull();
    expect(detectProvider("Our internet service is provided by Spectrum Business")?.provider).toBe("spectrum");
  });
  it("returns null when nothing matches", () => {
    expect(detectProvider("Best tacos in Houston")).toBeNull();
  });
  it("normalizes T-Mobile and Google Fiber", () => {
    expect(detectProvider("we use T Mobile home internet")?.provider).toBe("tmobile");
    expect(detectProvider("Google Fiber available here")?.provider).toBe("google_fiber");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm test -- tests/unit/scoring
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the scoring modules**

Create `src/lib/scoring/types.ts`:

```ts
export type ScoreReason = { code: string; points: number; detail: string };
export type SmbWorkType = "new_construction" | "renovation" | "addition" | "historic" | "row";
```

Create `src/lib/scoring/smbFit.ts`:

```ts
import { DEFAULT_EXCLUSION_CONFIG, type ExclusionConfig } from "@/lib/config/exclusion";
import type { ScoreReason, SmbWorkType } from "./types";

export type SmbFitInput = {
  name: string;
  facilityName?: string | null;
  estimatedCost?: number | null;
  squareFootage?: number | null;
  tenantFunded?: boolean | null;
  workType?: SmbWorkType | null;
  sameNameCount?: number | null;
};

export type SmbFitBand = "high" | "medium" | "low";

export type SmbFitResult = {
  excluded: boolean;
  exclusionReasons: string[];
  score: number;
  band: SmbFitBand;
  reasons: ScoreReason[];
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, kw: string) {
  return new RegExp(`\\b${escapeRe(kw)}\\b`, "i").test(text);
}

export function bandFor(score: number): SmbFitBand {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

export function scoreSmbFit(
  input: SmbFitInput,
  config: ExclusionConfig = DEFAULT_EXCLUSION_CONFIG,
): SmbFitResult {
  const text = [input.name, input.facilityName ?? ""].join(" ").toLowerCase();
  const exclusionReasons: string[] = [];

  const chain = config.chains.find((c) => text.includes(c));
  if (chain) exclusionReasons.push(`chain:${chain.trim()}`);
  const entity = config.entityPatterns.find((p) => p.test(text));
  if (entity) exclusionReasons.push(`entity:${entity.source}`);
  if (input.estimatedCost != null && input.estimatedCost > config.costHardLimit) {
    exclusionReasons.push(`cost_over_${config.costHardLimit}`);
  }
  if (input.workType === "row") exclusionReasons.push("public_right_of_way");
  if (input.sameNameCount != null && input.sameNameCount > config.sameNameLimit) {
    exclusionReasons.push(`same_name_count:${input.sameNameCount}`);
  }
  if (exclusionReasons.length > 0) {
    return { excluded: true, exclusionReasons, score: 0, band: "low", reasons: [] };
  }

  const reasons: ScoreReason[] = [];
  let score = 0;
  const add = (code: string, points: number, detail: string) => {
    reasons.push({ code, points, detail });
    score += points;
  };

  const kw = config.positiveKeywords.find((k) => hasWord(text, k));
  if (kw) add("positive_keyword", 25, `name contains "${kw}"`);
  if (input.tenantFunded) add("tenant_funded", 25, "tenant-funded build-out");
  if (input.squareFootage != null) {
    if (input.squareFootage < 5_000) add("sqft_under_5k", 15, `${input.squareFootage} sq ft`);
    else if (input.squareFootage < 10_000) add("sqft_under_10k", 5, `${input.squareFootage} sq ft`);
  }
  if (input.estimatedCost != null) {
    if (input.estimatedCost < 250_000) add("cost_under_250k", 20, `$${input.estimatedCost}`);
    else if (input.estimatedCost < 750_000) add("cost_under_750k", 10, `$${input.estimatedCost}`);
  }
  if (input.workType === "renovation") add("work_type", 10, "renovation/alteration");
  else if (input.workType === "new_construction") add("work_type", 5, "new construction");
  for (const neg of config.softNegativeKeywords) {
    if (text.includes(neg)) add("soft_negative", -30, `name contains "${neg}"`);
  }

  score = Math.max(0, Math.min(100, score));
  return { excluded: false, exclusionReasons: [], score, band: bandFor(score), reasons };
}
```

Create `src/lib/scoring/contactQuality.ts`:

```ts
import { isValidPhoneNumber } from "libphonenumber-js";
import type { ScoreReason } from "./types";

export type QualityContact = {
  type: string;
  validationStatus: string;
  personName?: string | null;
  personTitle?: string | null;
};

export type ContactQualityInput = {
  websiteReachable: boolean | null;
  phone: string | null;
  contacts: QualityContact[];
};

export type QualityBand = "green" | "yellow" | "red";

export type ContactQualityResult = { score: number; band: QualityBand; reasons: ScoreReason[] };

const SOCIAL_TYPES = new Set(["linkedin", "facebook", "instagram", "twitter", "yelp"]);

export function qualityBandFor(score: number): QualityBand {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

export function scoreContactQuality(input: ContactQualityInput): ContactQualityResult {
  const reasons: ScoreReason[] = [];
  let score = 0;
  const add = (code: string, points: number, detail: string) => {
    reasons.push({ code, points, detail });
    score += points;
  };

  if (input.websiteReachable === true) add("website_reachable", 25, "website loads");

  const googlePhoneOk = !!input.phone && isValidPhoneNumber(input.phone, "US");
  const phoneContactOk = input.contacts.some(
    (c) => c.type === "phone" && c.validationStatus !== "invalid",
  );
  if (googlePhoneOk || phoneContactOk) add("phone", 20, "phone present and well-formed");

  if (input.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")) {
    add("email_valid_mx", 30, "email with valid MX domain");
  }
  if (input.contacts.some((c) => c.personName && c.personTitle)) {
    add("named_person", 15, "named decision-maker with title");
  }
  if (input.contacts.some((c) => SOCIAL_TYPES.has(c.type))) {
    add("social_link", 10, "social or LinkedIn link");
  }

  return { score, band: qualityBandFor(score), reasons };
}
```

Create `src/lib/scoring/packageMap.ts`:

```ts
import { CATEGORY_BY_SLUG } from "@/lib/config/categories";
import type { PackageSlug } from "@/lib/config/packages";
import type { SmbWorkType } from "./types";

export function suggestPackage(
  categorySlug: string | null | undefined,
  workType?: SmbWorkType | null,
): PackageSlug | null {
  if (workType === "new_construction") return "full_bundle";
  if (!categorySlug) return null;
  return CATEGORY_BY_SLUG.get(categorySlug)?.packageSlug ?? null;
}
```

Create `src/lib/scoring/providerDetect.ts`:

```ts
type ProviderRule = { slug: string; pattern: RegExp; needsContext: boolean };

const CONTEXT = /\b(internet|wifi|wi-fi|fiber|broadband|powered|provided|service|network|business)\b/i;

const RULES: ProviderRule[] = [
  { slug: "att", pattern: /\bat\s?&\s?t\b/i, needsContext: false },
  { slug: "xfinity", pattern: /\bxfinity\b/i, needsContext: false },
  { slug: "comcast", pattern: /\bcomcast\b/i, needsContext: false },
  { slug: "tmobile", pattern: /\bt[\s-]?mobile\b/i, needsContext: false },
  { slug: "google_fiber", pattern: /\bgoogle fiber\b/i, needsContext: false },
  { slug: "tachus", pattern: /\btachus\b/i, needsContext: false },
  { slug: "spectrum", pattern: /\bspectrum\b/i, needsContext: true },
  { slug: "charter", pattern: /\bcharter\b/i, needsContext: true },
  { slug: "verizon", pattern: /\bverizon\b/i, needsContext: true },
  { slug: "frontier", pattern: /\bfrontier\b/i, needsContext: true },
];

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectProvider(text: string): { provider: string; evidence: string } | null {
  if (!text) return null;
  for (const sentence of sentences(text)) {
    for (const rule of RULES) {
      if (!rule.pattern.test(sentence)) continue;
      if (rule.needsContext && !CONTEXT.test(sentence)) continue;
      return { provider: rule.slug, evidence: sentence.slice(0, 200) };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test -- tests/unit/scoring
```

Expected: all pass (7 + 5 + 3 + 4 = 19 tests). If the "Bella Nails & Spa" case fails on keyword matching, confirm `positiveKeywords` in Task 5 contains `"nails"` and `"spa"` (it does) and that `hasWord` uses word boundaries.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SMB fit, contact quality, package map, provider detection scoring

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Website contact extractor

**Files:**
- Create: `src/lib/extract/normalize.ts`, `src/lib/extract/website.ts`, `tests/fixtures/html/nails-home.html`, `tests/fixtures/html/nails-contact.html`, `tests/unit/extract/normalize.test.ts`, `tests/unit/extract/website.test.ts`

**Interfaces:**
- Consumes: `detectProvider` (Task 6).
- Produces:
  - `normalizeEmail(raw: string): string | null`, `normalizePhone(raw: string): string | null` (E.164), `classifySocialUrl(href: string): { type: SocialType; url: string } | null`, `type SocialType = "linkedin" | "facebook" | "instagram" | "twitter" | "yelp"`, `normalizeWebsiteUrl(raw: string): string | null`
  - `type FetchResult = { ok: true; status: number; html: string; finalUrl: string } | { ok: false; status?: number; error: string }`
  - `type PageFetcher = (url: string) => Promise<FetchResult>`; `defaultFetcher: PageFetcher`; `USER_AGENT`, `REQUEST_TIMEOUT_MS`
  - `type ExtractedContacts = { reachable: boolean; error?: string; pagesFetched: string[]; emails: string[]; phones: string[]; socials: { type: SocialType; url: string }[]; providerHint: { provider: string; evidence: string } | null }`
  - `extractWebsiteContacts(websiteUrl: string, fetcher?: PageFetcher): Promise<ExtractedContacts>`

- [ ] **Step 1: Write fixtures**

Create `tests/fixtures/html/nails-home.html`:

```html
<!doctype html>
<html><head><title>Bella Nails &amp; Spa</title>
<script>window.__x = "noise@tracking.example";</script>
<style>.a{color:red}</style></head>
<body>
<header><h1>Bella Nails & Spa</h1>
<nav><a href="/">Home</a> <a href="/services">Services</a> <a href="/contact-us">Contact Us</a></nav></header>
<p>Walk-ins welcome. Call <a href="tel:+17135550100">(713) 555-0100</a> or text 713.555.0199.</p>
<p>Free WiFi powered by AT&amp;T Business for our guests.</p>
<footer>
  <a href="https://www.facebook.com/bellanailshouston/">Facebook</a>
  <a href="https://instagram.com/bellanails?utm_source=site">Instagram</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
  <img src="logo@2x.png" alt="logo">
</footer>
</body></html>
```

Create `tests/fixtures/html/nails-contact.html`:

```html
<!doctype html>
<html><body>
<h2>Contact</h2>
<p>Email: <a href="mailto:Hello@BellaNails.com?subject=Hi">Hello@BellaNails.com</a></p>
<p>Owner: ana [at] bellanails [dot] com</p>
<p>Find us on <a href="https://www.linkedin.com/company/bella-nails-spa/">LinkedIn</a> and
<a href="https://www.yelp.com/biz/bella-nails-houston">Yelp</a></p>
</body></html>
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/extract/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizePhone, classifySocialUrl, normalizeWebsiteUrl } from "@/lib/extract/normalize";

describe("normalizeEmail", () => {
  it("lowercases and strips mailto and query", () => {
    expect(normalizeEmail("mailto:Hello@BellaNails.com?subject=Hi")).toBe("hello@bellanails.com");
  });
  it("rejects image names and junk", () => {
    expect(normalizeEmail("logo@2x.png")).toBeNull();
    expect(normalizeEmail("user@example.com")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("returns E.164 for US numbers", () => {
    expect(normalizePhone("(713) 555-0100")).toBe("+17135550100");
    expect(normalizePhone("713.555.0199")).toBe("+17135550199");
    expect(normalizePhone("tel:+17135550100")).toBe("+17135550100");
  });
  it("rejects invalid", () => {
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("classifySocialUrl", () => {
  it("classifies and canonicalizes", () => {
    expect(classifySocialUrl("https://instagram.com/bellanails?utm_source=site")).toEqual({
      type: "instagram",
      url: "https://instagram.com/bellanails",
    });
    expect(classifySocialUrl("https://www.linkedin.com/company/bella-nails-spa/")?.type).toBe("linkedin");
    expect(classifySocialUrl("https://x.com/bella")?.type).toBe("twitter");
    expect(classifySocialUrl("https://www.yelp.com/biz/bella")?.type).toBe("yelp");
  });
  it("ignores share links and non-social", () => {
    expect(classifySocialUrl("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(classifySocialUrl("https://twitter.com/intent/tweet?text=hi")).toBeNull();
    expect(classifySocialUrl("https://example.com")).toBeNull();
  });
});

describe("normalizeWebsiteUrl", () => {
  it("adds https and strips fragments", () => {
    expect(normalizeWebsiteUrl("bellanails.com/#home")).toBe("https://bellanails.com/");
    expect(normalizeWebsiteUrl("http://www.bellanails.com/menu?x=1")).toBe("http://www.bellanails.com/menu");
    expect(normalizeWebsiteUrl("")).toBeNull();
  });
});
```

Create `tests/unit/extract/website.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractWebsiteContacts, pickCandidatePages, type PageFetcher } from "@/lib/extract/website";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "../../fixtures/html", name), "utf8");

const fetcher: PageFetcher = async (url) => {
  if (url === "https://bellanails.com/") return { ok: true, status: 200, html: fixture("nails-home.html"), finalUrl: url };
  if (url === "https://bellanails.com/contact-us") return { ok: true, status: 200, html: fixture("nails-contact.html"), finalUrl: url };
  return { ok: false, status: 404, error: "HTTP 404" };
};

describe("extractWebsiteContacts", () => {
  it("collects emails, phones, socials, and a provider hint across pages", async () => {
    const r = await extractWebsiteContacts("bellanails.com", fetcher);
    expect(r.reachable).toBe(true);
    expect(r.pagesFetched).toEqual(["https://bellanails.com/", "https://bellanails.com/contact-us"]);
    expect(r.emails).toEqual(["ana@bellanails.com", "hello@bellanails.com"]);
    expect(r.phones).toEqual(["+17135550100", "+17135550199"]);
    expect(r.socials).toEqual([
      { type: "facebook", url: "https://www.facebook.com/bellanailshouston" },
      { type: "instagram", url: "https://instagram.com/bellanails" },
      { type: "linkedin", url: "https://www.linkedin.com/company/bella-nails-spa" },
      { type: "yelp", url: "https://www.yelp.com/biz/bella-nails-houston" },
    ]);
    expect(r.providerHint?.provider).toBe("att");
  });

  it("reports unreachable sites without throwing", async () => {
    const dead: PageFetcher = async () => ({ ok: false, error: "timeout" });
    const r = await extractWebsiteContacts("https://dead.example", dead);
    expect(r.reachable).toBe(false);
    expect(r.error).toBe("timeout");
    expect(r.emails).toEqual([]);
  });

  it("falls back to /contact and /about when no links match", () => {
    const pages = pickCandidatePages("https://x.com/", "<html><body><a href='/menu'>Menu</a></body></html>");
    expect(pages).toEqual(["https://x.com/contact", "https://x.com/about"]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
npm test -- tests/unit/extract
```

Expected: FAIL, modules not found.

- [ ] **Step 4: Implement normalize.ts**

Create `src/lib/extract/normalize.ts`:

```ts
import { parsePhoneNumberFromString } from "libphonenumber-js";

export type SocialType = "linkedin" | "facebook" | "instagram" | "twitter" | "yelp";

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/;
const JUNK_DOMAINS = ["example.com", "example.org", "sentry.io", "wixpress.com", "domain.com", "email.com", "yourdomain.com"];

export function normalizeEmail(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("mailto:")) s = s.slice(7);
  s = s.split("?")[0];
  if (!EMAIL_RE.test(s)) return null;
  if (IMAGE_EXT_RE.test(s)) return null;
  const domain = s.split("@")[1];
  if (JUNK_DOMAINS.some((j) => domain === j || domain.endsWith(`.${j}`))) return null;
  return s;
}

export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/^tel:/i, "");
  const p = parsePhoneNumberFromString(s, "US");
  if (!p || !p.isValid()) return null;
  return p.number;
}

const SHARE_PATH_RE = /\/(sharer|share|intent|dialog|plugins)\b/i;

export function classifySocialUrl(href: string): { type: SocialType; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  if (SHARE_PATH_RE.test(path) || path === "") return null;

  let type: SocialType | null = null;
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) type = "linkedin";
  else if (host === "facebook.com" || host === "fb.com" || host.endsWith(".facebook.com")) type = "facebook";
  else if (host === "instagram.com" || host.endsWith(".instagram.com")) type = "instagram";
  else if (host === "twitter.com" || host === "x.com" || host.endsWith(".twitter.com")) type = "twitter";
  else if (host === "yelp.com" || host.endsWith(".yelp.com")) type = "yelp";
  if (!type) return null;

  return { type, url: `${u.protocol}//${u.hostname.toLowerCase()}${path}` };
}

export function normalizeWebsiteUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement website.ts**

Create `src/lib/extract/website.ts`:

```ts
import * as cheerio from "cheerio";
import { detectProvider } from "@/lib/scoring/providerDetect";
import {
  classifySocialUrl,
  normalizeEmail,
  normalizePhone,
  normalizeWebsiteUrl,
  type SocialType,
} from "./normalize";

export const USER_AGENT = "SDR-LeadGen/1.0 (+contact info research)";
export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_EXTRA_PAGES = 3;

export type FetchResult =
  | { ok: true; status: number; html: string; finalUrl: string }
  | { ok: false; status?: number; error: string };

export type PageFetcher = (url: string) => Promise<FetchResult>;

export const defaultFetcher: PageFetcher = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return { ok: true, status: res.status, html: "", finalUrl: res.url };
    }
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    return { ok: true, status: res.status, html, finalUrl: res.url };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
};

export type ExtractedContacts = {
  reachable: boolean;
  error?: string;
  pagesFetched: string[];
  emails: string[];
  phones: string[];
  socials: { type: SocialType; url: string }[];
  providerHint: { provider: string; evidence: string } | null;
};

const CONTACT_LINK_RE = /contact|about|reach|team|staff|location/i;
const EMAIL_SCAN_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const OBFUSCATED_RE =
  /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\})\s*([a-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\})\s*([a-z]{2,})/gi;
const PHONE_SCAN_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export function pickCandidatePages(baseUrl: string, html: string, max = MAX_EXTRA_PAGES): string[] {
  const base = new URL(baseUrl);
  const $ = cheerio.load(html);
  const found: string[] = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = $(a).text();
    if (!CONTACT_LINK_RE.test(href) && !CONTACT_LINK_RE.test(text)) return;
    try {
      const u = new URL(href, base);
      if (u.hostname !== base.hostname) return;
      if (/\.(pdf|jpe?g|png|gif)$/i.test(u.pathname)) return;
      const clean = `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, "") || "/"}`;
      if (clean === `${base.protocol}//${base.hostname}/`) return;
      if (!found.includes(clean)) found.push(clean);
    } catch {
      /* ignore bad hrefs */
    }
  });
  if (found.length === 0) {
    found.push(`${base.protocol}//${base.hostname}/contact`, `${base.protocol}//${base.hostname}/about`);
  }
  return found.slice(0, max);
}

type PageExtract = { emails: Set<string>; phones: Set<string>; socials: Map<string, { type: SocialType; url: string }>; text: string };

export function extractFromHtml(html: string): PageExtract {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials = new Map<string, { type: SocialType; url: string }>();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/^mailto:/i.test(href)) {
      const e = normalizeEmail(href);
      if (e) emails.add(e);
    } else if (/^tel:/i.test(href)) {
      const p = normalizePhone(href);
      if (p) phones.add(p);
    } else {
      const s = classifySocialUrl(href);
      if (s) socials.set(s.url, s);
    }
  });

  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  for (const m of text.matchAll(EMAIL_SCAN_RE)) {
    const e = normalizeEmail(m[0]);
    if (e) emails.add(e);
  }
  for (const m of text.matchAll(OBFUSCATED_RE)) {
    const e = normalizeEmail(`${m[1]}@${m[2]}.${m[3]}`);
    if (e) emails.add(e);
  }
  for (const m of text.matchAll(PHONE_SCAN_RE)) {
    const p = normalizePhone(m[0]);
    if (p) phones.add(p);
  }
  return { emails, phones, socials, text };
}

export async function extractWebsiteContacts(
  websiteUrl: string,
  fetcher: PageFetcher = defaultFetcher,
): Promise<ExtractedContacts> {
  const empty: ExtractedContacts = { reachable: false, pagesFetched: [], emails: [], phones: [], socials: [], providerHint: null };
  const home = normalizeWebsiteUrl(websiteUrl);
  if (!home) return { ...empty, error: "invalid url" };

  const first = await fetcher(home);
  if (!first.ok) return { ...empty, error: first.error };

  const pagesFetched = [home];
  const merged = extractFromHtml(first.html);
  let allText = merged.text;

  for (const url of pickCandidatePages(first.finalUrl || home, first.html)) {
    const res = await fetcher(url);
    if (!res.ok) continue;
    pagesFetched.push(url);
    const part = extractFromHtml(res.html);
    part.emails.forEach((e) => merged.emails.add(e));
    part.phones.forEach((p) => merged.phones.add(p));
    part.socials.forEach((s, k) => merged.socials.set(k, s));
    allText += " " + part.text;
  }

  return {
    reachable: true,
    pagesFetched,
    emails: [...merged.emails].sort(),
    phones: [...merged.phones].sort(),
    socials: [...merged.socials.values()].sort((a, b) => a.type.localeCompare(b.type)),
    providerHint: detectProvider(allText),
  };
}
```

- [ ] **Step 6: Run the tests**

```bash
npm test -- tests/unit/extract
```

Expected: all pass. If `pagesFetched` differs, check that `pickCandidatePages` dedupes and skips the home URL. If the social order differs, note the sort is by type alphabetically: facebook, instagram, linkedin, yelp.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: website contact extractor with normalization and fixtures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Provider layer — interfaces, Google, validation, budget, fakes

**Files:**
- Create: `src/lib/providers/types.ts`, `src/lib/providers/google.ts`, `src/lib/providers/validation.ts`, `src/lib/providers/budget.ts`, `src/lib/providers/keys.ts`, `src/lib/crypto.ts`, `src/lib/providers/fake.ts`, `src/lib/providers/index.ts`, `tests/unit/providers/google.test.ts`, `tests/unit/providers/budget.test.ts`, `tests/unit/crypto.test.ts`, `tests/db/budget.test.ts`

**Interfaces:**
- Consumes: `PageFetcher`, `FetchResult` (Task 7), `prisma` (Task 2).
- Produces:
  - `type GeocodeResult = { lat: number; lng: number; city: string | null; state: string | null; radiusMeters: number }`
  - `interface GeocodeProvider { geocodeZip(zip: string): Promise<GeocodeResult | null> }`
  - `type DiscoveredBusiness = { placeId: string; name: string; formattedAddress: string | null; zip: string | null; lat: number | null; lng: number | null; phone: string | null; websiteUrl: string | null; rating: number | null; reviewCount: number | null; types: string[] }`
  - `interface DiscoveryProvider { searchCategory(query: string, center: { lat: number; lng: number }, radiusMeters: number, maxResults?: number): Promise<DiscoveredBusiness[]> }`
  - `interface ValidationProvider { checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }>; domainHasMx(domain: string): Promise<boolean> }`
  - `type Providers = { geocode: GeocodeProvider; discovery: DiscoveryProvider; validation: ValidationProvider; fetcher: PageFetcher }`
  - `getProviders(): Providers` (reads `PROVIDER_MODE`)
  - `withBudget<T>(provider: string, fn: () => Promise<T>): Promise<T>`, `class BudgetExhaustedError`, `todayKey(tz?: string): string`
  - `encryptString(plain: string, secret: string): string`, `decryptString(cipher: string, secret: string): string`
  - `getProviderKey(provider: "google" | "apollo"): Promise<string | null>`
  - `mapPlace(p: PlacesApiPlace): DiscoveredBusiness` (exported for tests)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { encryptString, decryptString } from "@/lib/crypto";

const secret = "a-very-long-app-secret-for-testing-1234567890";

describe("crypto", () => {
  it("round-trips", () => {
    const c = encryptString("AIza-secret-key", secret);
    expect(c).not.toContain("AIza");
    expect(decryptString(c, secret)).toBe("AIza-secret-key");
  });
  it("produces different ciphertexts for the same input", () => {
    expect(encryptString("x", secret)).not.toBe(encryptString("x", secret));
  });
  it("fails with the wrong secret", () => {
    const c = encryptString("x", secret);
    expect(() => decryptString(c, "wrong-secret-wrong-secret-wrong-secret")).toThrow();
  });
});
```

Create `tests/unit/providers/google.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapPlace, radiusFromViewport, cityAndState } from "@/lib/providers/google";

describe("google mappers", () => {
  it("maps a Places (New) result", () => {
    const b = mapPlace({
      id: "ChIJabc",
      displayName: { text: "Bella Nails & Spa" },
      formattedAddress: "123 Main St, Houston, TX 77084, USA",
      location: { latitude: 29.84, longitude: -95.66 },
      nationalPhoneNumber: "(713) 555-0100",
      websiteUri: "http://bellanails.com/",
      rating: 4.6,
      userRatingCount: 88,
      types: ["nail_salon", "point_of_interest"],
      addressComponents: [{ longText: "77084", types: ["postal_code"] }],
    });
    expect(b).toEqual({
      placeId: "ChIJabc",
      name: "Bella Nails & Spa",
      formattedAddress: "123 Main St, Houston, TX 77084, USA",
      zip: "77084",
      lat: 29.84,
      lng: -95.66,
      phone: "(713) 555-0100",
      websiteUrl: "http://bellanails.com/",
      rating: 4.6,
      reviewCount: 88,
      types: ["nail_salon", "point_of_interest"],
    });
  });

  it("derives a clamped radius from a viewport", () => {
    const r = radiusFromViewport({
      northeast: { lat: 29.9, lng: -95.6 },
      southwest: { lat: 29.8, lng: -95.7 },
    });
    expect(r).toBeGreaterThan(5000);
    expect(r).toBeLessThanOrEqual(8000);
    expect(radiusFromViewport(undefined)).toBe(3000);
  });

  it("extracts city and state from geocode components", () => {
    expect(
      cityAndState([
        { long_name: "Houston", short_name: "Houston", types: ["locality", "political"] },
        { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1", "political"] },
      ]),
    ).toEqual({ city: "Houston", state: "TX" });
  });
});
```

Create `tests/unit/providers/budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { todayKey } from "@/lib/providers/budget";

describe("todayKey", () => {
  it("formats YYYY-MM-DD in the given timezone", () => {
    expect(todayKey("America/Chicago")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm test -- tests/unit/crypto tests/unit/providers
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Implement crypto and types**

Create `src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFrom(secret: string) {
  return createHash("sha256").update(secret).digest();
}

/** Returns base64(iv):base64(tag):base64(ciphertext) */
export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
}

export function decryptString(payload: string, secret: string): string {
  const [ivB64, tagB64, encB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}
```

Create `src/lib/providers/types.ts`:

```ts
import type { PageFetcher } from "@/lib/extract/website";

export type GeocodeResult = {
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  radiusMeters: number;
};

export interface GeocodeProvider {
  geocodeZip(zip: string): Promise<GeocodeResult | null>;
}

export type DiscoveredBusiness = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  websiteUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  types: string[];
};

export interface DiscoveryProvider {
  searchCategory(
    query: string,
    center: { lat: number; lng: number },
    radiusMeters: number,
    maxResults?: number,
  ): Promise<DiscoveredBusiness[]>;
}

export interface ValidationProvider {
  checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }>;
  domainHasMx(domain: string): Promise<boolean>;
}

export type Providers = {
  geocode: GeocodeProvider;
  discovery: DiscoveryProvider;
  validation: ValidationProvider;
  fetcher: PageFetcher;
};
```

- [ ] **Step 4: Implement budget and keys**

Create `src/lib/providers/budget.ts`:

```ts
import { prisma } from "@/lib/db";

export class BudgetExhaustedError extends Error {
  constructor(public provider: string) {
    super(`Daily budget exhausted for ${provider}`);
    this.name = "BudgetExhaustedError";
  }
}

export function todayKey(tz = "America/Chicago"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function defaultBudgetFor(provider: string): number {
  const raw = process.env[`${provider.toUpperCase()}_DAILY_BUDGET`];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/** Counts one call against the provider's daily budget, then runs fn. */
export async function withBudget<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const today = todayKey();
  const cfg = await prisma.providerConfig.upsert({
    where: { provider },
    update: {},
    create: { provider, dailyBudget: defaultBudgetFor(provider) },
  });
  if (!cfg.enabled) throw new Error(`Provider ${provider} is disabled`);
  const used = cfg.usageDate === today ? cfg.usedToday : 0;
  if (used >= cfg.dailyBudget) throw new BudgetExhaustedError(provider);
  await prisma.providerConfig.update({
    where: { provider },
    data: { usageDate: today, usedToday: used + 1 },
  });
  return fn();
}

export async function budgetStatus(provider: string) {
  const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!cfg) return { used: 0, limit: defaultBudgetFor(provider), exhausted: false };
  const used = cfg.usageDate === todayKey() ? cfg.usedToday : 0;
  return { used, limit: cfg.dailyBudget, exhausted: used >= cfg.dailyBudget };
}
```

Create `src/lib/providers/keys.ts`:

```ts
import { prisma } from "@/lib/db";
import { decryptString } from "@/lib/crypto";

const ENV_NAMES = { google: "GOOGLE_MAPS_API_KEY", apollo: "APOLLO_API_KEY" } as const;

export async function getProviderKey(provider: keyof typeof ENV_NAMES): Promise<string | null> {
  const fromEnv = process.env[ENV_NAMES[provider]];
  if (fromEnv) return fromEnv;
  const secret = process.env.APP_SECRET;
  if (!secret) return null;
  const cfg = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!cfg?.encryptedKey) return null;
  return decryptString(cfg.encryptedKey, secret);
}
```

- [ ] **Step 5: Implement the Google provider**

Create `src/lib/providers/google.ts`:

```ts
import { withBudget } from "./budget";
import { getProviderKey } from "./keys";
import type { DiscoveredBusiness, DiscoveryProvider, GeocodeProvider, GeocodeResult } from "./types";

type LatLng = { lat: number; lng: number };
type Viewport = { northeast: LatLng; southwest: LatLng };
type GeocodeComponent = { long_name: string; short_name: string; types: string[] };

export type PlacesApiPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  addressComponents?: { longText?: string; shortText?: string; types: string[] }[];
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.addressComponents",
  "nextPageToken",
].join(",");

function haversineMeters(a: LatLng, b: LatLng) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function radiusFromViewport(v: Viewport | undefined): number {
  if (!v) return 3000;
  const half = haversineMeters(v.northeast, v.southwest) / 2;
  return Math.round(Math.max(1500, Math.min(8000, half)));
}

export function cityAndState(components: GeocodeComponent[]) {
  const find = (t: string) => components.find((c) => c.types.includes(t));
  const city = find("locality") ?? find("sublocality") ?? find("neighborhood") ?? find("postal_town");
  const state = find("administrative_area_level_1");
  return { city: city?.long_name ?? null, state: state?.short_name ?? null };
}

export function mapPlace(p: PlacesApiPlace): DiscoveredBusiness {
  const zip = p.addressComponents?.find((c) => c.types.includes("postal_code"))?.longText ?? null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    formattedAddress: p.formattedAddress ?? null,
    zip,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    phone: p.nationalPhoneNumber ?? null,
    websiteUrl: p.websiteUri ?? null,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? null,
    types: p.types ?? [],
  };
}

async function requireKey() {
  const key = await getProviderKey("google");
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  return key;
}

export class GoogleGeocodeProvider implements GeocodeProvider {
  async geocodeZip(zip: string): Promise<GeocodeResult | null> {
    const key = await requireKey();
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("components", `postal_code:${zip}|country:US`);
    url.searchParams.set("key", key);
    const data = await withBudget("google", async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
      return res.json() as Promise<{
        status: string;
        results: { geometry: { location: LatLng; bounds?: Viewport; viewport?: Viewport }; address_components: GeocodeComponent[] }[];
      }>;
    });
    if (data.status === "OVER_QUERY_LIMIT" || data.status === "REQUEST_DENIED") {
      throw new Error(`Geocoding ${data.status}`);
    }
    const r = data.results?.[0];
    if (!r) return null;
    const { city, state } = cityAndState(r.address_components);
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      city,
      state,
      radiusMeters: radiusFromViewport(r.geometry.bounds ?? r.geometry.viewport),
    };
  }
}

export class GooglePlacesProvider implements DiscoveryProvider {
  async searchCategory(
    query: string,
    center: LatLng,
    radiusMeters: number,
    maxResults = 60,
  ): Promise<DiscoveredBusiness[]> {
    const key = await requireKey();
    const out: DiscoveredBusiness[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 3 && out.length < maxResults; page++) {
      const body: Record<string, unknown> = {
        textQuery: query,
        pageSize: 20,
        locationBias: {
          circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(radiusMeters, 50_000) },
        },
      };
      if (pageToken) body.pageToken = pageToken;
      const data = await withBudget("google", async () => {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        if (res.status === 429) throw new Error("Places rate limited (429)");
        if (!res.ok) throw new Error(`Places HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return res.json() as Promise<{ places?: PlacesApiPlace[]; nextPageToken?: string }>;
      });
      for (const p of data.places ?? []) out.push(mapPlace(p));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out.slice(0, maxResults);
  }
}
```

- [ ] **Step 6: Implement validation, fakes, and the factory**

Create `src/lib/providers/validation.ts`:

```ts
import { promises as dns } from "node:dns";
import { REQUEST_TIMEOUT_MS, USER_AGENT } from "@/lib/extract/website";
import type { ValidationProvider } from "./types";

export class BuiltinValidationProvider implements ValidationProvider {
  async checkWebsite(url: string): Promise<{ reachable: boolean; error?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
      }
      return res.ok ? { reachable: true } : { reachable: false, error: `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error;
      return { reachable: false, error: err?.name === "AbortError" ? "timeout" : err?.message ?? String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  async domainHasMx(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveMx(domain);
      return records.length > 0;
    } catch {
      return false;
    }
  }
}
```

Create `src/lib/providers/fake.ts`:

```ts
import type { PageFetcher } from "@/lib/extract/website";
import type { DiscoveredBusiness, DiscoveryProvider, GeocodeProvider, GeocodeResult, ValidationProvider } from "./types";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export class FakeGeocodeProvider implements GeocodeProvider {
  async geocodeZip(zip: string): Promise<GeocodeResult | null> {
    if (!/^\d{5}$/.test(zip)) return null;
    const n = Number(zip.slice(2));
    return { lat: 29.7 + n / 10_000, lng: -95.5 - n / 10_000, city: "Houston", state: "TX", radiusMeters: 3000 };
  }
}

/** Two SMBs per query plus one chain for coffee-shop queries so exclusion is exercised. */
export class FakeDiscoveryProvider implements DiscoveryProvider {
  async searchCategory(rawQuery: string): Promise<DiscoveredBusiness[]> {
    // The job sends "<category query> in <zip>"; names and ids use the bare category query.
    const query = rawQuery.replace(/\s+in\s+\d{5}$/, "");
    const slug = slugify(query);
    const mk = (i: number, name: string, website: string | null): DiscoveredBusiness => ({
      placeId: `fake-${slug}-${i}`,
      name,
      formattedAddress: `${100 + i} Fake St, Houston, TX 77084, USA`,
      zip: "77084",
      lat: 29.84,
      lng: -95.66,
      phone: `(713) 555-01${String(i).padStart(2, "0")}`,
      websiteUrl: website,
      rating: 4.2,
      reviewCount: 10 + i,
      types: [slug],
    });
    // Every other category gets a dead website on its second business so
    // "unreachable" paths are exercised in tests and demos.
    const deadSite = slug.length % 2 === 0;
    const list = [
      mk(1, `${query} One`, `https://${slug}-one.fake.test/`),
      mk(2, `${query} Two`, deadSite ? `https://dead.${slug}-two.fake.test/` : null),
    ];
    if (slug.startsWith("coffee-shop")) list.push(mk(3, "Starbucks", "https://www.starbucks.com/"));
    return list;
  }
}

export class FakeValidationProvider implements ValidationProvider {
  async checkWebsite(url: string) {
    return url.includes("dead.") ? { reachable: false, error: "timeout" } : { reachable: true };
  }
  async domainHasMx(domain: string) {
    return !domain.includes("nomx");
  }
}

export const fakeFetcher: PageFetcher = async (url) => {
  if (url.includes("dead.")) return { ok: false, error: "timeout" };
  const host = new URL(url).hostname;
  const html = `<html><body>
    <h1>${host}</h1>
    <a href="mailto:info@${host}">Email us</a>
    <a href="tel:+17135550142">Call</a>
    <a href="https://www.facebook.com/${host.split(".")[0]}">Facebook</a>
    <p>Fast internet provided by Spectrum Business.</p>
    <a href="/contact">Contact</a>
  </body></html>`;
  return { ok: true, status: 200, html, finalUrl: url };
};
```

Create `src/lib/providers/index.ts`:

```ts
import { defaultFetcher } from "@/lib/extract/website";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, fakeFetcher } from "./fake";
import { GoogleGeocodeProvider, GooglePlacesProvider } from "./google";
import { BuiltinValidationProvider } from "./validation";
import type { Providers } from "./types";

export function getProviders(): Providers {
  const mode = process.env.PROVIDER_MODE ?? "fake";
  if (mode === "fake") {
    return {
      geocode: new FakeGeocodeProvider(),
      discovery: new FakeDiscoveryProvider(),
      validation: new FakeValidationProvider(),
      fetcher: fakeFetcher,
    };
  }
  return {
    geocode: new GoogleGeocodeProvider(),
    discovery: new GooglePlacesProvider(),
    validation: new BuiltinValidationProvider(),
    fetcher: defaultFetcher,
  };
}

export type { Providers } from "./types";
```

- [ ] **Step 7: Write the DB budget test**

Create `tests/db/budget.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withBudget, BudgetExhaustedError, budgetStatus } from "@/lib/providers/budget";

beforeEach(async () => {
  await prisma.providerConfig.deleteMany();
});

describe("withBudget", () => {
  it("counts calls and throws when the daily budget is hit", async () => {
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 2 } });
    expect(await withBudget("google", async () => "a")).toBe("a");
    expect(await withBudget("google", async () => "b")).toBe("b");
    await expect(withBudget("google", async () => "c")).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(await budgetStatus("google")).toEqual({ used: 2, limit: 2, exhausted: true });
  });

  it("creates the config row with the env default", async () => {
    process.env.GOOGLE_DAILY_BUDGET = "77";
    await withBudget("google", async () => 1);
    const cfg = await prisma.providerConfig.findUnique({ where: { provider: "google" } });
    expect(cfg?.dailyBudget).toBe(77);
    expect(cfg?.usedToday).toBe(1);
  });
});
```

- [ ] **Step 8: Run all tests**

```bash
npm test
npm run test:db
```

Expected: all unit tests pass; DB tests pass (schema + budget).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: provider interfaces, Google geocode/places, validation, budget wrapper, fakes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Zip search job, worker process, and enqueue helper

**Files:**
- Create: `src/lib/jobs/queues.ts`, `src/lib/jobs/zipSearch.ts`, `src/lib/jobs/boss.ts`, `src/lib/jobs/enqueue.ts`, `src/worker/index.ts`, `tests/unit/jobs/normalizeName.test.ts`, `tests/db/zipSearch.test.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getProviders()`, `Providers`, `DiscoveredBusiness` (Task 8); `extractWebsiteContacts` (Task 7); `scoreSmbFit`, `scoreContactQuality`, `suggestPackage` (Task 6); `CATEGORIES` (Task 5); `prisma` (Task 2).
- Produces:
  - `QUEUES = { zipSearch: "zip-search" }`, `type ZipSearchJobData = { searchId: string }`
  - `runZipSearch(searchId: string, deps: ZipSearchDeps): Promise<void>` with `ZipSearchDeps = { providers: Providers; shouldPause?: () => Promise<boolean>; log?: (msg: string) => void }`
  - `class JobPausedError extends Error`
  - `normalizeName(name: string): string`
  - `recomputeContactQuality(businessId: string): Promise<void>` (reused by later tasks after contact edits)
  - `enqueueZipSearch(searchId: string, opts?: { priority?: number }): Promise<void>` (honors `JOB_MODE=inline`)
  - `getBoss(): Promise<PgBoss>`

- [ ] **Step 1: Write the failing unit test for name normalization**

Create `tests/unit/jobs/normalizeName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/jobs/zipSearch";

describe("normalizeName", () => {
  it("lowercases, strips punctuation and suffix noise", () => {
    expect(normalizeName("Bella Nails & Spa, LLC")).toBe("bella nails spa");
    expect(normalizeName("  Starbucks  ")).toBe("starbucks");
    expect(normalizeName("Joe's Auto-Repair Inc.")).toBe("joes auto repair");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm test -- tests/unit/jobs
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement queues, the job, and the boss singleton**

Create `src/lib/jobs/queues.ts`:

```ts
export const QUEUES = {
  zipSearch: "zip-search",
} as const;

export type ZipSearchJobData = { searchId: string };
```

Create `src/lib/jobs/zipSearch.ts`:

```ts
import pLimit from "p-limit";
import { prisma } from "@/lib/db";
import { CATEGORIES } from "@/lib/config/categories";
import { scoreSmbFit } from "@/lib/scoring/smbFit";
import { scoreContactQuality } from "@/lib/scoring/contactQuality";
import { suggestPackage } from "@/lib/scoring/packageMap";
import { extractWebsiteContacts } from "@/lib/extract/website";
import { normalizePhone } from "@/lib/extract/normalize";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";

export type ZipSearchDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  log?: (msg: string) => void;
};

export class JobPausedError extends Error {
  constructor() {
    super("paused");
    this.name = "JobPausedError";
  }
}

const SCRAPE_CONCURRENCY = 4;
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

type Progress = { step: string; current?: number; total?: number; message?: string; doneSteps: string[] };

async function setProgress(searchId: string, p: Progress) {
  await prisma.search.update({ where: { id: searchId }, data: { progress: p } });
}

async function checkPause(deps: ZipSearchDeps) {
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

export async function recomputeContactQuality(businessId: string) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, include: { contacts: true } });
  if (!b) return;
  const q = scoreContactQuality({ websiteReachable: b.websiteReachable, phone: b.phone, contacts: b.contacts });
  await prisma.business.update({
    where: { id: businessId },
    data: { contactQualityScore: q.score, contactQualityBand: q.band, contactQualityReasons: q.reasons },
  });
}

type Found = { biz: DiscoveredBusiness; category: string };

async function discover(searchId: string, zip: string, center: { lat: number; lng: number }, radius: number, deps: ZipSearchDeps, done: string[]) {
  const found = new Map<string, Found>();
  for (let i = 0; i < CATEGORIES.length; i++) {
    await checkPause(deps);
    const c = CATEGORIES[i];
    await setProgress(searchId, { step: "discover", current: i + 1, total: CATEGORIES.length, message: c.label, doneSteps: done });
    const results = await deps.providers.discovery.searchCategory(`${c.query} in ${zip}`, center, radius);
    for (const biz of results) {
      if (!biz.placeId || !biz.name) continue;
      if (!found.has(biz.placeId)) found.set(biz.placeId, { biz, category: c.slug });
    }
  }
  return found;
}

async function upsertBusinesses(searchId: string, ownerId: string, found: Map<string, Found>) {
  const nameCounts = new Map<string, number>();
  for (const { biz } of found.values()) {
    const n = normalizeName(biz.name);
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  const ids: string[] = [];
  for (const { biz, category } of found.values()) {
    const fit = scoreSmbFit({ name: biz.name, sameNameCount: nameCounts.get(normalizeName(biz.name)) });
    const googleFields = {
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
      exclusion: fit.excluded ? ("enterprise" as const) : ("none" as const),
      exclusionReasons: fit.exclusionReasons,
      smbFitScore: fit.score,
    };
    const existing = await prisma.business.findUnique({ where: { googlePlaceId: biz.placeId } });
    const b = existing
      ? await prisma.business.update({
          where: { id: existing.id },
          data: { ...googleFields, primaryCategory: existing.primaryCategory ?? category, suggestedPackage: existing.suggestedPackage ?? suggestPackage(category) },
        })
      : await prisma.business.create({
          data: {
            ...googleFields,
            ownerId,
            googlePlaceId: biz.placeId,
            source: "zip_search",
            primaryCategory: category,
            suggestedPackage: suggestPackage(category),
            activity: { create: { ownerId, kind: "discovered", message: `Found via zip search as "${category}"` } },
          },
        });
    ids.push(b.id);

    await prisma.searchBusiness.upsert({
      where: { searchId_businessId: { searchId, businessId: b.id } },
      update: {},
      create: { searchId, businessId: b.id, surfacedByCategory: category },
    });
    const phone = biz.phone ? normalizePhone(biz.phone) : null;
    if (phone) {
      await prisma.contact.upsert({
        where: { businessId_type_value: { businessId: b.id, type: "phone", value: phone } },
        update: {},
        create: { ownerId, businessId: b.id, type: "phone", value: phone, source: "google", validationStatus: "valid", validatedAt: new Date() },
      });
    }
    const systemTag = await prisma.tag.findUnique({ where: { ownerId_name: { ownerId, name: category } } });
    if (systemTag) {
      await prisma.businessTag.upsert({
        where: { businessId_tagId: { businessId: b.id, tagId: systemTag.id } },
        update: {},
        create: { businessId: b.id, tagId: systemTag.id },
      });
    }
  }
  return ids;
}

async function scrapeOne(businessId: string, ownerId: string, deps: ZipSearchDeps) {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b?.websiteUrl) return;
  const r = await extractWebsiteContacts(b.websiteUrl, deps.providers.fetcher);
  await prisma.business.update({
    where: { id: businessId },
    data: {
      websiteReachable: r.reachable,
      websiteError: r.error ?? null,
      websiteCheckedAt: new Date(),
      currentProviderHint: r.providerHint?.provider ?? b.currentProviderHint,
      currentProviderEvidence: r.providerHint?.evidence ?? b.currentProviderEvidence,
    },
  });
  const rows = [
    ...r.emails.map((v) => ({ type: "email" as const, value: v })),
    ...r.phones.map((v) => ({ type: "phone" as const, value: v })),
    ...r.socials.map((s) => ({ type: s.type, value: s.url })),
  ];
  for (const row of rows) {
    await prisma.contact.upsert({
      where: { businessId_type_value: { businessId, type: row.type, value: row.value } },
      update: {},
      create: { ownerId, businessId, type: row.type, value: row.value, source: "website" },
    });
  }
  await prisma.activityLog.create({
    data: {
      ownerId,
      businessId,
      kind: "scraped",
      message: r.reachable
        ? `Scraped ${r.pagesFetched.length} page(s): ${r.emails.length} email(s), ${r.phones.length} phone(s), ${r.socials.length} social link(s)`
        : `Website unreachable: ${r.error}`,
    },
  });
}

async function validateEmails(businessIds: string[], deps: ZipSearchDeps) {
  const contacts = await prisma.contact.findMany({
    where: { businessId: { in: businessIds }, type: "email", validationStatus: "unchecked" },
  });
  const cache = new Map<string, boolean>();
  for (const c of contacts) {
    const domain = c.value.split("@")[1];
    let ok = cache.get(domain);
    if (ok === undefined) {
      ok = await deps.providers.validation.domainHasMx(domain);
      cache.set(domain, ok);
    }
    await prisma.contact.update({
      where: { id: c.id },
      data: { validationStatus: ok ? "valid" : "invalid", validatedAt: new Date() },
    });
  }
}

export async function runZipSearch(searchId: string, deps: ZipSearchDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  const search = await prisma.search.findUnique({ where: { id: searchId } });
  if (!search) return;
  const ownerId = search.ownerId;
  const prior = (search.progress as Progress | null)?.doneSteps ?? [];
  const done = [...prior];

  try {
    await prisma.search.update({ where: { id: searchId }, data: { status: "running", error: null } });

    // 1. geocode
    let center = search.lat != null && search.lng != null ? { lat: search.lat, lng: search.lng } : null;
    let radius = search.radiusMeters ?? 3000;
    if (!center) {
      await setProgress(searchId, { step: "geocode", message: `Locating ${search.zip}`, doneSteps: done });
      const geo = await deps.providers.geocode.geocodeZip(search.zip);
      if (!geo) throw new Error(`Zip ${search.zip} could not be located`);
      center = { lat: geo.lat, lng: geo.lng };
      radius = geo.radiusMeters;
      await prisma.search.update({
        where: { id: searchId },
        data: { lat: geo.lat, lng: geo.lng, city: geo.city, state: geo.state, radiusMeters: geo.radiusMeters },
      });
    }

    // 2 to 4. discover + exclusion + upsert (skipped on resume)
    let businessIds: string[];
    if (!done.includes("discover")) {
      const found = await discover(searchId, search.zip, center, radius, deps, done);
      await setProgress(searchId, { step: "save", current: 0, total: found.size, doneSteps: done });
      businessIds = await upsertBusinesses(searchId, ownerId, found);
      done.push("discover");
      await prisma.search.update({ where: { id: searchId }, data: { countsFound: businessIds.length } });
      log(`search ${searchId}: ${businessIds.length} businesses`);
    } else {
      const links = await prisma.searchBusiness.findMany({ where: { searchId }, select: { businessId: true } });
      businessIds = links.map((l) => l.businessId);
    }

    // 5. contact extraction (concurrency 4). Businesses scraped since this search started are skipped on resume.
    const toScrape = await prisma.business.findMany({
      where: {
        id: { in: businessIds },
        websiteUrl: { not: null },
        exclusion: "none",
        OR: [{ websiteCheckedAt: null }, { websiteCheckedAt: { lt: search.createdAt } }],
      },
      select: { id: true },
    });
    let scraped = 0;
    const limit = pLimit(SCRAPE_CONCURRENCY);
    await setProgress(searchId, { step: "scrape", current: 0, total: toScrape.length, doneSteps: done });
    await Promise.all(
      toScrape.map((b) =>
        limit(async () => {
          await checkPause(deps);
          try {
            await scrapeOne(b.id, ownerId, deps);
          } catch (e) {
            await prisma.business.update({
              where: { id: b.id },
              data: { websiteReachable: false, websiteError: (e as Error).message, websiteCheckedAt: new Date() },
            });
          }
          scraped++;
          await prisma.search.update({
            where: { id: searchId },
            data: { countsScraped: scraped, progress: { step: "scrape", current: scraped, total: toScrape.length, doneSteps: done } },
          });
        }),
      ),
    );

    // 6. MX validation
    await checkPause(deps);
    await setProgress(searchId, { step: "validate", doneSteps: done });
    await validateEmails(businessIds, deps);

    // 7. quality
    await setProgress(searchId, { step: "score", doneSteps: done });
    for (const id of businessIds) await recomputeContactQuality(id);

    await prisma.search.update({
      where: { id: searchId },
      data: { status: "complete", progress: { step: "complete", doneSteps: [...done, "scrape", "validate", "score"] } },
    });
    log(`search ${searchId}: complete`);
  } catch (e) {
    if (e instanceof JobPausedError) {
      await prisma.search.update({ where: { id: searchId }, data: { status: "paused", progress: { step: "paused", message: "Paused by user", doneSteps: done } } });
      return;
    }
    if (e instanceof BudgetExhaustedError) {
      await prisma.search.update({ where: { id: searchId }, data: { status: "paused", error: e.message, progress: { step: "paused", message: e.message, doneSteps: done } } });
      return;
    }
    const message = (e as Error).message ?? String(e);
    await prisma.search.update({ where: { id: searchId }, data: { status: "failed", error: message, progress: { step: "failed", message, doneSteps: done } } });
    throw e;
  }
}
```

Create `src/lib/jobs/boss.ts`:

```ts
import PgBoss from "pg-boss";
import { QUEUES } from "./queues";

let bossPromise: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      for (const q of Object.values(QUEUES)) await boss.createQueue(q);
      return boss;
    })();
  }
  return bossPromise;
}
```

Create `src/lib/jobs/enqueue.ts`:

```ts
import { getBoss } from "./boss";
import { QUEUES, type ZipSearchJobData } from "./queues";
import { runZipSearch } from "./zipSearch";
import { getProviders } from "@/lib/providers";

export const MANUAL_PRIORITY = 10;
export const SCANNER_PRIORITY = 1;

/**
 * JOB_MODE=queue (default): hand the job to the pg-boss worker.
 * JOB_MODE=inline: run it inside this process (e2e tests and single-process demos).
 */
export async function enqueueZipSearch(searchId: string, opts: { priority?: number } = {}): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runZipSearch(searchId, { providers: getProviders(), log: console.log }).catch((e) =>
      console.error("[inline zip-search]", e),
    );
    return;
  }
  const boss = await getBoss();
  const data: ZipSearchJobData = { searchId };
  await boss.send(QUEUES.zipSearch, data, {
    retryLimit: 3,
    retryDelay: 60,
    priority: opts.priority ?? MANUAL_PRIORITY,
    singletonKey: searchId,
  });
}
```

Create `src/worker/index.ts`:

```ts
import PgBoss from "pg-boss";
import { QUEUES, type ZipSearchJobData } from "@/lib/jobs/queues";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { getProviders } from "@/lib/providers";

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);

  await boss.work<ZipSearchJobData>(QUEUES.zipSearch, { batchSize: 1 }, async ([job]) => {
    console.log(`[zip-search] start ${job.data.searchId}`);
    await runZipSearch(job.data.searchId, { providers: getProviders(), log: console.log });
    console.log(`[zip-search] done ${job.data.searchId}`);
  });

  console.log(`worker ready (PROVIDER_MODE=${process.env.PROVIDER_MODE ?? "fake"})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Edit `next.config.ts` so pg-boss and pg stay external to the Next bundle:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg-boss", "pg", "@prisma/client"],
};

export default nextConfig;
```

Confirm `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }` (create-next-app sets it). tsx resolves these paths for the worker.

- [ ] **Step 4: Run the unit test**

```bash
npm test -- tests/unit/jobs
```

Expected: PASS.

- [ ] **Step 5: Write the DB integration test for the job**

Create `tests/db/zipSearch.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  fetcher: fakeFetcher,
};

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.tag.createMany({
    data: CATEGORIES.map((c) => ({ ownerId: "local-user", name: c.slug, isSystem: true })),
  });
});

describe("runZipSearch", () => {
  it("discovers, excludes chains, scrapes, validates, and scores", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(search.id, { providers });

    const done = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(done.status).toBe("complete");
    expect(done.city).toBe("Houston");
    expect(done.countsFound).toBe(CATEGORIES.length * 2 + 1);

    const starbucks = await prisma.business.findFirstOrThrow({ where: { name: "Starbucks" } });
    expect(starbucks.exclusion).toBe("enterprise");
    expect(starbucks.exclusionReasons[0]).toMatch(/^chain:/);

    const one = await prisma.business.findFirstOrThrow({
      where: { name: "restaurant One" },
      include: { contacts: true, tags: { include: { tag: true } } },
    });
    expect(one.primaryCategory).toBe("restaurant");
    expect(one.suggestedPackage).toBe("internet_tv_voice");
    expect(one.websiteReachable).toBe(true);
    expect(one.currentProviderHint).toBe("spectrum");
    expect(one.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")).toBe(true);
    expect(one.contacts.some((c) => c.type === "phone" && c.source === "google")).toBe(true);
    expect(one.contacts.some((c) => c.type === "facebook")).toBe(true);
    expect(one.contactQualityBand).toBe("green");
    expect(one.tags.map((t) => t.tag.name)).toContain("restaurant");

    const dead = await prisma.business.findFirst({ where: { websiteUrl: { contains: "dead." } } });
    expect(dead?.websiteReachable).toBe(false);
    expect(dead?.websiteError).toBe("timeout");
  });

  it("keeps outreach fields when the same business is found again", async () => {
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s1.id, { providers });
    const biz = await prisma.business.findFirstOrThrow({ where: { name: "restaurant One" } });
    await prisma.business.update({ where: { id: biz.id }, data: { outreachStatus: "contacted", notes: "left voicemail" } });

    const s2 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s2.id, { providers });
    const again = await prisma.business.findUniqueOrThrow({ where: { id: biz.id }, include: { searches: true } });
    expect(again.outreachStatus).toBe("contacted");
    expect(again.notes).toBe("left voicemail");
    expect(again.searches.map((s) => s.searchId).sort()).toEqual([s1.id, s2.id].sort());
    expect(await prisma.business.count({ where: { name: "restaurant One" } })).toBe(1);
  });

  it("pauses when shouldPause returns true and marks the search paused", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    let calls = 0;
    await runZipSearch(search.id, { providers, shouldPause: async () => ++calls > 3 });
    const s = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(s.status).toBe("paused");
    expect((s.progress as { step: string }).step).toBe("paused");
  });

  it("fails with a message when the zip cannot be geocoded", async () => {
    const search = await prisma.search.create({ data: { zip: "abcde" } });
    await expect(runZipSearch(search.id, { providers })).rejects.toThrow(/could not be located/);
    const s = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(s.status).toBe("failed");
    expect(s.error).toMatch(/could not be located/);
  });
});
```

- [ ] **Step 6: Run the DB tests**

```bash
npm run test:db
```

Expected: all pass. The first test takes a few seconds (34 categories, ~35 fake scrapes).

- [ ] **Step 7: Smoke the worker against the real queue**

In one terminal:

```bash
npm run worker
```

Expected: `worker ready (PROVIDER_MODE=fake)`. Stop it with Ctrl+C. (Sending a job through the API happens in Task 10.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: zip search job pipeline, pg-boss worker, enqueue with inline mode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: API routes — searches, businesses, tags, bulk, CSV export

**Files:**
- Create: `src/lib/api.ts`, `src/lib/leads/filters.ts`, `src/lib/leads/csv.ts`, `src/lib/leads/queries.ts`, `src/app/api/searches/route.ts`, `src/app/api/searches/[id]/route.ts`, `src/app/api/searches/[id]/rerun/route.ts`, `src/app/api/businesses/route.ts`, `src/app/api/businesses/[id]/route.ts`, `src/app/api/businesses/bulk/route.ts`, `src/app/api/tags/route.ts`, `src/app/api/export/route.ts`, `tests/unit/leads/filters.test.ts`, `tests/unit/leads/csv.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getActor`, `enqueueZipSearch`, `recomputeContactQuality`, `PRODUCT_SLUGS`.
- Produces:
  - `parseLeadFilters(sp: URLSearchParams): LeadFilters`; `buildBusinessWhere(f: LeadFilters, ownerId: string): Prisma.BusinessWhereInput`; `buildBusinessOrderBy(f: LeadFilters): Prisma.BusinessOrderByWithRelationInput[]`
  - `LeadFilters = { q?: string; category?: string; zip?: string; source?: "zip_search"|"tdlr"|"manual"; quality?: "green"|"yellow"|"red"; status?: OutreachStatus; tag?: string; product?: string; searchId?: string; showExcluded: boolean; page: number; pageSize: number; sort: "quality"|"name"|"updated" }`
  - `listBusinesses(f: LeadFilters, ownerId: string): Promise<{ items: LeadRow[]; total: number }>` where `LeadRow` is the Prisma `Business` with `contacts` and `tags: { tag }[]` included
  - `businessesToCsv(rows: LeadRow[]): string`
  - `json(data, status?)`, `ApiError`, `parseJson(req, schema)`, `handle(fn)`
  - HTTP API:
    - `GET /api/searches` → `{ items: Search[] }`; `POST /api/searches { zip }` → `201 { search }`
    - `GET /api/searches/:id` → `{ search }`; `POST /api/searches/:id/rerun` → `201 { search }`
    - `GET /api/businesses?<filters>` → `{ items, total, page, pageSize, runningSearches }`
    - `GET /api/businesses/:id` → `{ business }` (contacts, tags, activity, projects); `PATCH /api/businesses/:id { outreachStatus?, productsPitched?, notes?, tagIds? }` → `{ business }`
    - `POST /api/businesses/bulk { ids, outreachStatus?, addTagId? }` → `{ updated: number }`
    - `GET /api/tags` → `{ items: Tag[] }`; `POST /api/tags { name, color? }` → `201 { tag }`
    - `GET /api/export?<filters>` → `text/csv` attachment

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/leads/filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLeadFilters, buildBusinessWhere, buildBusinessOrderBy } from "@/lib/leads/filters";

describe("parseLeadFilters", () => {
  it("applies defaults", () => {
    const f = parseLeadFilters(new URLSearchParams(""));
    expect(f).toMatchObject({ showExcluded: false, page: 1, pageSize: 50, sort: "quality" });
  });
  it("parses values and rejects bad enums", () => {
    const f = parseLeadFilters(new URLSearchParams("q=nails&quality=green&status=contacted&showExcluded=true&page=2"));
    expect(f).toMatchObject({ q: "nails", quality: "green", status: "contacted", showExcluded: true, page: 2 });
    expect(() => parseLeadFilters(new URLSearchParams("quality=purple"))).toThrow();
  });
});

describe("buildBusinessWhere", () => {
  it("hides excluded by default and scopes to owner", () => {
    const w = buildBusinessWhere(parseLeadFilters(new URLSearchParams("")), "u1");
    expect(w).toEqual({ ownerId: "u1", exclusion: "none" });
  });
  it("adds each filter", () => {
    const w = buildBusinessWhere(
      parseLeadFilters(new URLSearchParams("q=bella&category=nail_salon&zip=77084&source=zip_search&quality=green&status=contacted&tag=hot&product=mobile&searchId=s1&showExcluded=true")),
      "u1",
    );
    expect(w).toEqual({
      ownerId: "u1",
      name: { contains: "bella", mode: "insensitive" },
      primaryCategory: "nail_salon",
      zip: "77084",
      source: "zip_search",
      contactQualityBand: "green",
      outreachStatus: "contacted",
      tags: { some: { tag: { name: "hot" } } },
      productsPitched: { has: "mobile" },
      searches: { some: { searchId: "s1" } },
    });
  });
});

describe("buildBusinessOrderBy", () => {
  it("sorts by quality then name by default", () => {
    expect(buildBusinessOrderBy(parseLeadFilters(new URLSearchParams("")))).toEqual([
      { contactQualityScore: "desc" },
      { name: "asc" },
    ]);
    expect(buildBusinessOrderBy(parseLeadFilters(new URLSearchParams("sort=updated")))).toEqual([{ updatedAt: "desc" }]);
  });
});
```

Create `tests/unit/leads/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { businessesToCsv } from "@/lib/leads/csv";

describe("businessesToCsv", () => {
  it("writes a header and escapes quotes, commas, and newlines", () => {
    const csv = businessesToCsv([
      {
        name: 'Bella "B" Nails, LLC',
        primaryCategory: "nail_salon",
        zip: "77084",
        formattedAddress: "1 Main St, Houston, TX",
        phone: "(713) 555-0100",
        websiteUrl: "https://bellanails.com/",
        contactQualityBand: "green",
        contactQualityScore: 75,
        outreachStatus: "contacted",
        suggestedPackage: "internet_mobile",
        currentProviderHint: "att",
        notes: "line1\nline2",
        productsPitched: ["mobile"],
        contacts: [
          { type: "email", value: "hello@bellanails.com", validationStatus: "valid", personName: null, personTitle: null },
          { type: "facebook", value: "https://www.facebook.com/bella", validationStatus: "unchecked", personName: null, personTitle: null },
        ],
        tags: [{ tag: { name: "hot" } }],
      } as never,
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "name,category,zip,address,phone,website,emails,socials,quality_band,quality_score,outreach_status,suggested_package,current_provider,products_pitched,tags,notes",
    );
    expect(lines[1]).toBe(
      '"Bella ""B"" Nails, LLC",nail_salon,77084,"1 Main St, Houston, TX",(713) 555-0100,https://bellanails.com/,hello@bellanails.com,https://www.facebook.com/bella,green,75,contacted,internet_mobile,att,mobile,hot,"line1\nline2"',
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm test -- tests/unit/leads
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Implement api helpers, filters, csv, queries**

Create `src/lib/api.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  return schema.parse(body);
}

// Next 15 passes `{ params: Promise<{ id: string }> }` for dynamic segments. If `next build`
// reports an invalid route export type, change this to `Promise<any>`; the handlers only read strings.
type Ctx = { params: Promise<Record<string, string>> };

export function handle(fn: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError) return json({ error: "Validation failed", issues: e.issues }, 400);
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, e);
      return json({ error: "Internal error" }, 500);
    }
  };
}
```

Create `src/lib/leads/filters.ts`:

```ts
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

export const leadFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: z.string().optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  source: z.enum(["zip_search", "tdlr", "manual"]).optional(),
  quality: z.enum(["green", "yellow", "red"]).optional(),
  status: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  tag: z.string().optional(),
  product: z.string().optional(),
  searchId: z.string().optional(),
  showExcluded: bool,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["quality", "name", "updated"]).default("quality"),
});

export type LeadFilters = z.infer<typeof leadFiltersSchema>;

export function parseLeadFilters(sp: URLSearchParams): LeadFilters {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  return leadFiltersSchema.parse(raw);
}

export function buildBusinessWhere(f: LeadFilters, ownerId: string): Prisma.BusinessWhereInput {
  const where: Prisma.BusinessWhereInput = { ownerId };
  if (!f.showExcluded) where.exclusion = "none";
  if (f.q) where.name = { contains: f.q, mode: "insensitive" };
  if (f.category) where.primaryCategory = f.category;
  if (f.zip) where.zip = f.zip;
  if (f.source) where.source = f.source;
  if (f.quality) where.contactQualityBand = f.quality;
  if (f.status) where.outreachStatus = f.status;
  if (f.tag) where.tags = { some: { tag: { name: f.tag } } };
  if (f.product) where.productsPitched = { has: f.product };
  if (f.searchId) where.searches = { some: { searchId: f.searchId } };
  return where;
}

export function buildBusinessOrderBy(f: LeadFilters): Prisma.BusinessOrderByWithRelationInput[] {
  switch (f.sort) {
    case "name":
      return [{ name: "asc" }];
    case "updated":
      return [{ updatedAt: "desc" }];
    default:
      return [{ contactQualityScore: "desc" }, { name: "asc" }];
  }
}
```

Create `src/lib/leads/queries.ts`:

```ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildBusinessOrderBy, buildBusinessWhere, type LeadFilters } from "./filters";

export const leadInclude = {
  contacts: {
    select: { id: true, type: true, value: true, personName: true, personTitle: true, validationStatus: true, source: true },
    orderBy: { type: "asc" as const },
  },
  tags: { include: { tag: true } },
} satisfies Prisma.BusinessInclude;

export type LeadRow = Prisma.BusinessGetPayload<{ include: typeof leadInclude }>;

export async function listBusinesses(f: LeadFilters, ownerId: string) {
  const where = buildBusinessWhere(f, ownerId);
  const [items, total] = await Promise.all([
    prisma.business.findMany({
      where,
      include: leadInclude,
      orderBy: buildBusinessOrderBy(f),
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.business.count({ where }),
  ]);
  return { items, total };
}

export async function getBusinessDetail(id: string, ownerId: string) {
  return prisma.business.findFirst({
    where: { id, ownerId },
    include: {
      ...leadInclude,
      activity: { orderBy: { createdAt: "desc" }, take: 50 },
      projects: true,
    },
  });
}
```

Create `src/lib/leads/csv.ts`:

```ts
import type { LeadRow } from "./queries";

const HEADER = [
  "name", "category", "zip", "address", "phone", "website", "emails", "socials",
  "quality_band", "quality_score", "outreach_status", "suggested_package", "current_provider",
  "products_pitched", "tags", "notes",
];

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function businessesToCsv(rows: LeadRow[]): string {
  const lines = [HEADER.join(",")];
  for (const b of rows) {
    const emails = b.contacts.filter((c) => c.type === "email").map((c) => c.value).join("; ");
    const socials = b.contacts
      .filter((c) => ["linkedin", "facebook", "instagram", "twitter", "yelp"].includes(c.type))
      .map((c) => c.value)
      .join("; ");
    lines.push(
      [
        b.name, b.primaryCategory, b.zip, b.formattedAddress, b.phone, b.websiteUrl, emails, socials,
        b.contactQualityBand, b.contactQualityScore, b.outreachStatus, b.suggestedPackage, b.currentProviderHint,
        b.productsPitched.join("; "), b.tags.map((t) => t.tag.name).join("; "), b.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
```

- [ ] **Step 4: Run the unit tests**

```bash
npm test -- tests/unit/leads
```

Expected: PASS.

- [ ] **Step 5: Implement the route handlers**

Create `src/app/api/searches/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";
import { enqueueZipSearch } from "@/lib/jobs/enqueue";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return json({ items });
});

const createSchema = z.object({ zip: z.string().regex(/^\d{5}$/, "Enter a 5-digit zip code") });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const { zip } = await parseJson(req, createSchema);
  const search = await prisma.search.create({ data: { ownerId: actor.id, zip } });
  await enqueueZipSearch(search.id);
  return json({ search }, 201);
});
```

Create `src/app/api/searches/[id]/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const search = await prisma.search.findFirst({ where: { id, ownerId: actor.id } });
  if (!search) throw new ApiError(404, "Search not found");
  return json({ search });
});
```

Create `src/app/api/searches/[id]/rerun/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { enqueueZipSearch } from "@/lib/jobs/enqueue";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const prior = await prisma.search.findFirst({ where: { id, ownerId: actor.id } });
  if (!prior) throw new ApiError(404, "Search not found");
  const search = await prisma.search.create({ data: { ownerId: actor.id, zip: prior.zip } });
  await enqueueZipSearch(search.id);
  return json({ search }, 201);
});
```

Create `src/app/api/businesses/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listBusinesses } from "@/lib/leads/queries";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = parseLeadFilters(req.nextUrl.searchParams);
  const [{ items, total }, runningSearches] = await Promise.all([
    listBusinesses(f, actor.id),
    prisma.search.count({ where: { ownerId: actor.id, status: { in: ["queued", "running"] } } }),
  ]);
  return json({ items, total, page: f.page, pageSize: f.pageSize, runningSearches });
});
```

Create `src/app/api/businesses/[id]/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { getBusinessDetail } from "@/lib/leads/queries";
import { PRODUCT_SLUGS } from "@/lib/config/packages";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const business = await getBusinessDetail(id, actor.id);
  if (!business) throw new ApiError(404, "Business not found");
  return json({ business });
});

const patchSchema = z.object({
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  productsPitched: z.array(z.enum(PRODUCT_SLUGS as [string, ...string[]])).optional(),
  notes: z.string().max(20_000).optional(),
  tagIds: z.array(z.string()).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const existing = await prisma.business.findFirst({ where: { id, ownerId: actor.id } });
  if (!existing) throw new ApiError(404, "Business not found");
  const body = await parseJson(req, patchSchema);

  await prisma.$transaction(async (tx) => {
    await tx.business.update({
      where: { id },
      data: {
        ...(body.outreachStatus !== undefined && { outreachStatus: body.outreachStatus }),
        ...(body.productsPitched !== undefined && { productsPitched: body.productsPitched }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
    });
    if (body.tagIds) {
      await tx.businessTag.deleteMany({ where: { businessId: id } });
      await tx.businessTag.createMany({ data: body.tagIds.map((tagId) => ({ businessId: id, tagId })), skipDuplicates: true });
    }
    if (body.outreachStatus && body.outreachStatus !== existing.outreachStatus) {
      await tx.activityLog.create({
        data: { ownerId: actor.id, businessId: id, kind: "status_changed", message: `Status set to ${body.outreachStatus}` },
      });
    }
  });

  const business = await getBusinessDetail(id, actor.id);
  return json({ business });
});
```

Create `src/app/api/businesses/bulk/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  outreachStatus: z.enum(["not_contacted", "contacted", "interested", "not_a_fit", "customer"]).optional(),
  addTagId: z.string().optional(),
});

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, schema);
  const owned = await prisma.business.findMany({ where: { id: { in: body.ids }, ownerId: actor.id }, select: { id: true } });
  const ids = owned.map((b) => b.id);

  if (body.outreachStatus) {
    await prisma.business.updateMany({ where: { id: { in: ids } }, data: { outreachStatus: body.outreachStatus } });
    await prisma.activityLog.createMany({
      data: ids.map((businessId) => ({ ownerId: actor.id, businessId, kind: "status_changed", message: `Status set to ${body.outreachStatus} (bulk)` })),
    });
  }
  if (body.addTagId) {
    await prisma.businessTag.createMany({ data: ids.map((businessId) => ({ businessId, tagId: body.addTagId! })), skipDuplicates: true });
  }
  return json({ updated: ids.length });
});
```

Create `src/app/api/tags/route.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { handle, json, parseJson } from "@/lib/api";

export const GET = handle(async () => {
  const actor = await getActor();
  const items = await prisma.tag.findMany({ where: { ownerId: actor.id }, orderBy: [{ isSystem: "asc" }, { name: "asc" }] });
  return json({ items });
});

const schema = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });

export const POST = handle(async (req) => {
  const actor = await getActor();
  const body = await parseJson(req, schema);
  const tag = await prisma.tag.upsert({
    where: { ownerId_name: { ownerId: actor.id, name: body.name } },
    update: { ...(body.color && { color: body.color }) },
    create: { ownerId: actor.id, name: body.name, color: body.color ?? "#64748b" },
  });
  return json({ tag }, 201);
});
```

Create `src/app/api/export/route.ts`:

```ts
import { getActor } from "@/lib/actor";
import { handle } from "@/lib/api";
import { parseLeadFilters } from "@/lib/leads/filters";
import { listBusinesses } from "@/lib/leads/queries";
import { businessesToCsv } from "@/lib/leads/csv";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = { ...parseLeadFilters(req.nextUrl.searchParams), page: 1, pageSize: 200 };
  const rows: Awaited<ReturnType<typeof listBusinesses>>["items"] = [];
  for (;;) {
    const { items, total } = await listBusinesses(f, actor.id);
    rows.push(...items);
    if (rows.length >= total || items.length === 0) break;
    f.page++;
  }
  const csv = businessesToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="leads-${stamp}.csv"`,
    },
  });
});
```

- [ ] **Step 6: Verify end to end with curl**

Terminal 1: `npm run worker`. Terminal 2: `npm run dev`. Terminal 3 (get a cookie first by unlocking in the browser and copying the `sdr_session` cookie value, or use the curl below):

```bash
curl -s -c cookies.txt -X POST -d "passphrase=change-me&next=/" http://localhost:3000/api/unlock -o /dev/null
curl -s -b cookies.txt -X POST -H "content-type: application/json" -d '{"zip":"77084"}' http://localhost:3000/api/searches
```

Expected: `201` with `{"search":{"id":"...","status":"queued",...}}`; the worker terminal logs `[zip-search] start` then `done` within a few seconds (fake mode).

```bash
curl -s -b cookies.txt "http://localhost:3000/api/businesses?quality=green&pageSize=2"
curl -s -b cookies.txt "http://localhost:3000/api/export?category=restaurant" | head -3
```

Expected: JSON with `total` around 68 non-excluded businesses; CSV header line followed by rows. Delete `cookies.txt` afterwards.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: searches, businesses, tags, bulk, and CSV export API routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Dashboard page with zip search form and stat tiles

**Files:**
- Create: `src/lib/leads/stats.ts`, `src/lib/format.ts`, `src/components/dashboard/StatTile.tsx`, `src/components/searches/ZipSearchForm.tsx`, `src/components/searches/SearchStatusBadge.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `prisma`, `getActor`, `POST /api/searches`.
- Produces: `getDashboardStats(ownerId): Promise<{ totalLeads: number; greenLeads: number; projectsOpeningSoon: number; contactedThisWeek: number }>`; `<ZipSearchForm />`; `<SearchStatusBadge status />`; `<StatTile label value hint? />`; `formatDate(d)`, `timeAgo(d)`.

- [ ] **Step 1: Write stats and formatting helpers**

Create `src/lib/leads/stats.ts`:

```ts
import { prisma } from "@/lib/db";

export async function getDashboardStats(ownerId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [totalLeads, greenLeads, projectsOpeningSoon, contactedRows] = await Promise.all([
    prisma.business.count({ where: { ownerId, exclusion: "none" } }),
    prisma.business.count({ where: { ownerId, exclusion: "none", contactQualityBand: "green" } }),
    prisma.project.count({ where: { ownerId, exclusion: "none", timingWindow: "opening_soon" } }),
    prisma.activityLog.findMany({
      where: { ownerId, kind: "status_changed", createdAt: { gte: weekAgo }, message: { contains: "contacted" } },
      select: { businessId: true },
      distinct: ["businessId"],
    }),
  ]);
  return { totalLeads, greenLeads, projectsOpeningSoon, contactedThisWeek: contactedRows.length };
}
```

Create `src/lib/format.ts`:

```ts
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(d: Date | string): string {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function titleCase(slug: string | null | undefined): string {
  return (slug ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 2: Write the components**

Create `src/components/dashboard/StatTile.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card";

export function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
      </CardContent>
    </Card>
  );
}
```

Create `src/components/searches/SearchStatusBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  queued: "bg-neutral-200 text-neutral-800",
  running: "bg-blue-100 text-blue-800",
  paused: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function SearchStatusBadge({ status }: { status: string }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0 capitalize`}>{status}</Badge>;
}
```

Create `src/components/searches/ZipSearchForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ZipSearchForm() {
  const router = useRouter();
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      toast.error("Enter a 5-digit zip code");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zip }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to start search");
      toast.success(`Search started for ${zip}`);
      setZip("");
      router.push("/searches");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md gap-2" data-testid="zip-search-form">
      <Input
        value={zip}
        onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
        placeholder="Zip code, e.g. 77084"
        inputMode="numeric"
        aria-label="Zip code"
      />
      <Button type="submit" disabled={busy}>
        {busy ? "Starting…" : "Run search"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Replace the dashboard page**

Replace `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { getDashboardStats } from "@/lib/leads/stats";
import { formatDate, timeAgo } from "@/lib/format";
import { StatTile } from "@/components/dashboard/StatTile";
import { ZipSearchForm } from "@/components/searches/ZipSearchForm";
import { SearchStatusBadge } from "@/components/searches/SearchStatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await getActor();
  const [stats, recent, hot] = await Promise.all([
    getDashboardStats(actor.id),
    prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.project.findMany({
      where: { ownerId: actor.id, exclusion: "none", timingWindow: { in: ["opening_soon", "under_construction"] } },
      orderBy: { completionDate: "asc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-500">Find SMB leads by zip code and track outreach.</p>
        </div>
        <ZipSearchForm />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total leads" value={stats.totalLeads} />
        <StatTile label="Green contact quality" value={stats.greenLeads} hint="ready to reach out" />
        <StatTile label="Opening in 60 days" value={stats.projectsOpeningSoon} hint="from TDLR projects" />
        <StatTile label="Contacted this week" value={stats.contactedThisWeek} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent searches</CardTitle>
            <Link href="/searches" className="text-sm text-blue-600 hover:underline">All searches</Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-neutral-500">No searches yet. Enter a zip code above.</p>
            ) : (
              <ul className="divide-y">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <Link href={`/leads?searchId=${s.id}`} className="font-medium hover:underline">
                        {s.zip}{s.city ? ` · ${s.city}` : ""}
                      </Link>
                      <div className="text-xs text-neutral-500">{timeAgo(s.createdAt)} · {s.countsFound} found</div>
                    </div>
                    <SearchStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Hot projects</CardTitle>
            <Link href="/projects" className="text-sm text-blue-600 hover:underline">All projects</Link>
          </CardHeader>
          <CardContent>
            {hot.length === 0 ? (
              <p className="text-sm text-neutral-500">No projects yet. TDLR sync arrives in the next plan.</p>
            ) : (
              <ul className="divide-y">
                {hot.map((p) => (
                  <li key={p.id} className="py-2 text-sm">
                    <div className="font-medium">{p.projectName}</div>
                    <div className="text-xs text-neutral-500">{p.zip} · completes {formatDate(p.completionDate)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

With the worker and dev server running, open `/`, enter `77084`, click Run search. Expected: toast "Search started", navigation to `/searches` (still the stub from Task 4 until Task 12), and the worker logs the job. Return to `/` and see the stat tiles update and the search listed with a status badge.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: dashboard with stat tiles, zip search form, recent searches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Searches page with live progress

**Files:**
- Create: `src/components/searches/SearchList.tsx`, `src/components/searches/ProgressBar.tsx`
- Modify: `src/app/searches/page.tsx`

**Interfaces:**
- Consumes: `GET /api/searches`, `POST /api/searches/:id/rerun`, `SearchStatusBadge`.
- Produces: `<SearchList initial={Search[]} />` that polls every 2 s while any search is queued or running; `<ProgressBar current total label />`.

- [ ] **Step 1: Write the components**

Create `src/components/searches/ProgressBar.tsx`:

```tsx
export function ProgressBar({ current, total, label }: { current?: number; total?: number; label?: string }) {
  const pct = total && total > 0 ? Math.min(100, Math.round(((current ?? 0) / total) * 100)) : null;
  return (
    <div className="w-full" data-testid="progress-bar">
      <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
        <div
          className={`h-2 rounded bg-blue-600 transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
      {label && (
        <div className="mt-1 text-xs text-neutral-500">
          {label}
          {pct != null && ` · ${current}/${total}`}
        </div>
      )}
    </div>
  );
}
```

Create `src/components/searches/SearchList.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Search } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchStatusBadge } from "./SearchStatusBadge";
import { ProgressBar } from "./ProgressBar";
import { timeAgo } from "@/lib/format";

type Progress = { step?: string; current?: number; total?: number; message?: string };

const STEP_LABELS: Record<string, string> = {
  geocode: "Locating zip",
  discover: "Finding businesses",
  save: "Saving businesses",
  scrape: "Extracting contacts from websites",
  validate: "Validating emails",
  score: "Scoring contact quality",
  complete: "Complete",
  paused: "Paused",
  failed: "Failed",
};

export function SearchList({ initial }: { initial: Search[] }) {
  const [items, setItems] = useState(initial);
  const active = items.some((s) => s.status === "queued" || s.status === "running");

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/searches", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).items);
    }, 2000);
    return () => clearInterval(t);
  }, [active]);

  async function rerun(id: string) {
    const res = await fetch(`/api/searches/${id}/rerun`, { method: "POST" });
    if (!res.ok) return toast.error("Could not re-run search");
    const { search } = await res.json();
    setItems((prev) => [search, ...prev]);
    toast.success(`Re-running ${search.zip}`);
  }

  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">No searches yet. Start one from the dashboard.</p>;
  }

  return (
    <div className="space-y-3" data-testid="search-list">
      {items.map((s) => {
        const p = (s.progress ?? {}) as Progress;
        const running = s.status === "queued" || s.status === "running";
        return (
          <Card key={s.id} data-testid="search-card" data-status={s.status}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-40">
                <div className="text-lg font-semibold">{s.zip}</div>
                <div className="text-xs text-neutral-500">
                  {s.city ? `${s.city}, ${s.state} · ` : ""}{timeAgo(s.createdAt)}
                </div>
              </div>
              <div className="flex-1">
                {running ? (
                  <ProgressBar current={p.current} total={p.total} label={`${STEP_LABELS[p.step ?? ""] ?? "Starting"}${p.message ? ` · ${p.message}` : ""}`} />
                ) : (
                  <div className="text-sm text-neutral-600 dark:text-neutral-300">
                    {s.countsFound} found · {s.countsScraped} websites scraped
                    {s.error && <span className="ml-2 text-red-600">{s.error}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SearchStatusBadge status={s.status} />
                <Button asChild variant="outline" size="sm">
                  <Link href={`/leads?searchId=${s.id}`}>View leads</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => rerun(s.id)} disabled={running}>
                  {s.status === "failed" ? "Retry" : "Re-run"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Replace the page**

Replace `src/app/searches/page.tsx`:

```tsx
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { SearchList } from "@/components/searches/SearchList";
import { ZipSearchForm } from "@/components/searches/ZipSearchForm";

export const dynamic = "force-dynamic";

export default async function SearchesPage() {
  const actor = await getActor();
  const items = await prisma.search.findMany({ where: { ownerId: actor.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="text-2xl font-semibold">Searches</h1>
        <ZipSearchForm />
      </div>
      <SearchList initial={items} />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run a search from `/searches`. Expected: a card appears with a moving progress bar and step labels, then flips to "complete" with counts and a "View leads" button. Re-run creates a new card at the top.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: searches page with live progress and re-run

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Leads table with filters (responsive)

**Files:**
- Create: `src/components/leads/QualityBadge.tsx`, `src/components/leads/SourceBadge.tsx`, `src/components/leads/StatusBadge.tsx`, `src/components/leads/LeadFilters.tsx`, `src/components/leads/LeadsTable.tsx`, `src/components/leads/LeadsView.tsx`, `src/components/leads/useLeadFilters.ts`
- Modify: `src/app/leads/page.tsx`

**Interfaces:**
- Consumes: `GET /api/businesses`, `GET /api/tags`, `CATEGORIES`, `PRODUCTS`, `LeadRow`.
- Produces: `<LeadsView />` (client, owns selection state and the detail drawer slot); `useLeadFilters()` returning `{ params: URLSearchParams; set(key, value): void; reset(): void }`; `<LeadsTable rows selectedIds onToggle onOpen />`; `<LeadFilters />`; badges.

- [ ] **Step 1: Write the badges**

Create `src/components/leads/QualityBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const STYLES = {
  green: "bg-emerald-100 text-emerald-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
} as const;

export function QualityBadge({ band, score }: { band: keyof typeof STYLES; score?: number }) {
  return (
    <Badge className={`${STYLES[band]} border-0 capitalize`} title={score != null ? `Score ${score}` : undefined}>
      <span className="mr-1 inline-block h-2 w-2 rounded-full bg-current" />
      {band}
    </Badge>
  );
}
```

Create `src/components/leads/SourceBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, string> = { zip_search: "Zip search", tdlr: "TDLR", manual: "Manual" };

export function SourceBadge({ source }: { source: string }) {
  return <Badge variant="outline">{LABELS[source] ?? source}</Badge>;
}
```

Create `src/components/leads/StatusBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

const STYLES: Record<string, string> = {
  not_contacted: "bg-neutral-200 text-neutral-800",
  contacted: "bg-blue-100 text-blue-800",
  interested: "bg-emerald-100 text-emerald-800",
  not_a_fit: "bg-neutral-100 text-neutral-500 line-through",
  customer: "bg-purple-100 text-purple-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={`${STYLES[status] ?? ""} border-0`}>{titleCase(status)}</Badge>;
}
```

- [ ] **Step 2: Write the filter state hook and panel**

Create `src/components/leads/useLeadFilters.ts`:

```ts
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function useLeadFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
      if (key !== "page") next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const reset = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  return { params, set, reset };
}
```

Create `src/components/leads/LeadFilters.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Tag } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/lib/config/categories";
import { PRODUCTS } from "@/lib/config/packages";
import { titleCase } from "@/lib/format";
import { useLeadFilters } from "./useLeadFilters";

const ANY = "__any";

function Choice({
  id, label, value, onChange, options,
}: { id: string; label: string; value: string; onChange: (v: string | null) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? null : v)}>
        <SelectTrigger id={id}><SelectValue placeholder="Any" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LeadFilters() {
  const { params, set, reset } = useLeadFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    fetch("/api/tags").then((r) => r.json()).then((d) => setTags(d.items ?? []));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) set("q", q || null);
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  const statuses = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];

  return (
    <div className="space-y-4" data-testid="lead-filters">
      <div className="space-y-1">
        <Label htmlFor="f-q">Search</Label>
        <Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-zip">Zip</Label>
        <Input id="f-zip" defaultValue={params.get("zip") ?? ""} inputMode="numeric" maxLength={5}
          onBlur={(e) => set("zip", /^\d{5}$/.test(e.target.value) ? e.target.value : null)} />
      </div>
      <Choice id="f-category" label="Category" value={params.get("category") ?? ""} onChange={(v) => set("category", v)}
        options={CATEGORIES.map((c) => ({ value: c.slug, label: c.label }))} />
      <Choice id="f-quality" label="Contact quality" value={params.get("quality") ?? ""} onChange={(v) => set("quality", v)}
        options={["green", "yellow", "red"].map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="f-status" label="Outreach status" value={params.get("status") ?? ""} onChange={(v) => set("status", v)}
        options={statuses.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="f-source" label="Source" value={params.get("source") ?? ""} onChange={(v) => set("source", v)}
        options={[{ value: "zip_search", label: "Zip search" }, { value: "tdlr", label: "TDLR" }, { value: "manual", label: "Manual" }]} />
      <Choice id="f-tag" label="Tag" value={params.get("tag") ?? ""} onChange={(v) => set("tag", v)}
        options={tags.filter((t) => !t.isSystem).map((t) => ({ value: t.name, label: t.name }))} />
      <Choice id="f-product" label="Product pitched" value={params.get("product") ?? ""} onChange={(v) => set("product", v)}
        options={PRODUCTS.map((p) => ({ value: p.slug, label: p.label }))} />
      <Choice id="f-sort" label="Sort" value={params.get("sort") ?? ""} onChange={(v) => set("sort", v)}
        options={[{ value: "quality", label: "Contact quality" }, { value: "name", label: "Name" }, { value: "updated", label: "Recently updated" }]} />
      <div className="flex items-center gap-2">
        <Checkbox id="f-excluded" checked={params.get("showExcluded") === "true"}
          onCheckedChange={(c) => set("showExcluded", c ? "true" : null)} />
        <Label htmlFor="f-excluded">Show excluded (enterprise)</Label>
      </div>
      <Button variant="outline" size="sm" onClick={() => { setQ(""); reset(); }}>Clear filters</Button>
    </div>
  );
}
```

- [ ] **Step 3: Write the table and the view**

Create `src/components/leads/LeadsTable.tsx`:

```tsx
"use client";

import type { LeadRow } from "@/lib/leads/queries";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { categoryLabel } from "@/lib/config/categories";
import { packageLabel } from "@/lib/config/packages";
import { QualityBadge } from "./QualityBadge";
import { SourceBadge } from "./SourceBadge";
import { StatusBadge } from "./StatusBadge";

type Props = {
  rows: LeadRow[];
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (id: string) => void;
};

export function LeadsTable({ rows, selectedIds, onToggle, onToggleAll, onOpen }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block dark:bg-neutral-900">
        <Table data-testid="leads-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={allSelected} onCheckedChange={(c) => onToggleAll(!!c)} aria-label="Select all" /></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Zip</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((b) => (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => onOpen(b.id)} data-testid="lead-row">
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selectedIds.has(b.id)} onCheckedChange={(c) => onToggle(b.id, !!c)} aria-label={`Select ${b.name}`} />
                </TableCell>
                <TableCell className="font-medium">
                  {b.name}
                  {b.exclusion !== "none" && <span className="ml-2 text-xs text-neutral-500">(excluded)</span>}
                </TableCell>
                <TableCell>{categoryLabel(b.primaryCategory)}</TableCell>
                <TableCell>{b.zip}</TableCell>
                <TableCell><QualityBadge band={b.contactQualityBand} score={b.contactQualityScore} /></TableCell>
                <TableCell><SourceBadge source={b.source} /></TableCell>
                <TableCell><StatusBadge status={b.outreachStatus} /></TableCell>
                <TableCell className="text-sm text-neutral-600">{packageLabel(b.suggestedPackage)}</TableCell>
                <TableCell className="text-sm text-neutral-600">{b.currentProviderHint ? `${b.currentProviderHint} (hint)` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 md:hidden" data-testid="leads-cards">
        {rows.map((b) => (
          <li key={b.id} className="rounded-lg border bg-white p-3 dark:bg-neutral-900" onClick={() => onOpen(b.id)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-neutral-500">{categoryLabel(b.primaryCategory)} · {b.zip}</div>
              </div>
              <QualityBadge band={b.contactQualityBand} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <StatusBadge status={b.outreachStatus} />
              <SourceBadge source={b.source} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
```

Create `src/components/leads/LeadsView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { LeadRow } from "@/lib/leads/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LeadFilters } from "./LeadFilters";
import { LeadsTable } from "./LeadsTable";
import { useLeadFilters } from "./useLeadFilters";

type ListResponse = { items: LeadRow[]; total: number; page: number; pageSize: number; runningSearches: number };

export function LeadsView({
  renderDrawer,
  renderBulkBar,
}: {
  renderDrawer?: (id: string | null, close: () => void, refresh: () => void) => React.ReactNode;
  renderBulkBar?: (ids: string[], clear: () => void, refresh: () => void) => React.ReactNode;
}) {
  const { params, set } = useLeadFilters();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/businesses?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return setError((await res.json()).error ?? "Failed to load");
    setError(null);
    setData(await res.json());
  }, [params]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data?.runningSearches) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.runningSearches, load]);

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <aside className="hidden w-64 shrink-0 md:block">
        <div className="sticky top-20 rounded-lg border bg-white p-4 dark:bg-neutral-900"><LeadFilters /></div>
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-neutral-500" data-testid="leads-count">
            {data ? `${data.total} lead${data.total === 1 ? "" : "s"}` : "Loading…"}
            {data?.runningSearches ? " · search running, updating live" : ""}
          </div>
          <div className="flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="md:hidden"><SlidersHorizontal className="mr-1 h-4 w-4" />Filters</Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
                <SheetTitle className="mb-3">Filters</SheetTitle>
                <LeadFilters />
              </SheetContent>
            </Sheet>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/export?${params.toString()}`} data-testid="export-csv">Export CSV</a>
            </Button>
          </div>
        </div>

        {renderBulkBar?.([...selected], () => setSelected(new Set()), load)}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {data && data.items.length === 0 && <p className="text-sm text-neutral-500">No leads match these filters.</p>}
        {data && data.items.length > 0 && (
          <LeadsTable
            rows={data.items}
            selectedIds={selected}
            onToggle={(id, c) => setSelected((prev) => { const n = new Set(prev); c ? n.add(id) : n.delete(id); return n; })}
            onToggleAll={(c) => setSelected(c ? new Set(data.items.map((r) => r.id)) : new Set())}
            onOpen={setOpenId}
          />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
          </div>
        )}
      </div>

      {renderDrawer?.(openId, () => setOpenId(null), load)}
    </div>
  );
}
```

- [ ] **Step 4: Replace the leads page**

Replace `src/app/leads/page.tsx` (the drawer and bulk bar are wired in Tasks 14 and 15; for now render the view alone):

```tsx
import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <LeadsView />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Open `/leads` after a completed search. Expected: table with badges; filters change the URL and the list; on a narrow window the table becomes cards and filters open in a bottom sheet; while a search runs the count line says "updating live" and rows appear as they land. `/leads?searchId=<id>` from the Searches page scopes the list.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: leads table with URL-driven filters, responsive cards, live updates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Lead detail drawer and full page

**Files:**
- Create: `src/components/leads/LeadDetail.tsx`, `src/components/leads/LeadDrawer.tsx`, `src/components/leads/CopyButton.tsx`, `src/app/leads/[id]/page.tsx`
- Modify: `src/app/leads/page.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/businesses/:id`, `GET/POST /api/tags`, badges, `PRODUCTS`.
- Produces: `<LeadDetail id onChanged? />`; `<LeadDrawer id onClose onChanged />`.

- [ ] **Step 1: Write the components**

Create `src/components/leads/CopyButton.tsx`:

```tsx
"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(`${label} copied`);
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}
```

Create `src/components/leads/LeadDetail.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { Tag } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { categoryLabel } from "@/lib/config/categories";
import { PRODUCTS, packageLabel } from "@/lib/config/packages";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import { CopyButton } from "./CopyButton";
import { QualityBadge } from "./QualityBadge";
import { SourceBadge } from "./SourceBadge";

type Contact = { id: string; type: string; value: string; personName: string | null; personTitle: string | null; validationStatus: string; source: string };
type Project = { id: string; projectNumber: string; projectName: string; estimatedCost: number | null; startDate: string | null; completionDate: string | null; scopeOfWork: string | null; ownerName: string | null; ownerPhone: string | null; timingWindow: string | null };
type Detail = {
  id: string; name: string; formattedAddress: string | null; zip: string | null; phone: string | null; websiteUrl: string | null;
  primaryCategory: string | null; source: string; exclusion: string; exclusionReasons: string[];
  contactQualityBand: "green" | "yellow" | "red"; contactQualityScore: number; contactQualityReasons: { code: string; points: number; detail: string }[] | null;
  suggestedPackage: string | null; currentProviderHint: string | null; currentProviderEvidence: string | null;
  outreachStatus: string; productsPitched: string[]; notes: string; websiteReachable: boolean | null; websiteError: string | null;
  contacts: Contact[]; tags: { tag: Tag }[]; activity: { id: string; kind: string; message: string; createdAt: string }[]; projects: Project[];
};

const STATUSES = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];
const GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: "email", label: "Emails", types: ["email"] },
  { key: "phone", label: "Phones", types: ["phone"] },
  { key: "social", label: "Social & LinkedIn", types: ["linkedin", "facebook", "instagram", "twitter", "yelp", "other"] },
];

export function LeadDetail({ id, onChanged }: { id: string; onChanged?: () => void }) {
  const [b, setB] = useState<Detail | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTag, setNewTag] = useState("");
  const [notes, setNotes] = useState("");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    const res = await fetch(`/api/businesses/${id}`, { cache: "no-store" });
    if (!res.ok) return toast.error("Could not load lead");
    const { business } = await res.json();
    setB(business);
    setNotes(business.notes);
  }
  useEffect(() => { load(); fetch("/api/tags").then((r) => r.json()).then((d) => setTags(d.items ?? [])); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function patch(body: Record<string, unknown>, quiet = false) {
    const res = await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return toast.error("Save failed");
    const { business } = await res.json();
    setB(business);
    onChanged?.();
    if (!quiet) toast.success("Saved");
  }

  function onNotes(v: string) {
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => patch({ notes: v }, true), 800);
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name) return;
    const res = await fetch("/api/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return toast.error("Could not create tag");
    const { tag } = await res.json();
    setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    setNewTag("");
    await patch({ tagIds: [...(b?.tags.map((t) => t.tag.id) ?? []), tag.id] });
  }

  if (!b) return <p className="text-sm text-neutral-500">Loading…</p>;

  const userTagIds = new Set(b.tags.map((t) => t.tag.id));
  const linkedinSearch = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(b.name)}`;

  return (
    <div className="space-y-5" data-testid="lead-detail">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{b.name}</h2>
          <QualityBadge band={b.contactQualityBand} score={b.contactQualityScore} />
          <SourceBadge source={b.source} />
        </div>
        <p className="text-sm text-neutral-500">{categoryLabel(b.primaryCategory)}{b.formattedAddress ? ` · ${b.formattedAddress}` : ""}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {b.phone && <span className="inline-flex items-center gap-1"><a href={`tel:${b.phone}`} className="hover:underline">{b.phone}</a><CopyButton value={b.phone} label="Phone" /></span>}
          {b.websiteUrl && <a href={b.websiteUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Website{b.websiteReachable === false ? " (unreachable)" : ""}</a>}
          <a href={linkedinSearch} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Search LinkedIn</a>
        </div>
        {b.exclusion !== "none" && <p className="mt-2 text-xs text-red-600">Excluded: {b.exclusionReasons.join(", ")}</p>}
        {b.suggestedPackage && <p className="mt-2 text-sm"><span className="text-neutral-500">Suggested pitch:</span> {packageLabel(b.suggestedPackage)}</p>}
        {b.currentProviderHint && (
          <p className="mt-1 text-sm"><span className="text-neutral-500">Current provider (hint):</span> {b.currentProviderHint}
            {b.currentProviderEvidence && <span className="block text-xs text-neutral-500">“{b.currentProviderEvidence}”</span>}</p>
        )}
      </div>

      <Separator />

      <section className="space-y-3">
        <h3 className="font-medium">Contacts</h3>
        {GROUPS.map((g) => {
          const list = b.contacts.filter((c) => g.types.includes(c.type));
          if (list.length === 0) return null;
          return (
            <div key={g.key}>
              <div className="text-xs font-medium uppercase text-neutral-500">{g.label}</div>
              <ul className="mt-1 space-y-1">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    {c.type === "email" ? <a href={`mailto:${c.value}`} className="hover:underline">{c.value}</a>
                      : c.type === "phone" ? <a href={`tel:${c.value}`} className="hover:underline">{c.value}</a>
                      : <a href={c.value} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{titleCase(c.type)}: {c.value.replace(/^https?:\/\/(www\.)?/, "")}</a>}
                    {c.personName && <span className="text-neutral-500">· {c.personName}{c.personTitle ? `, ${c.personTitle}` : ""}</span>}
                    <span className={`rounded px-1 text-[10px] uppercase ${c.validationStatus === "valid" ? "bg-emerald-100 text-emerald-800" : c.validationStatus === "invalid" ? "bg-red-100 text-red-800" : "bg-neutral-100 text-neutral-600"}`}>{c.validationStatus}</span>
                    <span className="text-[10px] text-neutral-400">{c.source}</span>
                    {(c.type === "email" || c.type === "phone") && <CopyButton value={c.value} label={titleCase(c.type)} />}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {b.contacts.length === 0 && <p className="text-sm text-neutral-500">No contacts found yet.</p>}
        {b.contactQualityReasons && b.contactQualityReasons.length > 0 && (
          <p className="text-xs text-neutral-500">Quality: {b.contactQualityReasons.map((r) => `${r.detail} (+${r.points})`).join(", ")}</p>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="font-medium">Outreach</h3>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <Select value={b.outreachStatus} onValueChange={(v) => patch({ outreachStatus: v })}>
            <SelectTrigger id="status" data-testid="status-select"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Products pitched</Label>
          <div className="mt-1 flex flex-wrap gap-3">
            {PRODUCTS.map((p) => (
              <label key={p.slug} className="flex items-center gap-1 text-sm">
                <Checkbox checked={b.productsPitched.includes(p.slug)}
                  onCheckedChange={(c) => patch({ productsPitched: c ? [...b.productsPitched, p.slug] : b.productsPitched.filter((x) => x !== p.slug) })} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Tags</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {tags.filter((t) => !t.isSystem).map((t) => (
              <button key={t.id} type="button"
                className={`rounded-full border px-2 py-0.5 text-xs ${userTagIds.has(t.id) ? "text-white" : "text-neutral-600"}`}
                style={userTagIds.has(t.id) ? { background: t.color, borderColor: t.color } : undefined}
                onClick={() => patch({ tagIds: userTagIds.has(t.id) ? [...userTagIds].filter((x) => x !== t.id) : [...userTagIds, t.id] })}>
                {t.name}
              </button>
            ))}
            <form onSubmit={(e) => { e.preventDefault(); createTag(); }} className="flex gap-1">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="New tag" className="h-7 w-28 text-xs" />
              <Button type="submit" size="sm" variant="outline" className="h-7">Add</Button>
            </form>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => onNotes(e.target.value)} rows={4} placeholder="Autosaves as you type" data-testid="notes" />
        </div>
      </section>

      {b.projects.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <h3 className="font-medium">TDLR project</h3>
            {b.projects.map((p) => (
              <div key={p.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">{p.projectName} <span className="text-neutral-500">({p.projectNumber})</span></div>
                <div className="text-neutral-600">{formatDate(p.startDate)} → {formatDate(p.completionDate)}{p.estimatedCost != null ? ` · $${p.estimatedCost.toLocaleString()}` : ""}{p.timingWindow ? ` · ${titleCase(p.timingWindow)}` : ""}</div>
                {p.scopeOfWork && <div className="mt-1 text-neutral-600">{p.scopeOfWork}</div>}
                {p.ownerName && <div className="mt-1">Owner: {p.ownerName}{p.ownerPhone ? ` · ${p.ownerPhone}` : ""}</div>}
              </div>
            ))}
          </section>
        </>
      )}

      <Separator />
      <section>
        <h3 className="font-medium">Activity</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {b.activity.map((a) => (
            <li key={a.id} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-neutral-400">{timeAgo(a.createdAt)}</span><span>{a.message}</span></li>
          ))}
          {b.activity.length === 0 && <li className="text-neutral-500">No activity yet.</li>}
        </ul>
      </section>
    </div>
  );
}
```

Create `src/components/leads/LeadDrawer.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { LeadDetail } from "./LeadDetail";

export function LeadDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="sr-only">Lead detail</SheetTitle>
        {id && (
          <>
            <div className="mb-3 text-right">
              <Link href={`/leads/${id}`} className="text-xs text-blue-600 hover:underline">Open full page</Link>
            </div>
            <LeadDetail id={id} onChanged={onChanged} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

Create `src/app/leads/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { LeadDetail } from "@/components/leads/LeadDetail";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/leads" className="text-sm text-blue-600 hover:underline">← Back to leads</Link>
      <LeadDetail id={id} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the drawer into the leads page**

Replace `src/app/leads/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";
import { LeadDrawer } from "@/components/leads/LeadDrawer";

export default function LeadsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Leads</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <LeadsView
          renderDrawer={(id, close, refresh) => <LeadDrawer id={id} onClose={close} onChanged={refresh} />}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Click a lead row. Expected: a right-side drawer (full width on phones) with contacts grouped and copy buttons, status change shows "Saved" and updates the row behind it, product checkboxes persist, a new tag can be created and toggled, notes autosave after a pause, activity lists "Status set to …". "Open full page" renders the same at `/leads/<id>`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: lead detail drawer and page with contacts, outreach panel, activity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Bulk actions

**Files:**
- Create: `src/components/leads/BulkBar.tsx`
- Modify: `src/app/leads/page.tsx`

**Interfaces:**
- Consumes: `POST /api/businesses/bulk`, `GET /api/tags`.
- Produces: `<BulkBar ids clear refresh />`.

- [ ] **Step 1: Write the bulk bar**

Create `src/components/leads/BulkBar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Tag } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/format";

const STATUSES = ["not_contacted", "contacted", "interested", "not_a_fit", "customer"];

export function BulkBar({ ids, clear, refresh }: { ids: string[]; clear: () => void; refresh: () => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => { fetch("/api/tags").then((r) => r.json()).then((d) => setTags((d.items ?? []).filter((t: Tag) => !t.isSystem))); }, []);
  if (ids.length === 0) return null;

  async function apply(body: Record<string, unknown>) {
    const res = await fetch("/api/businesses/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, ...body }) });
    if (!res.ok) return toast.error("Bulk update failed");
    const { updated } = await res.json();
    toast.success(`Updated ${updated} lead${updated === 1 ? "" : "s"}`);
    clear();
    refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-blue-50 p-2 text-sm dark:bg-blue-950" data-testid="bulk-bar">
      <span className="font-medium">{ids.length} selected</span>
      <Select onValueChange={(v) => apply({ outreachStatus: v })}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Set status…" /></SelectTrigger>
        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
      </Select>
      <Select onValueChange={(v) => apply({ addTagId: v })}>
        <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Add tag…" /></SelectTrigger>
        <SelectContent>
          {tags.length === 0 && <SelectItem value="__none" disabled>No tags yet</SelectItem>}
          {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it in**

In `src/app/leads/page.tsx`, add the import and the prop:

```tsx
import { BulkBar } from "@/components/leads/BulkBar";
// ...
        <LeadsView
          renderDrawer={(id, close, refresh) => <LeadDrawer id={id} onClose={close} onChanged={refresh} />}
          renderBulkBar={(ids, clear, refresh) => <BulkBar ids={ids} clear={clear} refresh={refresh} />}
        />
```

- [ ] **Step 3: Verify**

Select several rows with the checkboxes. Expected: the bulk bar appears; "Set status" updates them all and clears the selection; "Add tag" attaches a user tag; "Export CSV" downloads a file whose rows match the current filters.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: bulk status and tag actions on leads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Playwright end-to-end suite

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`, `tests/e2e/leads.spec.ts`

**Interfaces:**
- Consumes: the whole app in `PROVIDER_MODE=fake`, `JOB_MODE=inline`, against `TEST_DATABASE_URL`.

- [ ] **Step 1: Install browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Write the config and setup**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
const testDb = process.env.TEST_DATABASE_URL!;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100/unlock",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: testDb,
      PROVIDER_MODE: "fake",
      JOB_MODE: "inline",
      APP_PASSPHRASE: "test-pass",
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
      GOOGLE_DAILY_BUDGET: "100000",
    },
  },
});
```

Create `tests/e2e/global-setup.ts`:

```ts
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

export default function globalSetup() {
  loadEnv({ path: ".env" });
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL! };
  execSync("npx prisma db push --force-reset --skip-generate --accept-data-loss", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
}
```

Create `tests/e2e/helpers.ts`:

```ts
import type { Page } from "@playwright/test";

export async function unlock(page: Page) {
  await page.goto("/unlock");
  await page.getByPlaceholder("Passphrase").fill("test-pass");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("**/");
}
```

- [ ] **Step 3: Write the spec**

Create `tests/e2e/leads.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("wrong passphrase is rejected, right one unlocks", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/unlock/);
  await page.getByPlaceholder("Passphrase").fill("nope");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("That passphrase is not right.")).toBeVisible();
  await unlock(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("run a zip search and see leads appear", async ({ page }) => {
  await unlock(page);
  await page.getByLabel("Zip code").fill("77084");
  await page.getByRole("button", { name: "Run search" }).click();
  await expect(page).toHaveURL(/\/searches/);
  await expect(page.locator('[data-testid="search-card"][data-status="complete"]').first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/leads");
  await expect(page.getByTestId("leads-count")).toContainText(/\d+ leads/);
  await expect(page.getByTestId("lead-row").first()).toBeVisible();
  await expect(page.getByText("Starbucks")).toHaveCount(0);

  await page.getByLabel("Show excluded (enterprise)").check();
  await expect(page.getByText("Starbucks")).toBeVisible();
});

test("change outreach status and filter by it", async ({ page }) => {
  await unlock(page);
  await page.goto("/leads?q=restaurant%20One");
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByTestId("lead-detail")).toBeVisible();
  await page.getByTestId("status-select").click();
  await page.getByRole("option", { name: "Contacted" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/leads?status=contacted");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
  await expect(page.getByTestId("lead-row")).toHaveCount(1);
});

test("notes autosave and export link carries filters", async ({ page }) => {
  await unlock(page);
  await page.goto("/leads?q=restaurant%20One");
  await page.getByTestId("lead-row").first().click();
  await page.getByTestId("notes").fill("Spoke with owner");
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByTestId("lead-row").first().click();
  await expect(page.getByTestId("notes")).toHaveValue("Spoke with owner");
  await expect(page.getByTestId("export-csv")).toHaveAttribute("href", /q=restaurant/);
});
```

- [ ] **Step 4: Run the suite**

Make sure the Docker database is up, then:

```bash
npm run test:e2e
```

Expected: 4 passed. The first search test waits for the inline job to finish (a few seconds in fake mode). If the "Contacted" option click fails because shadcn's Select renders options with role `option` inside a listbox, keep the locator as written; if the installed shadcn version renders `menuitem`, change `getByRole("option", ...)` to `getByRole("menuitem", ...)`.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run test:db && npm run lint
git add -A
git commit -m "test: playwright e2e for unlock, search, leads, status, notes, export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 1

- `npm test`, `npm run test:db`, and `npm run test:e2e` all pass.
- With `PROVIDER_MODE=real` and a Google key in `.env`, running a search for a Houston zip fills the Leads table with real businesses, contact badges, and website-derived emails within a few minutes, and the worker log shows no unhandled errors.
- The Projects, Scanner, and Settings pages exist as stubs; the navbar reserves the Scanner pill and user-menu slots.

## What the next plans cover

- **Plan 2:** TDLR sync job and parser, Project table population, SMB fit on projects, timing windows, Projects page, promote job, dashboard hot projects.
- **Plan 3:** Scanner (schedule, targets, tick loop, pause/stop, page, navbar pill).
- **Plan 4:** Apollo enrichment, Settings page (keys, budgets, editable lists), Railway deployment config.
