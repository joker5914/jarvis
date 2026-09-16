# SDR Lead Gen Dashboard — Plan 2: TDLR Project Intel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull Houston construction and renovation projects from the Texas Department of Licensing and Regulation (TDLR) TABS registry into the dashboard, score each for SMB fit and timing, show them on a Projects page, and let the user promote a project into a Business that runs through the existing contact pipeline.

**Architecture:** A `ProjectRegistryProvider` interface with a real TDLR implementation (JSON search endpoint + HTML detail pages, throttled to one request per second) and a deterministic fake. A `tdlr-sync` pg-boss job (nightly cron + on demand) upserts `Project` rows with SMB fit, exclusion, and timing window. A promote flow matches a project to a Google Place (or creates a Business from the project) and reuses the Plan 1 scrape/validate/score helpers. Projects get their own API, filters, table, drawer, and sync bar; the Leads table gains a timing column and filter from linked projects.

**Tech Stack:** Same as Plan 1: Next.js 15.5 App Router, TypeScript, Tailwind 4, shadcn/ui (Base UI generation), Prisma 6.19 + Postgres 16, pg-boss 12, cheerio, zod 4, Vitest 5, Playwright. Node 22.22.3.

**Spec:** `docs/superpowers/specs/2026-09-15-sdr-lead-gen-dashboard-design.md` — sections 3.2 (ProjectRegistryProvider), 4 (Project, SyncState, ActivityLog), 5.3 (TDLR sync), 5.4 (promote), 5.5 (errors), 6.1 (SMB fit), 6.3 (timing window), 6.4 (package for new construction), 8 (Projects page, dashboard hot projects, lead detail project card).

## Global Constraints

- Node 22.22.3 via nvm (`export PATH="/c/Users/cgill/AppData/Roaming/nvm/v22.22.3:$PATH"` in Git Bash before npm commands). Same pinned majors as Plan 1; no upgrades.
- shadcn/ui here is the **Base UI generation**: no `asChild`; compose with `render={<Link .../>}`; `nativeButton={false}` on a `Button` that renders an `<a>`; `Select` takes `items` and `onValueChange` may pass `null`; `Checkbox` uses `onCheckedChange(boolean)`.
- Every route handler and server component obtains the owner via `getActor()`; the literal `"local-user"` is allowed only in `src/lib/actor.ts`, Prisma defaults, the seed, and tests. Jobs that have no owning row (TDLR sync, batch promote) call `getActor()` once for the owner id.
- TDLR: city code `785` (Houston). Search endpoint `POST https://www.tdlr.texas.gov/TABS/Search/SearchProjects` (form-encoded, `X-Requested-With: XMLHttpRequest`), DataTables paging (`draw`, `start`, `length`, `order[0][column]=3`, `order[0][dir]=asc`, `columns[3][data]=ProjectCreatedOn`), filters `LocationCity`, `RegistrationDateBegin`, `RegistrationDateEnd` as `MM/DD/YYYY`; response `{ recordsTotal, recordsFiltered, data: [{ ProjectId, ProjectNumber, ProjectName, ProjectCreatedOn, ProjectStatus, FacilityName, City, County, TypeOfWork, EstimatedCost, DataVersionId, EstimatedStartDate, EstimatedEndDate }] }`. Detail page `GET https://www.tdlr.texas.gov/TABS/Search/Project/<ProjectNumber>` (HTML). Status codes: 3001 Inspection Completed, 3002 Inspection Process, 3003 Inspection Scheduled, 3004 Preliminary Plan Review, 3005 Miscellaneous, 3006 Preliminary Review Pending, 3007 Project Closed, 3008 Project Registered, 3009 Review Complete, 3010 Review Pending. Work types: 9001 New Construction, 9002 Renovation/Alteration, 9003 Additions to Existing Building, 9004 Historic Preservation, 9005 Public Right of Way.
- TDLR politeness: requests serialized at **1 request per second**, 10 s timeout, user agent `SDR-LeadGen/1.0 (+contact info research)`. TDLR calls are not budgeted (public records, free).
- Sync rules: first run backfills registrations from the last **12 months**; skip projects whose completion date is more than **90 days** in the past; re-fetch details for unlinked, non-excluded projects last checked more than **30 days** ago; nightly at **03:00 America/Chicago** plus on demand.
- Timing windows: `opening_soon` completion within 45 days; `under_construction` started and completion > 45 days out; `planned` start in the future; `just_completed` completed within the last 60 days; `stale` completed > 60 days ago or status closed.
- SMB fit for projects uses `scoreSmbFit` unchanged (name, facility, cost, sqft, tenant-funded, work type). Hard exclusion: chain/entity match, cost > 2,000,000, work type `row`. Promote eligibility (batch): `smbFitScore >= 60`, `exclusion = none`, `businessId = null`.
- Auto-link rule: top Places result whose zip equals the project zip and whose name token-similarity to the facility name is `>= 0.8`; otherwise show up to 3 candidates or "Create from project".
- Businesses created from a project: `source = tdlr`, owner phone stored as a `phone` contact with `source = tdlr` and `personName` = project contact name (falling back to owner name), `suggestedPackage = full_bundle` for new construction.
- Apollo enrichment is never automatic and is not part of this plan.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit author flags: `git -c user.name="cgillett5914" -c user.email="cgillett5914@gmail.com"`.
- Servers are stopped by PID, never `taskkill /IM node.exe`. Editor TypeScript diagnostics are often stale; `npx tsc --noEmit` is the source of truth.

## File structure (what this plan creates or modifies)

```
src/lib/providers/types.ts           + ProjectSummary, ProjectDetail, ProjectRegistryProvider, Providers.registry
src/lib/providers/tdlr.ts            real TDLR provider: codes, mappers, throttled fetch
src/lib/providers/fake.ts            + FakeRegistryProvider, project-name matches in FakeDiscoveryProvider
src/lib/providers/index.ts           registry wired for fake/real
src/lib/extract/tdlrDetail.ts        parseTdlrDetail(html) + field parsers
src/lib/config/projects.ts           thresholds (backfill, stale, recheck, high-fit, auto-link similarity)
src/lib/scoring/timingWindow.ts      timingWindowFor()
src/lib/scoring/projectScoring.ts    scoreProjectFields() → fit/exclusion/timing bundle
src/lib/jobs/queues.ts               + tdlrSync, promote, promoteBatch queues + data types
src/lib/jobs/tdlrSync.ts             runTdlrSync()
src/lib/jobs/promote.ts              nameSimilarity, findBusinessCandidates, linkProjectToPlace, createBusinessFromProject, runPromoteBusiness, runPromoteHighFit
src/lib/jobs/zipSearch.ts            export scrapeOne, validateEmails (refactor only)
src/lib/jobs/enqueue.ts              + enqueueTdlrSync, enqueuePromote, enqueuePromoteBatch
src/lib/jobs/syncStatus.ts           read/write SyncState cursor JSON (shared by sync + batch)
src/worker/index.ts                  + three handlers + nightly cron
prisma/schema.prisma                 ActivityLog.project relation + index (new migration)
src/lib/projects/filters.ts          parseProjectFilters, buildProjectWhere, buildProjectOrderBy
src/lib/projects/queries.ts          listProjects, getProjectDetail, ProjectRow
src/app/api/projects/route.ts        GET list
src/app/api/projects/[id]/route.ts   GET one
src/app/api/projects/[id]/find/route.ts     POST find/auto-link
src/app/api/projects/[id]/promote/route.ts  POST link candidate or create from project
src/app/api/projects/sync/route.ts   GET status, POST sync now
src/app/api/projects/promote-high-fit/route.ts  POST batch
src/components/projects/*            TimingBadge, FitBadge, ProjectFilters, ProjectsTable, ProjectDrawer, FindBusinessDialog, SyncBar, ProjectsView
src/app/projects/page.tsx            real page
src/lib/leads/filters.ts             + timing filter
src/lib/leads/queries.ts             + projects in leadInclude
src/components/leads/LeadsTable.tsx  + Timing column
src/components/leads/LeadFilters.tsx + timing select
tests/fixtures/html/tdlr-detail.html real detail page (saved once)
tests/fixtures/tdlr-search.json      real search response sample
tests/unit/extract/tdlrDetail.test.ts, tests/unit/providers/tdlr.test.ts, tests/unit/scoring/timingWindow.test.ts, tests/unit/jobs/nameSimilarity.test.ts, tests/unit/projects/filters.test.ts
tests/db/tdlrSync.test.ts, tests/db/promote.test.ts
tests/e2e/projects.spec.ts
.github/workflows/ci.yml             lint, tsc, unit, db, e2e on push/PR
```

---

### Task 1: TDLR provider — types, detail parser, search mapper, fake

**Files:**
- Create: `src/lib/extract/tdlrDetail.ts`, `src/lib/providers/tdlr.ts`, `tests/fixtures/html/tdlr-detail.html`, `tests/fixtures/tdlr-search.json`, `tests/unit/extract/tdlrDetail.test.ts`, `tests/unit/providers/tdlr.test.ts`
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/fake.ts`, `src/lib/providers/index.ts`

**Interfaces:**
- Consumes: `USER_AGENT`, `REQUEST_TIMEOUT_MS` from `@/lib/extract/website`; `SmbWorkType` from `@/lib/scoring/types`.
- Produces:
  - `type ProjectSummary = { tdlrProjectId: string; projectNumber: string; projectName: string; facilityName: string | null; registeredAt: Date; statusCode: number; cityCode: number; countyCode: number; workTypeCode: number; estimatedCost: number | null; startDate: Date | null; completionDate: Date | null }`
  - `type ProjectDetail = { projectNumber: string; projectName: string | null; facilityName: string | null; locationAddress: string | null; city: string | null; state: string | null; zip: string | null; county: string | null; startDate: Date | null; completionDate: Date | null; estimatedCost: number | null; workTypeLabel: string | null; fundsType: string | null; scopeOfWork: string | null; squareFootage: number | null; tenantFunded: boolean | null; statusLabel: string | null; registrationDate: Date | null; contactName: string | null; rasName: string | null; rasPhone: string | null; ownerName: string | null; ownerAddress: string | null; ownerPhone: string | null; tenantName: string | null; designFirmName: string | null }`
  - `interface ProjectRegistryProvider { listProjects(opts: { registeredFrom: Date; registeredTo: Date; start: number; length: number }): Promise<{ total: number; items: ProjectSummary[] }>; getProjectDetail(projectNumber: string): Promise<ProjectDetail | null> }`
  - `Providers.registry: ProjectRegistryProvider`
  - `parseTdlrDetail(html: string): ProjectDetail`, `parseTdlrDate(s)`, `parseMoney(s)`, `parseSqft(s)`, `parseAddressLines(lines)`
  - `TDLR_HOUSTON_CITY_CODE = 785`, `TDLR_STATUS_LABELS: Record<number, string>`, `TDLR_WORK_TYPES: Record<number, SmbWorkType>`, `workTypeFromCode(code)`, `workTypeFromLabel(label)`, `fmtTdlrDate(d: Date): string`, `mapSearchRow(row: TdlrSearchRow): ProjectSummary`, `class TdlrRegistryProvider`
  - `class FakeRegistryProvider` with four fixed projects (see Step 6), and `FakeDiscoveryProvider` returning an exact "Bella Nails & Spa" match for queries starting with that name.

- [ ] **Step 1: Save the fixtures**

Download one real detail page and one real search response (network, once; the tests never fetch):

```bash
mkdir -p tests/fixtures/html
curl -s -A "SDR-LeadGen/1.0 (+contact info research)" "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027001089" -o tests/fixtures/html/tdlr-detail.html
curl -s -A "SDR-LeadGen/1.0 (+contact info research)" -X POST -H "content-type: application/x-www-form-urlencoded; charset=UTF-8" -H "x-requested-with: XMLHttpRequest" \
  --data "draw=1&start=0&length=3&order[0][column]=3&order[0][dir]=desc&columns[3][data]=ProjectCreatedOn&LocationCity=785&DataVersionId=" \
  "https://www.tdlr.texas.gov/TABS/Search/SearchProjects" -o tests/fixtures/tdlr-search.json
```

Open both files and confirm: the HTML contains `<div class="project-details-project">` with `<dl class="dl-horizontal">` blocks and the text `La Dulce Vida Adult Day Care`; the JSON has `recordsTotal`, `recordsFiltered`, and a `data` array with `ProjectNumber` keys. If project TABS2027001089 has been removed, pick any project number from the JSON's `data[0].ProjectNumber`, download that instead, and adjust the expected values in Step 2's test to match what the page shows (the field names and structure are what matter).

- [ ] **Step 2: Write the failing parser and mapper tests**

Create `tests/unit/extract/tdlrDetail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTdlrDetail, parseTdlrDate, parseMoney, parseSqft, parseAddressLines } from "@/lib/extract/tdlrDetail";

const html = readFileSync(path.join(import.meta.dirname, "../../fixtures/html/tdlr-detail.html"), "utf8");

describe("field parsers", () => {
  it("parses M/D/YYYY dates as UTC midnight", () => {
    expect(parseTdlrDate("1/20/2026")?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    expect(parseTdlrDate("")).toBeNull();
    expect(parseTdlrDate("nope")).toBeNull();
  });
  it("parses money and square footage", () => {
    expect(parseMoney("$60,000")).toBe(60000);
    expect(parseMoney("$1,705,000.50")).toBe(1705000.5);
    expect(parseMoney(null)).toBeNull();
    expect(parseSqft("3,175 ft 2")).toBe(3175);
    expect(parseSqft("3,175 ft2")).toBe(3175);
    expect(parseSqft(undefined)).toBeNull();
  });
  it("splits address lines into street, city, state, zip", () => {
    expect(parseAddressLines(["6031 Highway 6 N SUite #190", "Houston, TX 77084"])).toEqual({
      address: "6031 Highway 6 N SUite #190", city: "Houston", state: "TX", zip: "77084",
    });
    expect(parseAddressLines(["6031 Highway 6 North #190", "Houston, Texas 77084"])).toEqual({
      address: "6031 Highway 6 North #190", city: "Houston", state: "TX", zip: "77084",
    });
    expect(parseAddressLines([])).toEqual({ address: null, city: null, state: null, zip: null });
  });
});

describe("parseTdlrDetail", () => {
  it("extracts every field from a real detail page", () => {
    const d = parseTdlrDetail(html);
    expect(d.projectNumber).toBe("TABS2027001089");
    expect(d.projectName).toBe("La Dulce Vida Adult Day Care");
    expect(d.facilityName).toBe("La Dulce Vida Adult Day Car");
    expect(d.locationAddress).toBe("6031 Highway 6 N SUite #190");
    expect(d.city).toBe("Houston");
    expect(d.state).toBe("TX");
    expect(d.zip).toBe("77084");
    expect(d.county).toBe("Harris");
    expect(d.startDate?.toISOString()).toBe("2025-08-20T00:00:00.000Z");
    expect(d.completionDate?.toISOString()).toBe("2026-01-20T00:00:00.000Z");
    expect(d.estimatedCost).toBe(60000);
    expect(d.workTypeLabel).toBe("Renovation/Alteration");
    expect(d.fundsType).toMatch(/privately funded/);
    expect(d.scopeOfWork).toBe("Adult Day Care renovations, floor, roof, walls");
    expect(d.squareFootage).toBe(3175);
    expect(d.tenantFunded).toBe(true);
    expect(d.statusLabel).toBe("Project Registered");
    expect(d.registrationDate?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(d.contactName).toBe("Iris Regueira");
    expect(d.rasName).toBe("LARRY T,FLEMING");
    expect(d.rasPhone).toBe("(281) 745-0234");
    expect(d.ownerName).toBe("Irisnexy Regueira");
    expect(d.ownerAddress).toBe("6031 Highway 6 North #190, Houston, Texas 77084");
    expect(d.ownerPhone).toBe("(713) 340-7247");
    expect(d.tenantName).toBeNull();
    expect(d.designFirmName).toBeNull();
  });

  it("does not throw on an empty page and returns nulls", () => {
    const d = parseTdlrDetail("<html><body></body></html>");
    expect(d.projectNumber).toBe("");
    expect(d.projectName).toBeNull();
    expect(d.ownerPhone).toBeNull();
  });
});
```

Create `tests/unit/providers/tdlr.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapSearchRow, fmtTdlrDate, workTypeFromCode, workTypeFromLabel, TDLR_STATUS_LABELS } from "@/lib/providers/tdlr";

const sample = JSON.parse(readFileSync(path.join(import.meta.dirname, "../../fixtures/tdlr-search.json"), "utf8"));

describe("tdlr mappers", () => {
  it("maps a real search row", () => {
    const row = sample.data[0];
    const s = mapSearchRow(row);
    expect(s.projectNumber).toBe(row.ProjectNumber);
    expect(s.tdlrProjectId).toBe(row.ProjectId);
    expect(s.cityCode).toBe(785);
    expect(s.registeredAt.toISOString().slice(0, 10)).toBe(String(row.ProjectCreatedOn).slice(0, 10));
    expect(typeof s.statusCode).toBe("number");
    expect([9001, 9002, 9003, 9004, 9005]).toContain(s.workTypeCode);
    expect(s.estimatedCost === null || typeof s.estimatedCost === "number").toBe(true);
  });
  it("handles null dates and costs", () => {
    const s = mapSearchRow({
      ProjectId: "x", ProjectNumber: "TABS1", ProjectName: "N", ProjectCreatedOn: "2026-09-15T19:41:39.203",
      ProjectStatus: 3008, FacilityName: null, City: 785, County: 2101, TypeOfWork: 9002,
      EstimatedCost: null, DataVersionId: 900001, EstimatedStartDate: null, EstimatedEndDate: null,
    });
    expect(s.facilityName).toBeNull();
    expect(s.estimatedCost).toBeNull();
    expect(s.startDate).toBeNull();
    expect(s.completionDate).toBeNull();
  });
  it("formats dates and maps codes", () => {
    expect(fmtTdlrDate(new Date(Date.UTC(2026, 8, 5)))).toBe("09/05/2026");
    expect(workTypeFromCode(9001)).toBe("new_construction");
    expect(workTypeFromCode(9002)).toBe("renovation");
    expect(workTypeFromCode(9005)).toBe("row");
    expect(workTypeFromCode(1)).toBeNull();
    expect(workTypeFromLabel("Renovation/Alteration")).toBe("renovation");
    expect(workTypeFromLabel("Public Right of Way")).toBe("row");
    expect(TDLR_STATUS_LABELS[3007]).toBe("Project Closed");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

```bash
npm test -- tests/unit/extract/tdlrDetail tests/unit/providers/tdlr
```

Expected: FAIL, modules not found.

- [ ] **Step 4: Add the types**

Append to `src/lib/providers/types.ts` (keep everything already there; add `registry` to `Providers`):

```ts
export type ProjectSummary = {
  tdlrProjectId: string;
  projectNumber: string;
  projectName: string;
  facilityName: string | null;
  registeredAt: Date;
  statusCode: number;
  cityCode: number;
  countyCode: number;
  workTypeCode: number;
  estimatedCost: number | null;
  startDate: Date | null;
  completionDate: Date | null;
};

export type ProjectDetail = {
  projectNumber: string;
  projectName: string | null;
  facilityName: string | null;
  locationAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  county: string | null;
  startDate: Date | null;
  completionDate: Date | null;
  estimatedCost: number | null;
  workTypeLabel: string | null;
  fundsType: string | null;
  scopeOfWork: string | null;
  squareFootage: number | null;
  tenantFunded: boolean | null;
  statusLabel: string | null;
  registrationDate: Date | null;
  contactName: string | null;
  rasName: string | null;
  rasPhone: string | null;
  ownerName: string | null;
  ownerAddress: string | null;
  ownerPhone: string | null;
  tenantName: string | null;
  designFirmName: string | null;
};

export interface ProjectRegistryProvider {
  listProjects(opts: {
    registeredFrom: Date;
    registeredTo: Date;
    start: number;
    length: number;
  }): Promise<{ total: number; items: ProjectSummary[] }>;
  getProjectDetail(projectNumber: string): Promise<ProjectDetail | null>;
}
```

and change the `Providers` type to:

```ts
export type Providers = {
  geocode: GeocodeProvider;
  discovery: DiscoveryProvider;
  validation: ValidationProvider;
  registry: ProjectRegistryProvider;
  fetcher: PageFetcher;
};
```

- [ ] **Step 5: Implement the detail parser**

Create `src/lib/extract/tdlrDetail.ts`:

```ts
import * as cheerio from "cheerio";
import type { ProjectDetail } from "@/lib/providers/types";

export function parseTdlrDate(s: string | null | undefined): Date | null {
  const m = (s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
}

export function parseMoney(s: string | null | undefined): number | null {
  const cleaned = (s ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseSqft(s: string | null | undefined): number | null {
  const m = (s ?? "").match(/([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const STATE_NAMES: Record<string, string> = { texas: "TX" };

export function parseAddressLines(lines: string[]): {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (clean.length === 0) return { address: null, city: null, state: null, zip: null };
  const last = clean[clean.length - 1];
  const m = last.match(/^(.*?),\s*([A-Za-z .]+?)\s+(\d{5})(?:-\d{4})?$/);
  if (!m) return { address: clean.join(", "), city: null, state: null, zip: null };
  const rawState = m[2].trim();
  const state = rawState.length === 2 ? rawState.toUpperCase() : (STATE_NAMES[rawState.toLowerCase()] ?? rawState);
  return {
    address: clean.slice(0, -1).join(", ") || null,
    city: m[1].trim(),
    state,
    zip: m[3],
  };
}

type Fields = Map<string, string[]>;

/** Reads every <dl> under `root` into { "Label": ["dd text", ...] } (label without trailing colon). */
function readFields($: cheerio.CheerioAPI, root: cheerio.Cheerio<cheerio.Element>): Fields {
  const out: Fields = new Map();
  root.find("dl").each((_, dl) => {
    let key: string | null = null;
    $(dl)
      .children()
      .each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (el.tagName === "dt") {
          key = text.replace(/:$/, "").trim();
          if (!out.has(key)) out.set(key, []);
        } else if (el.tagName === "dd" && key) {
          out.get(key)!.push(text);
        }
      });
  });
  return out;
}

const first = (f: Fields, key: string): string | null => {
  const v = f.get(key)?.[0]?.trim();
  return v ? v : null;
};

function sectionName($: cheerio.CheerioAPI, selector: string, key: string): string | null {
  const sec = $(selector);
  if (sec.length === 0) return null;
  if (/not assigned/i.test(sec.find("p").first().text())) return null;
  const f = readFields($, sec);
  return first(f, key) ?? f.values().next().value?.[0] ?? null;
}

export function parseTdlrDetail(html: string): ProjectDetail {
  const $ = cheerio.load(html);
  const project = readFields($, $(".project-details-project"));
  const contact = readFields($, $(".project-details-contact"));
  const ras = readFields($, $(".project-details-ras"));
  const owner = readFields($, $(".project-details-owner"));

  const loc = parseAddressLines(project.get("Location Address") ?? []);
  const ownerAddr = (owner.get("Owner Address") ?? []).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const headerText = $(".project-details-header").text().replace(/\s+/g, " ");
  const regMatch = headerText.match(/Registration Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
  const tenant = first(project, "Are the private funds provided by the tenant?");

  return {
    projectNumber: first(project, "Project Number") ?? headerText.match(/Project #:\s*(\S+)/)?.[1] ?? "",
    projectName: first(project, "Project Name"),
    facilityName: first(project, "Facility Name"),
    locationAddress: loc.address,
    city: loc.city,
    state: loc.state,
    zip: loc.zip,
    county: first(project, "Location County"),
    startDate: parseTdlrDate(first(project, "Start Date")),
    completionDate: parseTdlrDate(first(project, "Completion Date")),
    estimatedCost: parseMoney(first(project, "Estimated Cost")),
    workTypeLabel: first(project, "Type of Work"),
    fundsType: first(project, "Type of Funds"),
    scopeOfWork: first(project, "Scope of Work"),
    squareFootage: parseSqft(first(project, "Square Footage")),
    tenantFunded: tenant == null ? null : /^yes/i.test(tenant),
    statusLabel: first(project, "Current Status"),
    registrationDate: parseTdlrDate(regMatch?.[1]),
    contactName: first(contact, "Contact Name"),
    rasName: first(ras, "RAS Name"),
    rasPhone: first(ras, "RAS Phone"),
    ownerName: first(owner, "Owner Name"),
    ownerAddress: ownerAddr.length ? ownerAddr.join(", ") : null,
    ownerPhone: first(owner, "Owner Phone"),
    tenantName: sectionName($, ".project-details-tenant", "Tenant Name"),
    designFirmName: sectionName($, ".project-details-designer", "Design Firm Name"),
  };
}
```

If cheerio's `Element` type import complains under the installed version, type `root` as `ReturnType<cheerio.CheerioAPI>` instead; behavior is unchanged.

- [ ] **Step 6: Implement the real provider, fake, and wiring**

Create `src/lib/providers/tdlr.ts`:

```ts
import { REQUEST_TIMEOUT_MS, USER_AGENT } from "@/lib/extract/website";
import { parseTdlrDetail } from "@/lib/extract/tdlrDetail";
import type { SmbWorkType } from "@/lib/scoring/types";
import type { ProjectDetail, ProjectRegistryProvider, ProjectSummary } from "./types";

export const TDLR_BASE = "https://www.tdlr.texas.gov/TABS";
export const TDLR_HOUSTON_CITY_CODE = 785;
export const TDLR_MIN_INTERVAL_MS = 1000;

export const TDLR_STATUS_LABELS: Record<number, string> = {
  3001: "Inspection Completed",
  3002: "Inspection Process",
  3003: "Inspection Scheduled",
  3004: "Preliminary Plan Review",
  3005: "Miscellaneous",
  3006: "Preliminary Review Pending",
  3007: "Project Closed",
  3008: "Project Registered",
  3009: "Review Complete",
  3010: "Review Pending",
};
export const TDLR_STATUS_CLOSED = 3007;

export const TDLR_WORK_TYPES: Record<number, SmbWorkType> = {
  9001: "new_construction",
  9002: "renovation",
  9003: "addition",
  9004: "historic",
  9005: "row",
};

export function workTypeFromCode(code: number | null | undefined): SmbWorkType | null {
  return code == null ? null : (TDLR_WORK_TYPES[code] ?? null);
}

export function workTypeFromLabel(label: string | null | undefined): SmbWorkType | null {
  const l = (label ?? "").toLowerCase();
  if (l.startsWith("new construction")) return "new_construction";
  if (l.startsWith("renovation")) return "renovation";
  if (l.startsWith("addition")) return "addition";
  if (l.startsWith("historic")) return "historic";
  if (l.startsWith("public right")) return "row";
  return null;
}

export function fmtTdlrDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

export type TdlrSearchRow = {
  ProjectId: string;
  ProjectNumber: string;
  ProjectName: string;
  ProjectCreatedOn: string;
  ProjectStatus: number;
  FacilityName: string | null;
  City: number;
  County: number;
  TypeOfWork: number;
  EstimatedCost: number | null;
  DataVersionId: number;
  EstimatedStartDate: string | null;
  EstimatedEndDate: string | null;
};

/** TDLR timestamps have no zone; treat them as UTC dates. */
function isoToDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.endsWith("Z") ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapSearchRow(row: TdlrSearchRow): ProjectSummary {
  return {
    tdlrProjectId: row.ProjectId,
    projectNumber: row.ProjectNumber,
    projectName: row.ProjectName ?? "",
    facilityName: row.FacilityName || null,
    registeredAt: isoToDate(row.ProjectCreatedOn) ?? new Date(0),
    statusCode: Number(row.ProjectStatus),
    cityCode: Number(row.City),
    countyCode: Number(row.County),
    workTypeCode: Number(row.TypeOfWork),
    estimatedCost: row.EstimatedCost == null ? null : Number(row.EstimatedCost),
    startDate: isoToDate(row.EstimatedStartDate),
    completionDate: isoToDate(row.EstimatedEndDate),
  };
}

export class TdlrRegistryProvider implements ProjectRegistryProvider {
  private lastRequestAt = 0;

  constructor(private minIntervalMs = TDLR_MIN_INTERVAL_MS) {}

  private async throttle() {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    await this.throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal, headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) } });
    } finally {
      clearTimeout(timer);
    }
  }

  async listProjects(opts: { registeredFrom: Date; registeredTo: Date; start: number; length: number }) {
    const body = new URLSearchParams({
      draw: "1",
      start: String(opts.start),
      length: String(opts.length),
      "order[0][column]": "3",
      "order[0][dir]": "asc",
      "columns[3][data]": "ProjectCreatedOn",
      LocationCity: String(TDLR_HOUSTON_CITY_CODE),
      RegistrationDateBegin: fmtTdlrDate(opts.registeredFrom),
      RegistrationDateEnd: fmtTdlrDate(opts.registeredTo),
      DataVersionId: "",
    });
    const res = await this.request(`${TDLR_BASE}/Search/SearchProjects`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`TDLR search HTTP ${res.status}`);
    const data = (await res.json()) as { recordsFiltered?: number; recordsTotal?: number; data?: TdlrSearchRow[] };
    return { total: Number(data.recordsFiltered ?? data.recordsTotal ?? 0), items: (data.data ?? []).map(mapSearchRow) };
  }

  async getProjectDetail(projectNumber: string): Promise<ProjectDetail | null> {
    const res = await this.request(`${TDLR_BASE}/Search/Project/${encodeURIComponent(projectNumber)}`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TDLR detail HTTP ${res.status} for ${projectNumber}`);
    const html = await res.text();
    const detail = parseTdlrDetail(html);
    if (!detail.projectNumber && !detail.projectName) return null;
    return detail;
  }
}
```

Append to `src/lib/providers/fake.ts` (import `ProjectDetail`, `ProjectRegistryProvider`, `ProjectSummary` from `./types`):

```ts
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

type FakeProject = ProjectSummary & { detail: ProjectDetail };

function fakeProject(
  n: number,
  p: Partial<ProjectSummary> & Partial<ProjectDetail> & { projectName: string },
): FakeProject {
  const projectNumber = `TABS2027${String(n).padStart(6, "0")}`;
  const summary: ProjectSummary = {
    tdlrProjectId: `fake-project-${n}`,
    projectNumber,
    projectName: p.projectName,
    facilityName: p.facilityName ?? null,
    registeredAt: p.registeredAt ?? daysFromNow(-5),
    statusCode: p.statusCode ?? 3008,
    cityCode: 785,
    countyCode: 2101,
    workTypeCode: p.workTypeCode ?? 9002,
    estimatedCost: p.estimatedCost ?? null,
    startDate: p.startDate ?? null,
    completionDate: p.completionDate ?? null,
  };
  const detail: ProjectDetail = {
    projectNumber,
    projectName: p.projectName,
    facilityName: p.facilityName ?? null,
    locationAddress: p.locationAddress ?? "123 Fake St",
    city: "Houston",
    state: "TX",
    zip: p.zip ?? "77084",
    county: "Harris",
    startDate: summary.startDate,
    completionDate: summary.completionDate,
    estimatedCost: summary.estimatedCost,
    workTypeLabel: summary.workTypeCode === 9001 ? "New Construction" : "Renovation/Alteration",
    fundsType: "This project is privately funded, on private land for private use.",
    scopeOfWork: p.scopeOfWork ?? "Interior finish-out",
    squareFootage: p.squareFootage ?? null,
    tenantFunded: p.tenantFunded ?? null,
    statusLabel: "Project Registered",
    registrationDate: summary.registeredAt,
    contactName: p.contactName ?? null,
    rasName: "FAKE RAS",
    rasPhone: "(281) 555-0100",
    ownerName: p.ownerName ?? null,
    ownerAddress: null,
    ownerPhone: p.ownerPhone ?? null,
    tenantName: null,
    designFirmName: null,
  };
  return { ...summary, detail };
}

export const FAKE_PROJECTS: FakeProject[] = [
  fakeProject(1, {
    projectName: "Bella Nails Buildout",
    facilityName: "Bella Nails & Spa",
    estimatedCost: 120_000,
    squareFootage: 1_800,
    tenantFunded: true,
    startDate: daysFromNow(-30),
    completionDate: daysFromNow(30),
    ownerName: "Ana Ruiz",
    contactName: "Ana Ruiz",
    ownerPhone: "(713) 555-0142",
  }),
  fakeProject(2, {
    projectName: "Corner Cafe Renovation",
    facilityName: "Corner Cafe",
    estimatedCost: 90_000,
    squareFootage: 1_200,
    tenantFunded: true,
    startDate: daysFromNow(10),
    completionDate: daysFromNow(120),
    ownerName: "Sam Lee",
    ownerPhone: "(713) 555-0177",
  }),
  fakeProject(3, {
    projectName: "Memorial Hermann Tower Dialysis",
    facilityName: "Memorial Hermann",
    estimatedCost: 5_000_000,
    workTypeCode: 9001,
    startDate: daysFromNow(-10),
    completionDate: daysFromNow(200),
  }),
  fakeProject(4, {
    projectName: "Old Coffee Shop Remodel",
    facilityName: "Old Coffee",
    estimatedCost: 50_000,
    startDate: daysFromNow(-300),
    completionDate: daysFromNow(-120),
  }),
];

/** Deterministic registry: four projects registered 5 days ago (one long completed). */
export class FakeRegistryProvider implements ProjectRegistryProvider {
  constructor(private projects: FakeProject[] = FAKE_PROJECTS) {}

  async listProjects(opts: { registeredFrom: Date; registeredTo: Date; start: number; length: number }) {
    const inWindow = this.projects.filter((p) => p.registeredAt >= opts.registeredFrom && p.registeredAt <= opts.registeredTo);
    return { total: inWindow.length, items: inWindow.slice(opts.start, opts.start + opts.length).map(({ detail: _d, ...s }) => s) };
  }

  async getProjectDetail(projectNumber: string): Promise<ProjectDetail | null> {
    return this.projects.find((p) => p.projectNumber === projectNumber)?.detail ?? null;
  }
}
```

In the existing `FakeDiscoveryProvider.searchCategory`, add at the top (before the `" in <zip>"` stripping) an exact-match branch used by the promote flow:

```ts
    // Promote flow: a query beginning with a fake project's facility name returns one exact match.
    if (/^bella nails & spa\b/i.test(rawQuery)) {
      return [{
        placeId: "fake-bella-nails",
        name: "Bella Nails & Spa",
        formattedAddress: "123 Fake St, Houston, TX 77084, USA",
        zip: "77084",
        lat: 29.84,
        lng: -95.66,
        phone: "(713) 555-0142",
        websiteUrl: "https://bella-nails.fake.test/",
        rating: 4.8,
        reviewCount: 41,
        types: ["nail_salon"],
      }];
    }
```

(For "Corner Cafe ..." queries the existing generic branch returns "Corner Cafe 123 Fake St 77084 One" / "... Two", which is intentionally a weak match.)

Update `src/lib/providers/index.ts` to wire `registry`:

```ts
import { defaultFetcher } from "@/lib/extract/website";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "./fake";
import { GoogleGeocodeProvider, GooglePlacesProvider } from "./google";
import { TdlrRegistryProvider } from "./tdlr";
import { BuiltinValidationProvider } from "./validation";
import type { Providers } from "./types";

export function getProviders(): Providers {
  const mode = process.env.PROVIDER_MODE ?? "fake";
  if (mode === "fake") {
    return {
      geocode: new FakeGeocodeProvider(),
      discovery: new FakeDiscoveryProvider(),
      validation: new FakeValidationProvider(),
      registry: new FakeRegistryProvider(),
      fetcher: fakeFetcher,
    };
  }
  return {
    geocode: new GoogleGeocodeProvider(),
    discovery: new GooglePlacesProvider(),
    validation: new BuiltinValidationProvider(),
    // TDLR is public records; it is real even when PROVIDER_MODE=real, and fake only in fake mode.
    registry: new TdlrRegistryProvider(),
    fetcher: defaultFetcher,
  };
}

export type { Providers } from "./types";
```

Fix the one existing `Providers` construction in `tests/db/zipSearch.test.ts` (it builds a providers object literal): add `registry: new FakeRegistryProvider()` to it so it still type-checks.

- [ ] **Step 7: Run the tests, type-check, commit**

```bash
npm test -- tests/unit/extract/tdlrDetail tests/unit/providers/tdlr
npm test
npx tsc --noEmit
npm run lint
git add -A
git commit -m "feat: TDLR registry provider, detail parser, search mapper, fake registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: the two new files pass (3 + 2 + 3 tests); full unit suite passes; tsc and lint clean.

---

### Task 2: Timing window and project scoring bundle

**Files:**
- Create: `src/lib/config/projects.ts`, `src/lib/scoring/timingWindow.ts`, `src/lib/scoring/projectScoring.ts`, `tests/unit/scoring/timingWindow.test.ts`, `tests/unit/scoring/projectScoring.test.ts`

**Interfaces:**
- Consumes: `scoreSmbFit`, `bandFor` from `@/lib/scoring/smbFit`; `SmbWorkType` from `@/lib/scoring/types`; `TDLR_STATUS_CLOSED` from `@/lib/providers/tdlr`.
- Produces:
  - `PROJECT_CONFIG = { backfillMonths: 12, staleAfterDays: 90, recheckAfterDays: 30, highFitThreshold: 60, autoLinkSimilarity: 0.8, justCompletedDays: 60, openingSoonDays: 45 }`
  - `type TimingWindowValue = "opening_soon" | "under_construction" | "planned" | "just_completed" | "stale"`
  - `timingWindowFor(p: { startDate: Date | null; completionDate: Date | null; statusCode: number | null }, now?: Date): TimingWindowValue | null`
  - `scoreProjectFields(f: ProjectScoringInput, now?: Date): ProjectScoring` where `ProjectScoringInput = { projectName: string; facilityName: string | null; estimatedCost: number | null; squareFootage: number | null; tenantFunded: boolean | null; workType: SmbWorkType | null; startDate: Date | null; completionDate: Date | null; statusCode: number | null }` and `ProjectScoring = { smbFitScore: number; smbFitBand: "high" | "medium" | "low"; smbFitReasons: ScoreReason[]; exclusion: "none" | "enterprise"; exclusionReasons: string[]; timingWindow: TimingWindowValue | null }`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/scoring/timingWindow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { timingWindowFor } from "@/lib/scoring/timingWindow";

const now = new Date("2026-09-16T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("timingWindowFor", () => {
  it("opening_soon when completion is within 45 days", () => {
    expect(timingWindowFor({ startDate: d(-30), completionDate: d(30), statusCode: 3008 }, now)).toBe("opening_soon");
    expect(timingWindowFor({ startDate: null, completionDate: d(45), statusCode: 3008 }, now)).toBe("opening_soon");
  });
  it("under_construction when started and completion is farther out", () => {
    expect(timingWindowFor({ startDate: d(-10), completionDate: d(200), statusCode: 3008 }, now)).toBe("under_construction");
    expect(timingWindowFor({ startDate: null, completionDate: d(200), statusCode: 3008 }, now)).toBe("under_construction");
  });
  it("planned when the start date is in the future", () => {
    expect(timingWindowFor({ startDate: d(10), completionDate: d(120), statusCode: 3008 }, now)).toBe("planned");
    expect(timingWindowFor({ startDate: d(10), completionDate: null, statusCode: 3008 }, now)).toBe("planned");
  });
  it("just_completed within 60 days after completion, then stale", () => {
    expect(timingWindowFor({ startDate: d(-100), completionDate: d(-10), statusCode: 3008 }, now)).toBe("just_completed");
    expect(timingWindowFor({ startDate: d(-100), completionDate: d(-60), statusCode: 3008 }, now)).toBe("just_completed");
    expect(timingWindowFor({ startDate: d(-300), completionDate: d(-120), statusCode: 3008 }, now)).toBe("stale");
  });
  it("closed status is always stale", () => {
    expect(timingWindowFor({ startDate: d(-30), completionDate: d(30), statusCode: 3007 }, now)).toBe("stale");
  });
  it("null when no dates at all", () => {
    expect(timingWindowFor({ startDate: null, completionDate: null, statusCode: 3008 }, now)).toBeNull();
    expect(timingWindowFor({ startDate: d(-5), completionDate: null, statusCode: 3008 }, now)).toBe("under_construction");
  });
});
```

Create `tests/unit/scoring/projectScoring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scoreProjectFields } from "@/lib/scoring/projectScoring";

const now = new Date("2026-09-16T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("scoreProjectFields", () => {
  it("bundles fit, exclusion, and timing for a tenant-funded salon build-out", () => {
    const s = scoreProjectFields({
      projectName: "Bella Nails Buildout", facilityName: "Bella Nails & Spa", estimatedCost: 120_000, squareFootage: 1_800,
      tenantFunded: true, workType: "renovation", startDate: d(-30), completionDate: d(30), statusCode: 3008,
    }, now);
    expect(s.exclusion).toBe("none");
    expect(s.smbFitScore).toBe(95);
    expect(s.smbFitBand).toBe("high");
    expect(s.timingWindow).toBe("opening_soon");
  });
  it("hard-excludes a health system and still computes timing", () => {
    const s = scoreProjectFields({
      projectName: "Memorial Hermann Tower Dialysis", facilityName: "Memorial Hermann", estimatedCost: 5_000_000, squareFootage: null,
      tenantFunded: null, workType: "new_construction", startDate: d(-10), completionDate: d(200), statusCode: 3008,
    }, now);
    expect(s.exclusion).toBe("enterprise");
    expect(s.exclusionReasons[0]).toMatch(/^chain:memorial hermann/);
    expect(s.smbFitScore).toBe(0);
    expect(s.timingWindow).toBe("under_construction");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm test -- tests/unit/scoring/timingWindow tests/unit/scoring/projectScoring
```

Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `src/lib/config/projects.ts`:

```ts
/** Defaults for TDLR sync and promotion. A Settings UI edits these in a later plan. */
export const PROJECT_CONFIG = {
  backfillMonths: 12,
  staleAfterDays: 90,
  recheckAfterDays: 30,
  highFitThreshold: 60,
  autoLinkSimilarity: 0.8,
  justCompletedDays: 60,
  openingSoonDays: 45,
} as const;
```

Create `src/lib/scoring/timingWindow.ts`:

```ts
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { TDLR_STATUS_CLOSED } from "@/lib/providers/tdlr";

export type TimingWindowValue = "opening_soon" | "under_construction" | "planned" | "just_completed" | "stale";

const DAY = 86_400_000;

export function timingWindowFor(
  p: { startDate: Date | null; completionDate: Date | null; statusCode: number | null },
  now: Date = new Date(),
): TimingWindowValue | null {
  if (p.statusCode === TDLR_STATUS_CLOSED) return "stale";
  const t = now.getTime();
  if (p.completionDate) {
    const untilDone = (p.completionDate.getTime() - t) / DAY;
    if (untilDone < 0) return -untilDone <= PROJECT_CONFIG.justCompletedDays ? "just_completed" : "stale";
    if (untilDone <= PROJECT_CONFIG.openingSoonDays) return "opening_soon";
    if (p.startDate && p.startDate.getTime() > t) return "planned";
    return "under_construction";
  }
  if (p.startDate) return p.startDate.getTime() > t ? "planned" : "under_construction";
  return null;
}
```

Create `src/lib/scoring/projectScoring.ts`:

```ts
import { bandFor, scoreSmbFit, type SmbFitBand } from "@/lib/scoring/smbFit";
import type { ScoreReason, SmbWorkType } from "@/lib/scoring/types";
import { timingWindowFor, type TimingWindowValue } from "./timingWindow";

export type ProjectScoringInput = {
  projectName: string;
  facilityName: string | null;
  estimatedCost: number | null;
  squareFootage: number | null;
  tenantFunded: boolean | null;
  workType: SmbWorkType | null;
  startDate: Date | null;
  completionDate: Date | null;
  statusCode: number | null;
};

export type ProjectScoring = {
  smbFitScore: number;
  smbFitBand: SmbFitBand;
  smbFitReasons: ScoreReason[];
  exclusion: "none" | "enterprise";
  exclusionReasons: string[];
  timingWindow: TimingWindowValue | null;
};

export function scoreProjectFields(f: ProjectScoringInput, now: Date = new Date()): ProjectScoring {
  const fit = scoreSmbFit({
    name: f.projectName,
    facilityName: f.facilityName,
    estimatedCost: f.estimatedCost,
    squareFootage: f.squareFootage,
    tenantFunded: f.tenantFunded,
    workType: f.workType,
  });
  return {
    smbFitScore: fit.score,
    smbFitBand: bandFor(fit.score),
    smbFitReasons: fit.reasons,
    exclusion: fit.excluded ? "enterprise" : "none",
    exclusionReasons: fit.exclusionReasons,
    timingWindow: timingWindowFor({ startDate: f.startDate, completionDate: f.completionDate, statusCode: f.statusCode }, now),
  };
}
```

`bandFor` and `SmbFitBand` are already exported by `src/lib/scoring/smbFit.ts` (Plan 1). If `SmbFitBand` is not exported, add `export` to its type alias.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test -- tests/unit/scoring
npx tsc --noEmit
git add -A
git commit -m "feat: project timing windows and project scoring bundle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: 6 + 2 new tests pass along with the existing scoring tests.

---

### Task 3: TDLR sync job, queues, worker cron, ActivityLog project relation

**Files:**
- Create: `src/lib/jobs/syncStatus.ts`, `src/lib/jobs/tdlrSync.ts`, `tests/db/tdlrSync.test.ts`, a new Prisma migration
- Modify: `prisma/schema.prisma`, `src/lib/jobs/queues.ts`, `src/lib/jobs/enqueue.ts`, `src/worker/index.ts`, `src/lib/jobs/zipSearch.ts` (export two helpers only)

**Interfaces:**
- Consumes: `Providers.registry`, `scoreProjectFields`, `workTypeFromCode`, `workTypeFromLabel`, `TDLR_STATUS_LABELS`, `PROJECT_CONFIG`, `getActor`, `JobPausedError`.
- Produces:
  - `QUEUES = { zipSearch: "zip-search", tdlrSync: "tdlr-sync", promote: "promote", promoteBatch: "promote-batch" }`; `type TdlrSyncJobData = Record<string, never>`; `type PromoteJobData = { businessId: string }`; `type PromoteBatchJobData = Record<string, never>`
  - `SYNC_KEYS = { tdlr: "tdlr", promoteBatch: "promote-batch" }`; `type SyncCursor = { status: "idle" | "running" | "paused" | "failed"; message?: string; current?: number; total?: number; startedAt?: string; finishedAt?: string; error?: string | null; counts?: Record<string, number> }`; `readSync(key)`, `writeSync(key, cursor, lastSuccessfulAt?)`
  - `type TdlrSyncDeps = { providers: Providers; shouldPause?: () => Promise<boolean>; signal?: AbortSignal; log?: (msg: string) => void; now?: () => Date }`
  - `runTdlrSync(deps: TdlrSyncDeps): Promise<{ scanned: number; skippedStale: number; created: number; updated: number; refreshed: number }>`
  - `enqueueTdlrSync(): Promise<void>` (singletonKey `"tdlr"`), plus `enqueuePromote(businessId)` and `enqueuePromoteBatch()` stubs whose runners land in Task 4 (import them from `./promote`, created in Task 4 — so **implement Task 4's `promote.ts` runner signatures first if you run this task in isolation**, or leave `enqueuePromote`/`enqueuePromoteBatch` for Task 4; this task must only add `enqueueTdlrSync`).
  - `scrapeOne(businessId, ownerId, deps)` and `validateEmails(businessIds, deps)` exported from `zipSearch.ts` (unchanged bodies).
  - Worker: handler for `tdlr-sync`; nightly cron `boss.schedule(QUEUES.tdlrSync, "0 3 * * *", {}, { tz: "America/Chicago" })`.
  - Prisma: `ActivityLog.project Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)`, `Project.activity ActivityLog[]`, `@@index([projectId, createdAt])` on ActivityLog.

- [ ] **Step 1: Schema relation and migration**

In `prisma/schema.prisma`, on `model ActivityLog` add after `business Business? ...`:

```prisma
  project    Project?  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
```

and on `model Project` add `activity ActivityLog[]` next to `business Business? ...`. Then:

```bash
npx prisma migrate dev --name activitylog_project_relation --skip-seed
npx prisma generate
```

Expected: a new folder under `prisma/migrations/` adding the FK and index; `init` and `owner_scoped_uniques` untouched.

- [ ] **Step 2: Queues, sync status helper, exports**

Replace `src/lib/jobs/queues.ts`:

```ts
export const QUEUES = {
  zipSearch: "zip-search",
  tdlrSync: "tdlr-sync",
  promote: "promote",
  promoteBatch: "promote-batch",
} as const;

export type ZipSearchJobData = { searchId: string };
export type TdlrSyncJobData = Record<string, never>;
export type PromoteJobData = { businessId: string };
export type PromoteBatchJobData = Record<string, never>;
```

Create `src/lib/jobs/syncStatus.ts`:

```ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const SYNC_KEYS = { tdlr: "tdlr", promoteBatch: "promote-batch" } as const;
export type SyncKey = (typeof SYNC_KEYS)[keyof typeof SYNC_KEYS];

export type SyncCursor = {
  status: "idle" | "running" | "paused" | "failed";
  message?: string;
  current?: number;
  total?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  counts?: Record<string, number>;
};

export async function readSync(key: SyncKey): Promise<{ lastSuccessfulAt: Date | null; cursor: SyncCursor }> {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return { lastSuccessfulAt: row?.lastSuccessfulAt ?? null, cursor: ((row?.cursor as SyncCursor | null) ?? { status: "idle" }) };
}

export async function writeSync(key: SyncKey, cursor: SyncCursor, lastSuccessfulAt?: Date): Promise<void> {
  await prisma.syncState.upsert({
    where: { key },
    update: { cursor: cursor as Prisma.InputJsonValue, ...(lastSuccessfulAt && { lastSuccessfulAt }) },
    create: { key, cursor: cursor as Prisma.InputJsonValue, lastSuccessfulAt: lastSuccessfulAt ?? null },
  });
}
```

In `src/lib/jobs/zipSearch.ts`, change `async function scrapeOne(` to `export async function scrapeOne(` and `async function validateEmails(` to `export async function validateEmails(`. No other change.

- [ ] **Step 3: Write the failing DB test**

Create `tests/db/tdlrSync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher, FAKE_PROJECTS } from "@/lib/providers/fake";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
};

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.project.deleteMany();
  await prisma.syncState.deleteMany();
});

describe("runTdlrSync", () => {
  it("backfills, scores, excludes, and skips long-completed projects", async () => {
    const r = await runTdlrSync({ providers });
    expect(r.scanned).toBe(FAKE_PROJECTS.length);
    expect(r.skippedStale).toBe(1);
    expect(r.created).toBe(3);

    const bella = await prisma.project.findUniqueOrThrow({ where: { ownerId_projectNumber: { ownerId: "local-user", projectNumber: "TABS2027000001" } } });
    expect(bella.facilityName).toBe("Bella Nails & Spa");
    expect(bella.zip).toBe("77084");
    expect(bella.workType).toBe("renovation");
    expect(bella.tenantFunded).toBe(true);
    expect(bella.smbFitScore).toBe(95);
    expect(bella.exclusion).toBe("none");
    expect(bella.timingWindow).toBe("opening_soon");
    expect(bella.ownerPhone).toBe("(713) 555-0142");
    expect(bella.statusLabel).toBe("Project Registered");
    expect(bella.detailFetchedAt).not.toBeNull();

    const mh = await prisma.project.findFirstOrThrow({ where: { projectNumber: "TABS2027000003" } });
    expect(mh.exclusion).toBe("enterprise");
    expect(mh.workType).toBe("new_construction");

    expect(await prisma.project.count({ where: { projectNumber: "TABS2027000004" } })).toBe(0);

    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.lastSuccessfulAt).not.toBeNull();
    expect(s.cursor.status).toBe("idle");
    expect(s.cursor.counts?.created).toBe(3);
  });

  it("is idempotent and only scans registrations since the last success", async () => {
    await runTdlrSync({ providers });
    const second = await runTdlrSync({ providers });
    expect(second.scanned).toBe(0);
    expect(await prisma.project.count()).toBe(3);
  });

  it("refreshes projects last checked more than 30 days ago", async () => {
    await runTdlrSync({ providers });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.project.updateMany({ data: { lastCheckedAt: old } });
    const r = await runTdlrSync({ providers });
    expect(r.refreshed).toBe(2); // Bella + Corner Cafe; Memorial Hermann is excluded and not refreshed
    const bella = await prisma.project.findFirstOrThrow({ where: { projectNumber: "TABS2027000001" } });
    expect(bella.lastCheckedAt!.getTime()).toBeGreaterThan(old.getTime());
  });

  it("marks the sync paused when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await runTdlrSync({ providers, signal: ctrl.signal });
    const s = await readSync(SYNC_KEYS.tdlr);
    expect(s.cursor.status).toBe("paused");
    expect(s.lastSuccessfulAt).toBeNull();
  });
});
```

- [ ] **Step 4: Implement the sync job**

Create `src/lib/jobs/tdlrSync.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { TDLR_STATUS_LABELS, workTypeFromCode, workTypeFromLabel } from "@/lib/providers/tdlr";
import type { ProjectDetail, ProjectSummary, Providers } from "@/lib/providers/types";
import { scoreProjectFields } from "@/lib/scoring/projectScoring";
import { JobPausedError } from "./zipSearch";
import { readSync, SYNC_KEYS, writeSync, type SyncCursor } from "./syncStatus";
import type { Prisma } from "@prisma/client";

export type TdlrSyncDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
  now?: () => Date;
};

const PAGE = 100;
const DAY = 86_400_000;

async function checkPause(deps: TdlrSyncDeps) {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

function projectData(s: ProjectSummary, d: ProjectDetail | null, now: Date): Prisma.ProjectUncheckedCreateInput {
  const workType = workTypeFromCode(s.workTypeCode) ?? workTypeFromLabel(d?.workTypeLabel);
  const startDate = d?.startDate ?? s.startDate;
  const completionDate = d?.completionDate ?? s.completionDate;
  const estimatedCost = d?.estimatedCost ?? s.estimatedCost;
  const scoring = scoreProjectFields(
    {
      projectName: d?.projectName ?? s.projectName,
      facilityName: d?.facilityName ?? s.facilityName,
      estimatedCost,
      squareFootage: d?.squareFootage ?? null,
      tenantFunded: d?.tenantFunded ?? null,
      workType,
      startDate,
      completionDate,
      statusCode: s.statusCode,
    },
    now,
  );
  return {
    tdlrProjectId: s.tdlrProjectId,
    projectNumber: s.projectNumber,
    projectName: d?.projectName ?? s.projectName,
    facilityName: d?.facilityName ?? s.facilityName,
    locationAddress: d?.locationAddress ?? null,
    city: d?.city ?? null,
    zip: d?.zip ?? null,
    county: d?.county ?? null,
    statusCode: s.statusCode,
    statusLabel: d?.statusLabel ?? TDLR_STATUS_LABELS[s.statusCode] ?? null,
    workType,
    estimatedCost,
    squareFootage: d?.squareFootage ?? null,
    tenantFunded: d?.tenantFunded ?? null,
    fundsType: d?.fundsType ?? null,
    scopeOfWork: d?.scopeOfWork ?? null,
    startDate,
    completionDate,
    registrationDate: d?.registrationDate ?? s.registeredAt,
    ownerName: d?.ownerName ?? null,
    ownerAddress: d?.ownerAddress ?? null,
    ownerPhone: d?.ownerPhone ?? null,
    contactName: d?.contactName ?? null,
    tenantName: d?.tenantName ?? null,
    designFirmName: d?.designFirmName ?? null,
    rasName: d?.rasName ?? null,
    rasPhone: d?.rasPhone ?? null,
    smbFitScore: scoring.smbFitScore,
    smbFitReasons: scoring.smbFitReasons as unknown as Prisma.InputJsonValue,
    exclusion: scoring.exclusion,
    exclusionReasons: scoring.exclusionReasons,
    timingWindow: scoring.timingWindow,
    detailFetchedAt: d ? now : null,
    lastCheckedAt: now,
    parseError: d ? null : "detail page unavailable",
  };
}

export async function runTdlrSync(deps: TdlrSyncDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ? deps.now() : new Date();
  const { id: ownerId } = await getActor();
  const counts = { scanned: 0, skippedStale: 0, created: 0, updated: 0, refreshed: 0 };
  const state = await readSync(SYNC_KEYS.tdlr);
  const registeredFrom = state.lastSuccessfulAt ?? new Date(now.getTime() - PROJECT_CONFIG.backfillMonths * 30 * DAY);
  const registeredTo = now;
  const staleBefore = new Date(now.getTime() - PROJECT_CONFIG.staleAfterDays * DAY);
  const cursor = (c: Partial<SyncCursor>) => writeSync(SYNC_KEYS.tdlr, { status: "running", startedAt: now.toISOString(), counts, ...c });

  try {
    await cursor({ message: "Listing registrations" });
    let start = 0;
    let total = Infinity;
    while (start < total) {
      await checkPause(deps);
      const page = await deps.providers.registry.listProjects({ registeredFrom, registeredTo, start, length: PAGE });
      total = page.total;
      if (page.items.length === 0) break;
      for (const s of page.items) {
        await checkPause(deps);
        counts.scanned++;
        if (s.completionDate && s.completionDate < staleBefore) {
          counts.skippedStale++;
          continue;
        }
        const existing = await prisma.project.findUnique({ where: { ownerId_projectNumber: { ownerId, projectNumber: s.projectNumber } } });
        if (existing?.detailFetchedAt) continue;
        await cursor({ message: `Fetching ${s.projectNumber}`, current: counts.scanned, total });
        const detail = await deps.providers.registry.getProjectDetail(s.projectNumber);
        const data = projectData(s, detail, now);
        if (existing) {
          await prisma.project.update({ where: { id: existing.id }, data });
          counts.updated++;
        } else {
          await prisma.project.create({ data: { ...data, ownerId } });
          counts.created++;
        }
      }
      start += page.items.length;
    }

    // Refresh open, unlinked, non-excluded projects not checked recently: dates and status move.
    const recheckBefore = new Date(now.getTime() - PROJECT_CONFIG.recheckAfterDays * DAY);
    const stale = await prisma.project.findMany({
      where: { ownerId, businessId: null, exclusion: "none", lastCheckedAt: { lt: recheckBefore } },
      select: { id: true, projectNumber: true, tdlrProjectId: true, statusCode: true, registrationDate: true, workType: true },
    });
    for (const p of stale) {
      await checkPause(deps);
      await cursor({ message: `Refreshing ${p.projectNumber}` });
      const detail = await deps.providers.registry.getProjectDetail(p.projectNumber);
      if (!detail) {
        await prisma.project.update({ where: { id: p.id }, data: { lastCheckedAt: now, parseError: "detail page unavailable" } });
        continue;
      }
      const summary: ProjectSummary = {
        tdlrProjectId: p.tdlrProjectId ?? "",
        projectNumber: p.projectNumber,
        projectName: detail.projectName ?? "",
        facilityName: detail.facilityName,
        registeredAt: p.registrationDate ?? now,
        statusCode: p.statusCode ?? 0,
        cityCode: 785,
        countyCode: 0,
        workTypeCode: Object.entries({ new_construction: 9001, renovation: 9002, addition: 9003, historic: 9004, row: 9005 }).find(([k]) => k === p.workType)?.[1] ?? 0,
        estimatedCost: detail.estimatedCost,
        startDate: detail.startDate,
        completionDate: detail.completionDate,
      };
      await prisma.project.update({ where: { id: p.id }, data: projectData(summary, detail, now) });
      counts.refreshed++;
    }

    await writeSync(SYNC_KEYS.tdlr, { status: "idle", finishedAt: new Date().toISOString(), counts, error: null }, registeredTo);
    log(`tdlr sync: ${JSON.stringify(counts)}`);
    return counts;
  } catch (e) {
    if (e instanceof JobPausedError) {
      await writeSync(SYNC_KEYS.tdlr, { status: "paused", message: "Paused", counts });
      return counts;
    }
    const message = (e as Error).message ?? String(e);
    await writeSync(SYNC_KEYS.tdlr, { status: "failed", error: message, counts });
    throw e;
  }
}
```

Note on the refresh path: it keeps the stored `statusCode` (the detail page shows only the label) and re-derives everything else from the fresh detail; a status change to "closed" is therefore picked up only when the row is re-listed by registration date. That matches the spec's "re-fetch details" scope.

- [ ] **Step 5: Enqueue helper and worker**

In `src/lib/jobs/enqueue.ts`, add (keeping everything existing):

```ts
import { runTdlrSync } from "./tdlrSync";
import { type TdlrSyncJobData } from "./queues";

export async function enqueueTdlrSync(): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runTdlrSync({ providers: getProviders(), log: console.log }).catch((e) => console.error("[inline tdlr-sync]", e));
    return;
  }
  const boss = await getBoss();
  const data: TdlrSyncJobData = {};
  await boss.send(QUEUES.tdlrSync, data, { retryLimit: 3, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: "tdlr" });
}
```

(Merge the imports with the existing `import { QUEUES, type ZipSearchJobData } from "./queues";` line.)

In `src/worker/index.ts`, after the zip-search `work` registration add:

```ts
  await boss.work<TdlrSyncJobData>(QUEUES.tdlrSync, { batchSize: 1 }, async ([job]) => {
    console.log(`[tdlr-sync] start`);
    await runTdlrSync({ providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[tdlr-sync] done`);
  });
  // Nightly at 03:00 Central; pg-boss dedupes the schedule by queue name.
  await boss.schedule(QUEUES.tdlrSync, "0 3 * * *", {}, { tz: "America/Chicago" });
```

with imports `import { QUEUES, type TdlrSyncJobData, type ZipSearchJobData } from "@/lib/jobs/queues";` and `import { runTdlrSync } from "@/lib/jobs/tdlrSync";`. Check `node_modules/pg-boss/dist/types.d.ts` for the `schedule(name, cron, data?, options?)` signature and the `tz` option name; adapt if it differs and note it in the report.

- [ ] **Step 6: Run, verify, commit**

```bash
npm run test:db
npm test
npx tsc --noEmit
npm run lint
```

Expected: `tests/db/tdlrSync.test.ts` 4 passed; all prior DB tests still pass (the zipSearch test's providers literal now includes `registry`). Then smoke the worker: `npm run worker` in the background, confirm `worker ready`, stop it by PID.

```bash
git add -A
git commit -m "feat: TDLR sync job with nightly cron, sync status, ActivityLog project relation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Promote flow — matching, linking, creating, scraping, batch

**Files:**
- Create: `src/lib/jobs/promote.ts`, `tests/unit/jobs/nameSimilarity.test.ts`, `tests/db/promote.test.ts`
- Modify: `src/lib/jobs/queues.ts` (PromoteJobData gains `ownerId`), `src/lib/jobs/enqueue.ts`, `src/worker/index.ts`

**Interfaces:**
- Consumes: `scrapeOne`, `validateEmails`, `recomputeContactQuality`, `normalizeName`, `JobPausedError`, `ZipSearchDeps` from `./zipSearch`; `normalizePhone`; `suggestPackage`; `PROJECT_CONFIG`; `readSync`/`writeSync`/`SYNC_KEYS`; `getActor`.
- Produces:
  - `type PromoteJobData = { businessId: string; ownerId: string }`
  - `type PromoteDeps = { providers: Providers; shouldPause?: () => Promise<boolean>; signal?: AbortSignal; log?: (msg: string) => void }`
  - `nameSimilarity(a: string, b: string): number` (token Jaccard over `normalizeName`)
  - `type FindResult = { auto: DiscoveredBusiness | null; candidates: DiscoveredBusiness[] }`
  - `findBusinessCandidates(projectId: string, ownerId: string, deps: PromoteDeps): Promise<FindResult>`
  - `linkProjectToPlace(projectId: string, ownerId: string, biz: DiscoveredBusiness): Promise<string>` (returns businessId)
  - `createBusinessFromProject(projectId: string, ownerId: string): Promise<string>`
  - `runPromoteBusiness(businessId: string, ownerId: string, deps: PromoteDeps): Promise<void>`
  - `runPromoteHighFit(deps: PromoteDeps): Promise<{ considered: number; linked: number; skipped: number }>`
  - `enqueuePromote(businessId: string, ownerId: string): Promise<void>`, `enqueuePromoteBatch(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/jobs/nameSimilarity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nameSimilarity } from "@/lib/jobs/promote";

describe("nameSimilarity", () => {
  it("is 1 for the same name modulo punctuation and suffixes", () => {
    expect(nameSimilarity("Bella Nails & Spa", "Bella Nails and Spa LLC")).toBeCloseTo(0.75, 2);
    expect(nameSimilarity("Bella Nails & Spa", "Bella Nails & Spa")).toBe(1);
  });
  it("is low for a padded fake match", () => {
    expect(nameSimilarity("Corner Cafe", "Corner Cafe 123 Fake St 77084 One")).toBeLessThan(0.5);
  });
  it("is 0 when either side is empty", () => {
    expect(nameSimilarity("", "x")).toBe(0);
  });
});
```

Create `tests/db/promote.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runTdlrSync } from "@/lib/jobs/tdlrSync";
import { createBusinessFromProject, findBusinessCandidates, linkProjectToPlace, runPromoteBusiness, runPromoteHighFit } from "@/lib/jobs/promote";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
  fetcher: fakeFetcher,
};
const OWNER = "local-user";

async function project(number: string) {
  return prisma.project.findUniqueOrThrow({ where: { ownerId_projectNumber: { ownerId: OWNER, projectNumber: number } } });
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.project.deleteMany();
  await prisma.business.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.tag.createMany({ data: CATEGORIES.map((c) => ({ ownerId: OWNER, name: c.slug, isSystem: true })) });
  await runTdlrSync({ providers });
});

describe("promote", () => {
  it("auto-links a confident match and runs the contact pipeline", async () => {
    const bella = await project("TABS2027000001");
    const found = await findBusinessCandidates(bella.id, OWNER, { providers });
    expect(found.auto?.placeId).toBe("fake-bella-nails");

    const businessId = await linkProjectToPlace(bella.id, OWNER, found.auto!);
    const linked = await prisma.project.findUniqueOrThrow({ where: { id: bella.id } });
    expect(linked.businessId).toBe(businessId);

    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { contacts: true, activity: true } });
    expect(b.source).toBe("tdlr");
    expect(b.googlePlaceId).toBe("fake-bella-nails");
    expect(b.name).toBe("Bella Nails & Spa");
    const ownerPhone = b.contacts.find((c) => c.source === "tdlr");
    expect(ownerPhone?.value).toBe("+17135550142");
    expect(ownerPhone?.personName).toBe("Ana Ruiz");
    expect(b.activity.some((a) => a.kind === "promoted" && a.projectId === bella.id)).toBe(true);

    await runPromoteBusiness(businessId, OWNER, { providers });
    const after = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { contacts: true } });
    expect(after.websiteReachable).toBe(true);
    expect(after.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")).toBe(true);
    expect(after.contactQualityBand).toBe("green");
  });

  it("returns candidates without auto-linking on a weak match, and can create from the project", async () => {
    const cafe = await project("TABS2027000002");
    const found = await findBusinessCandidates(cafe.id, OWNER, { providers });
    expect(found.auto).toBeNull();
    expect(found.candidates.length).toBeGreaterThan(0);

    const businessId = await createBusinessFromProject(cafe.id, OWNER);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { contacts: true } });
    expect(b.source).toBe("tdlr");
    expect(b.googlePlaceId).toBeNull();
    expect(b.name).toBe("Corner Cafe");
    expect(b.zip).toBe("77084");
    expect(b.formattedAddress).toBe("123 Fake St, Houston, TX 77084");
    expect(b.contacts.map((c) => c.value)).toEqual(["+17135550177"]);
    expect(b.contactQualityBand).toBe("red");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: cafe.id } })).businessId).toBe(businessId);

    // idempotent
    expect(await createBusinessFromProject(cafe.id, OWNER)).toBe(businessId);
  });

  it("links an existing business instead of duplicating it", async () => {
    const bella = await project("TABS2027000001");
    const found = await findBusinessCandidates(bella.id, OWNER, { providers });
    const id1 = await linkProjectToPlace(bella.id, OWNER, found.auto!);
    await prisma.project.update({ where: { id: bella.id }, data: { businessId: null } });
    const id2 = await linkProjectToPlace(bella.id, OWNER, found.auto!);
    expect(id2).toBe(id1);
    expect(await prisma.business.count({ where: { googlePlaceId: "fake-bella-nails" } })).toBe(1);
  });

  it("batch-promotes high-fit projects, linking confident matches and skipping the rest", async () => {
    const r = await runPromoteHighFit({ providers });
    expect(r.considered).toBe(2);
    expect(r.linked).toBe(1);
    expect(r.skipped).toBe(1);
    expect((await project("TABS2027000001")).businessId).not.toBeNull();
    expect((await project("TABS2027000002")).businessId).toBeNull();
    const s = await readSync(SYNC_KEYS.promoteBatch);
    expect(s.cursor.status).toBe("idle");
    expect(s.cursor.counts?.linked).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm test -- tests/unit/jobs/nameSimilarity
npm run test:db -- tests/db/promote
```

Expected: FAIL, module `@/lib/jobs/promote` not found.

- [ ] **Step 3: Implement promote.ts**

Create `src/lib/jobs/promote.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { normalizePhone } from "@/lib/extract/normalize";
import { suggestPackage } from "@/lib/scoring/packageMap";
import type { DiscoveredBusiness, Providers } from "@/lib/providers/types";
import type { Project } from "@prisma/client";
import { JobPausedError, normalizeName, recomputeContactQuality, scrapeOne, validateEmails, type ZipSearchDeps } from "./zipSearch";
import { readSync, SYNC_KEYS, writeSync } from "./syncStatus";

export type PromoteDeps = {
  providers: Providers;
  shouldPause?: () => Promise<boolean>;
  signal?: AbortSignal;
  log?: (msg: string) => void;
};

export type FindResult = { auto: DiscoveredBusiness | null; candidates: DiscoveredBusiness[] };

const HOUSTON_CENTER = { lat: 29.7604, lng: -95.3698 };
const SEARCH_RADIUS_M = 5000;

async function checkPause(deps: PromoteDeps) {
  if (deps.signal?.aborted) throw new JobPausedError();
  if (deps.shouldPause && (await deps.shouldPause())) throw new JobPausedError();
}

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

/** Jaccard similarity of name tokens after normalizeName (case, punctuation, LLC/Inc suffixes). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function displayName(p: Project): string {
  return p.facilityName?.trim() || p.projectName;
}

async function ownedProject(projectId: string, ownerId: string): Promise<Project> {
  const p = await prisma.project.findFirst({ where: { id: projectId, ownerId } });
  if (!p) throw new Error("Project not found");
  return p;
}

export async function findBusinessCandidates(projectId: string, ownerId: string, deps: PromoteDeps): Promise<FindResult> {
  const p = await ownedProject(projectId, ownerId);
  const name = displayName(p);
  const geo = p.zip ? await deps.providers.geocode.geocodeZip(p.zip) : null;
  const center = geo ? { lat: geo.lat, lng: geo.lng } : HOUSTON_CENTER;
  const query = [name, p.locationAddress, p.zip].filter(Boolean).join(" ");
  const results = await deps.providers.discovery.searchCategory(query, center, SEARCH_RADIUS_M, 5);
  const top = results[0];
  const auto =
    top && p.zip && top.zip === p.zip && nameSimilarity(name, top.name) >= PROJECT_CONFIG.autoLinkSimilarity ? top : null;
  return { auto, candidates: results.slice(0, 3) };
}

async function attachOwnerPhone(businessId: string, ownerId: string, p: Project) {
  const phone = p.ownerPhone ? normalizePhone(p.ownerPhone) : null;
  if (!phone) return;
  await prisma.contact.upsert({
    where: { businessId_type_value: { businessId, type: "phone", value: phone } },
    update: { personName: p.contactName ?? p.ownerName ?? undefined },
    create: {
      ownerId,
      businessId,
      type: "phone",
      value: phone,
      source: "tdlr",
      personName: p.contactName ?? p.ownerName ?? null,
      validationStatus: "valid",
      validatedAt: new Date(),
    },
  });
}

async function finishLink(businessId: string, ownerId: string, p: Project, how: string) {
  await prisma.project.update({ where: { id: p.id }, data: { businessId } });
  await attachOwnerPhone(businessId, ownerId, p);
  await prisma.activityLog.create({
    data: { ownerId, businessId, projectId: p.id, kind: "promoted", message: `${how} TDLR project ${p.projectNumber}` },
  });
  await recomputeContactQuality(businessId);
}

export async function linkProjectToPlace(projectId: string, ownerId: string, biz: DiscoveredBusiness): Promise<string> {
  const p = await ownedProject(projectId, ownerId);
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
  };
  const existing = await prisma.business.findUnique({ where: { ownerId_googlePlaceId: { ownerId, googlePlaceId: biz.placeId } } });
  const business = existing
    ? await prisma.business.update({ where: { id: existing.id }, data: googleFields })
    : await prisma.business.create({
        data: {
          ...googleFields,
          ownerId,
          googlePlaceId: biz.placeId,
          source: "tdlr",
          smbFitScore: p.smbFitScore,
          suggestedPackage: suggestPackage(null, p.workType),
        },
      });
  await finishLink(business.id, ownerId, p, existing ? "Linked existing business to" : "Created business from Google match for");
  return business.id;
}

export async function createBusinessFromProject(projectId: string, ownerId: string): Promise<string> {
  const p = await ownedProject(projectId, ownerId);
  if (p.businessId) return p.businessId;
  const cityLine = [p.city, p.state ?? "TX"].filter(Boolean).join(", ");
  const formattedAddress = [p.locationAddress, cityLine, p.zip].filter(Boolean).join(", ").replace(", " + p.zip, ` ${p.zip}`);
  const business = await prisma.business.create({
    data: {
      ownerId,
      name: displayName(p),
      formattedAddress: formattedAddress || null,
      zip: p.zip,
      source: "tdlr",
      exclusion: p.exclusion,
      exclusionReasons: p.exclusionReasons,
      smbFitScore: p.smbFitScore,
      suggestedPackage: suggestPackage(null, p.workType),
    },
  });
  await finishLink(business.id, ownerId, p, "Created business from");
  return business.id;
}

/** Scrape + validate + score one business (same steps as the zip search pipeline). */
export async function runPromoteBusiness(businessId: string, ownerId: string, deps: PromoteDeps): Promise<void> {
  const zdeps: ZipSearchDeps = { providers: deps.providers, shouldPause: deps.shouldPause, signal: deps.signal, log: deps.log };
  await scrapeOne(businessId, ownerId, zdeps);
  await validateEmails([businessId], zdeps);
  await recomputeContactQuality(businessId);
}

export async function runPromoteHighFit(deps: PromoteDeps) {
  const { id: ownerId } = await getActor();
  const counts = { considered: 0, linked: 0, skipped: 0 };
  const projects = await prisma.project.findMany({
    where: { ownerId, businessId: null, exclusion: "none", smbFitScore: { gte: PROJECT_CONFIG.highFitThreshold } },
    orderBy: [{ completionDate: { sort: "asc", nulls: "last" } }],
    select: { id: true, projectNumber: true },
  });
  const startedAt = new Date().toISOString();
  try {
    for (const p of projects) {
      await checkPause(deps);
      counts.considered++;
      await writeSync(SYNC_KEYS.promoteBatch, { status: "running", startedAt, current: counts.considered, total: projects.length, message: `Matching ${p.projectNumber}`, counts });
      const found = await findBusinessCandidates(p.id, ownerId, deps);
      if (!found.auto) {
        counts.skipped++;
        continue;
      }
      const businessId = await linkProjectToPlace(p.id, ownerId, found.auto);
      await runPromoteBusiness(businessId, ownerId, deps);
      counts.linked++;
    }
    await writeSync(SYNC_KEYS.promoteBatch, { status: "idle", finishedAt: new Date().toISOString(), counts, error: null }, new Date());
    return counts;
  } catch (e) {
    if (e instanceof JobPausedError) {
      await writeSync(SYNC_KEYS.promoteBatch, { status: "paused", message: "Paused", counts });
      return counts;
    }
    await writeSync(SYNC_KEYS.promoteBatch, { status: "failed", error: (e as Error).message ?? String(e), counts });
    throw e;
  }
}

export { readSync as readPromoteBatchStatus };
```

`formattedAddress` for the fake project resolves to `123 Fake St, Houston, TX 77084` (street, "City, ST", then the zip joined with a space). If `Prisma.SortOrderInput` (`{ sort, nulls }`) is rejected by the installed Prisma types, fall back to `orderBy: [{ completionDate: "asc" }]` and note it.

- [ ] **Step 4: Queue data, enqueue helpers, worker handlers**

In `src/lib/jobs/queues.ts` change `PromoteJobData` to:

```ts
export type PromoteJobData = { businessId: string; ownerId: string };
```

Append to `src/lib/jobs/enqueue.ts` (merge imports: `runPromoteBusiness`, `runPromoteHighFit` from `./promote`; `PromoteJobData`, `PromoteBatchJobData` from `./queues`):

```ts
export async function enqueuePromote(businessId: string, ownerId: string): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runPromoteBusiness(businessId, ownerId, { providers: getProviders(), log: console.log }).catch((e) =>
      console.error("[inline promote]", e),
    );
    return;
  }
  const boss = await getBoss();
  const data: PromoteJobData = { businessId, ownerId };
  await boss.send(QUEUES.promote, data, { retryLimit: 3, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: `promote:${businessId}` });
}

export async function enqueuePromoteBatch(): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runPromoteHighFit({ providers: getProviders(), log: console.log }).catch((e) => console.error("[inline promote-batch]", e));
    return;
  }
  const boss = await getBoss();
  const data: PromoteBatchJobData = {};
  await boss.send(QUEUES.promoteBatch, data, { retryLimit: 1, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: "promote-batch" });
}
```

In `src/worker/index.ts` add two handlers after the tdlr-sync one (imports: `runPromoteBusiness`, `runPromoteHighFit`; `PromoteJobData`, `PromoteBatchJobData`):

```ts
  await boss.work<PromoteJobData>(QUEUES.promote, { batchSize: 1 }, async ([job]) => {
    console.log(`[promote] start ${job.data.businessId}`);
    await runPromoteBusiness(job.data.businessId, job.data.ownerId, { providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[promote] done ${job.data.businessId}`);
  });

  await boss.work<PromoteBatchJobData>(QUEUES.promoteBatch, { batchSize: 1 }, async ([job]) => {
    console.log(`[promote-batch] start`);
    const r = await runPromoteHighFit({ providers: getProviders(), log: console.log, signal: job.signal });
    console.log(`[promote-batch] done ${JSON.stringify(r)}`);
  });
```

- [ ] **Step 5: Run, verify, commit**

```bash
npm test -- tests/unit/jobs/nameSimilarity
npm run test:db
npm test
npx tsc --noEmit
npm run lint
git add -A
git commit -m "feat: promote flow — match projects to places, link or create businesses, batch promote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: 3 unit + 4 DB tests pass; everything else still green.

---

### Task 5: Projects API — list, detail, find, promote, sync, batch

**Files:**
- Create: `src/lib/projects/filters.ts`, `src/lib/projects/queries.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/find/route.ts`, `src/app/api/projects/[id]/promote/route.ts`, `src/app/api/projects/sync/route.ts`, `src/app/api/projects/promote-high-fit/route.ts`, `tests/unit/projects/filters.test.ts`

**Interfaces:**
- Consumes: `handle`, `json`, `parseJson`, `ApiError`; `getActor`; `findBusinessCandidates`, `linkProjectToPlace`, `createBusinessFromProject`; `enqueuePromote`, `enqueuePromoteBatch`, `enqueueTdlrSync`; `readSync`, `SYNC_KEYS`; `getProviders`; `PROJECT_CONFIG`; `bandFor`.
- Produces:
  - `ProjectFilters = { q?: string; zip?: string; workType?: WorkType; timing?: TimingWindow; fit?: "high" | "medium" | "low"; linked?: boolean; showExcluded: boolean; page: number; pageSize: number; sort: "completion" | "fit" | "registered" }`; `parseProjectFilters(sp)`, `buildProjectWhere(f, ownerId)`, `buildProjectOrderBy(f)`
  - `projectInclude`, `ProjectRow` (Project with `business: { id, name, contactQualityBand, outreachStatus } | null`), `listProjects(f, ownerId)`, `getProjectDetail(id, ownerId)` (adds `activity`)
  - HTTP:
    - `GET /api/projects?<filters>` → `{ items: ProjectRow[], total, page, pageSize, syncRunning: boolean }`
    - `GET /api/projects/:id` → `{ project }`
    - `POST /api/projects/:id/find` → `{ linked: true, businessId, business: DiscoveredBusiness }` or `{ linked: false, candidates: DiscoveredBusiness[] }`
    - `POST /api/projects/:id/promote { placeId?: string; createFromProject?: boolean }` → `201 { businessId }`
    - `GET /api/projects/sync` → `{ lastSuccessfulAt, cursor, batch: { lastSuccessfulAt, cursor } }`; `POST /api/projects/sync` → `202 { queued: true }`
    - `POST /api/projects/promote-high-fit` → `202 { queued: true }`

- [ ] **Step 1: Write the failing filter test**

Create `tests/unit/projects/filters.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseProjectFilters, buildProjectWhere, buildProjectOrderBy } from "@/lib/projects/filters";

describe("project filters", () => {
  it("defaults hide excluded and sort by completion", () => {
    const f = parseProjectFilters(new URLSearchParams(""));
    expect(f).toMatchObject({ showExcluded: false, page: 1, pageSize: 50, sort: "completion" });
    expect(buildProjectWhere(f, "u1")).toEqual({ ownerId: "u1", exclusion: "none" });
    expect(buildProjectOrderBy(f)).toEqual([{ completionDate: { sort: "asc", nulls: "last" } }, { smbFitScore: "desc" }]);
  });
  it("applies every filter", () => {
    const f = parseProjectFilters(new URLSearchParams("q=nails&zip=77084&workType=renovation&timing=opening_soon&fit=high&linked=false&showExcluded=true&sort=fit"));
    expect(buildProjectWhere(f, "u1")).toEqual({
      ownerId: "u1",
      OR: [{ projectName: { contains: "nails", mode: "insensitive" } }, { facilityName: { contains: "nails", mode: "insensitive" } }],
      zip: "77084",
      workType: "renovation",
      timingWindow: "opening_soon",
      smbFitScore: { gte: 60 },
      businessId: null,
    });
    expect(buildProjectOrderBy(f)).toEqual([{ smbFitScore: "desc" }, { completionDate: { sort: "asc", nulls: "last" } }]);
    expect(buildProjectWhere(parseProjectFilters(new URLSearchParams("fit=medium&linked=true")), "u1")).toMatchObject({
      smbFitScore: { gte: 30, lt: 60 },
      businessId: { not: null },
    });
    expect(buildProjectWhere(parseProjectFilters(new URLSearchParams("fit=low")), "u1")).toMatchObject({ smbFitScore: { lt: 30 } });
  });
  it("rejects bad enums", () => {
    expect(() => parseProjectFilters(new URLSearchParams("timing=soon"))).toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
npm test -- tests/unit/projects
```

- [ ] **Step 3: Implement filters and queries**

Create `src/lib/projects/filters.ts`:

```ts
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");
const optBool = z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true"));

export const projectFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  zip: z.string().regex(/^\d{5}$/).optional(),
  workType: z.enum(["new_construction", "renovation", "addition", "historic", "row"]).optional(),
  timing: z.enum(["opening_soon", "under_construction", "planned", "just_completed", "stale"]).optional(),
  fit: z.enum(["high", "medium", "low"]).optional(),
  linked: optBool,
  showExcluded: bool,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["completion", "fit", "registered"]).default("completion"),
});

export type ProjectFilters = z.infer<typeof projectFiltersSchema>;

export function parseProjectFilters(sp: URLSearchParams): ProjectFilters {
  const raw: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (v !== "") raw[k] = v;
  });
  return projectFiltersSchema.parse(raw);
}

export function buildProjectWhere(f: ProjectFilters, ownerId: string): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = { ownerId };
  if (!f.showExcluded) where.exclusion = "none";
  if (f.q) {
    where.OR = [
      { projectName: { contains: f.q, mode: "insensitive" } },
      { facilityName: { contains: f.q, mode: "insensitive" } },
    ];
  }
  if (f.zip) where.zip = f.zip;
  if (f.workType) where.workType = f.workType;
  if (f.timing) where.timingWindow = f.timing;
  if (f.fit === "high") where.smbFitScore = { gte: 60 };
  if (f.fit === "medium") where.smbFitScore = { gte: 30, lt: 60 };
  if (f.fit === "low") where.smbFitScore = { lt: 30 };
  if (f.linked === true) where.businessId = { not: null };
  if (f.linked === false) where.businessId = null;
  return where;
}

const byCompletion: Prisma.ProjectOrderByWithRelationInput = { completionDate: { sort: "asc", nulls: "last" } };

export function buildProjectOrderBy(f: ProjectFilters): Prisma.ProjectOrderByWithRelationInput[] {
  switch (f.sort) {
    case "fit":
      return [{ smbFitScore: "desc" }, byCompletion];
    case "registered":
      return [{ registrationDate: "desc" }];
    default:
      return [byCompletion, { smbFitScore: "desc" }];
  }
}
```

Create `src/lib/projects/queries.ts`:

```ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { buildProjectOrderBy, buildProjectWhere, type ProjectFilters } from "./filters";

export const projectInclude = {
  business: { select: { id: true, name: true, contactQualityBand: true, outreachStatus: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

export async function listProjects(f: ProjectFilters, ownerId: string) {
  const where = buildProjectWhere(f, ownerId);
  const [items, total] = await Promise.all([
    prisma.project.findMany({ where, include: projectInclude, orderBy: buildProjectOrderBy(f), skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.project.count({ where }),
  ]);
  return { items, total };
}

export async function getProjectDetail(id: string, ownerId: string) {
  return prisma.project.findFirst({
    where: { id, ownerId },
    include: { ...projectInclude, activity: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}
```

- [ ] **Step 4: Implement the routes**

Create `src/app/api/projects/route.ts`:

```ts
import { getActor } from "@/lib/actor";
import { handle, json } from "@/lib/api";
import { parseProjectFilters } from "@/lib/projects/filters";
import { listProjects } from "@/lib/projects/queries";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async (req) => {
  const actor = await getActor();
  const f = parseProjectFilters(req.nextUrl.searchParams);
  const [{ items, total }, sync, batch] = await Promise.all([listProjects(f, actor.id), readSync(SYNC_KEYS.tdlr), readSync(SYNC_KEYS.promoteBatch)]);
  const syncRunning = sync.cursor.status === "running" || batch.cursor.status === "running";
  return json({ items, total, page: f.page, pageSize: f.pageSize, syncRunning });
});
```

Create `src/app/api/projects/[id]/route.ts`:

```ts
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { getProjectDetail } from "@/lib/projects/queries";

export const GET = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const project = await getProjectDetail(id, actor.id);
  if (!project) throw new ApiError(404, "Project not found");
  return json({ project });
});
```

Create `src/app/api/projects/[id]/find/route.ts`:

```ts
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json } from "@/lib/api";
import { findBusinessCandidates, linkProjectToPlace } from "@/lib/jobs/promote";
import { enqueuePromote } from "@/lib/jobs/enqueue";
import { getProviders } from "@/lib/providers";

export const POST = handle(async (_req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const project = await prisma.project.findFirst({ where: { id, ownerId: actor.id } });
  if (!project) throw new ApiError(404, "Project not found");
  if (project.businessId) return json({ linked: true, businessId: project.businessId, business: null });

  const found = await findBusinessCandidates(id, actor.id, { providers: getProviders() });
  if (found.auto) {
    const businessId = await linkProjectToPlace(id, actor.id, found.auto);
    await enqueuePromote(businessId, actor.id);
    return json({ linked: true, businessId, business: found.auto });
  }
  return json({ linked: false, candidates: found.candidates });
});
```

Create `src/app/api/projects/[id]/promote/route.ts`:

```ts
import { z } from "zod";
import { getActor } from "@/lib/actor";
import { ApiError, handle, json, parseJson } from "@/lib/api";
import { createBusinessFromProject, findBusinessCandidates, linkProjectToPlace } from "@/lib/jobs/promote";
import { enqueuePromote } from "@/lib/jobs/enqueue";
import { getProviders } from "@/lib/providers";

const schema = z.object({ placeId: z.string().min(1).optional(), createFromProject: z.boolean().optional() })
  .refine((b) => !!b.placeId !== !!b.createFromProject, { message: "Provide exactly one of placeId or createFromProject" });

export const POST = handle(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await getActor();
  const body = await parseJson(req, schema);

  let businessId: string;
  if (body.createFromProject) {
    businessId = await createBusinessFromProject(id, actor.id);
  } else {
    const found = await findBusinessCandidates(id, actor.id, { providers: getProviders() });
    const pick = [found.auto, ...found.candidates].find((c) => c?.placeId === body.placeId);
    if (!pick) throw new ApiError(404, "Candidate not found; run find again");
    businessId = await linkProjectToPlace(id, actor.id, pick);
  }
  await enqueuePromote(businessId, actor.id);
  return json({ businessId }, 201);
});
```

If `findBusinessCandidates` throws `Error("Project not found")` for a foreign id, `handle()` returns 500; make `ownedProject` in `promote.ts` throw `new ApiError(404, "Project not found")` instead (import `ApiError` from `@/lib/api`) so both routes answer 404. Do that edit in this task.

Create `src/app/api/projects/sync/route.ts`:

```ts
import { handle, json } from "@/lib/api";
import { enqueueTdlrSync } from "@/lib/jobs/enqueue";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const GET = handle(async () => {
  const [tdlr, batch] = await Promise.all([readSync(SYNC_KEYS.tdlr), readSync(SYNC_KEYS.promoteBatch)]);
  return json({ lastSuccessfulAt: tdlr.lastSuccessfulAt, cursor: tdlr.cursor, batch });
});

export const POST = handle(async () => {
  const { cursor } = await readSync(SYNC_KEYS.tdlr);
  if (cursor.status === "running") return json({ queued: false, reason: "already running" }, 409);
  await enqueueTdlrSync();
  return json({ queued: true }, 202);
});
```

Create `src/app/api/projects/promote-high-fit/route.ts`:

```ts
import { handle, json } from "@/lib/api";
import { enqueuePromoteBatch } from "@/lib/jobs/enqueue";
import { readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

export const POST = handle(async () => {
  const { cursor } = await readSync(SYNC_KEYS.promoteBatch);
  if (cursor.status === "running") return json({ queued: false, reason: "already running" }, 409);
  await enqueuePromoteBatch();
  return json({ queued: true }, 202);
});
```

`SyncState` has no owner column (spec: global), so the sync routes need no owner scoping; the project routes are owner-scoped through `findFirst({ id, ownerId })` and `listProjects`.

- [ ] **Step 5: Verify with curl and commit**

Start the worker and dev server in the background (Node 22 PATH, stop by PID afterwards). With a session cookie:

```bash
MSYS_NO_PATHCONV=1 curl -s -c cookies.txt -o /dev/null -X POST --data-raw "passphrase=change-me&next=/" http://localhost:3000/api/unlock
curl -s -b cookies.txt -X POST http://localhost:3000/api/projects/sync            # 202
sleep 5; curl -s -b cookies.txt "http://localhost:3000/api/projects/sync"         # cursor.status idle, counts
curl -s -b cookies.txt "http://localhost:3000/api/projects?fit=high" | head -c 600  # Bella + Corner Cafe (fake mode)
ID=$(curl -s -b cookies.txt "http://localhost:3000/api/projects?q=bella" | python -c "import sys,json;print(json.load(sys.stdin)['items'][0]['id'])")
curl -s -b cookies.txt -X POST "http://localhost:3000/api/projects/$ID/find"     # linked: true
curl -s -b cookies.txt "http://localhost:3000/api/projects?showExcluded=true&q=memorial" | head -c 300
```

Then:

```bash
npm test && npm run test:db && npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat: projects API — list, detail, find/promote, sync and batch triggers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Projects page — badges, filters, table, drawer, find-business dialog, sync bar

**Files:**
- Create: `src/components/projects/TimingBadge.tsx`, `src/components/projects/FitBadge.tsx`, `src/components/projects/ProjectFilters.tsx`, `src/components/projects/ProjectsTable.tsx`, `src/components/projects/ProjectDrawer.tsx`, `src/components/projects/FindBusinessDialog.tsx`, `src/components/projects/SyncBar.tsx`, `src/components/projects/ProjectsView.tsx`
- Modify: `src/app/projects/page.tsx`

**Interfaces:**
- Consumes: `GET /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/find`, `POST /api/projects/:id/promote`, `GET/POST /api/projects/sync`, `POST /api/projects/promote-high-fit`; `useLeadFilters` from `@/components/leads/useLeadFilters` (it is URL-generic; reuse it as the project filter hook); `ProjectRow`; `formatDate`, `timeAgo`, `titleCase`; `bandFor` from `@/lib/scoring/smbFit`; shadcn `button, badge, input, label, select, checkbox, sheet, table, dialog, separator`.
- Produces: `<TimingBadge window />`, `<FitBadge score />`, `<ProjectsView />`, `<SyncBar />`, `<FindBusinessDialog projectId open onOpenChange onDone />`.
- Base UI rules apply (`render`, `nativeButton={false}`, `Select items`, null guard on `onValueChange`). Check `src/components/ui/dialog.tsx` for its exact exports (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` are expected) and adapt names if they differ.

- [ ] **Step 1: Badges**

Create `src/components/projects/TimingBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const STYLES: Record<string, string> = {
  opening_soon: "bg-emerald-100 text-emerald-800",
  under_construction: "bg-blue-100 text-blue-800",
  planned: "bg-neutral-200 text-neutral-800",
  just_completed: "bg-amber-100 text-amber-800",
  stale: "bg-neutral-100 text-neutral-500",
};
const LABELS: Record<string, string> = {
  opening_soon: "Opening soon",
  under_construction: "Under construction",
  planned: "Planned",
  just_completed: "Just completed",
  stale: "Stale",
};

export function TimingBadge({ window }: { window: string | null | undefined }) {
  if (!window) return <span className="text-xs text-neutral-400">—</span>;
  return <Badge className={`${STYLES[window] ?? ""} border-0`}>{LABELS[window] ?? window}</Badge>;
}
```

Create `src/components/projects/FitBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { bandFor } from "@/lib/scoring/smbFit";

const STYLES = { high: "bg-emerald-100 text-emerald-800", medium: "bg-amber-100 text-amber-800", low: "bg-neutral-200 text-neutral-700" } as const;

export function FitBadge({ score, excluded }: { score: number; excluded?: boolean }) {
  if (excluded) return <Badge className="border-0 bg-red-100 text-red-800">Excluded</Badge>;
  const band = bandFor(score);
  return (
    <Badge className={`${STYLES[band]} border-0 capitalize`} title={`SMB fit ${score}`}>
      {band} · {score}
    </Badge>
  );
}
```

- [ ] **Step 2: Filters**

Create `src/components/projects/ProjectFilters.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLeadFilters } from "@/components/leads/useLeadFilters";
import { titleCase } from "@/lib/format";

const ANY = "__any";
type Opt = { value: string; label: string };

function Choice({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string | null) => void; options: Opt[] }) {
  const items = [{ value: ANY, label: "Any" }, ...options];
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY || v == null ? null : v)} items={items}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

const WORK_TYPES = ["new_construction", "renovation", "addition", "historic", "row"];
const TIMINGS = ["opening_soon", "under_construction", "planned", "just_completed", "stale"];

export function ProjectFilters() {
  const { params, set, reset } = useLeadFilters();
  const [q, setQ] = useState(params.get("q") ?? "");
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      set("q", q || null);
      dirty.current = false;
    }, 300);
    return () => clearTimeout(t);
  }, [q, set]);
  useEffect(() => {
    if (!dirty.current) setQ(params.get("q") ?? "");
  }, [params]);

  return (
    <div className="space-y-4" data-testid="project-filters">
      <div className="space-y-1">
        <Label htmlFor="pf-q">Search</Label>
        <Input id="pf-q" value={q} onChange={(e) => { dirty.current = true; setQ(e.target.value); }} placeholder="Project or facility name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pf-zip">Zip</Label>
        <Input id="pf-zip" defaultValue={params.get("zip") ?? ""} inputMode="numeric" maxLength={5}
          onBlur={(e) => set("zip", /^\d{5}$/.test(e.target.value) ? e.target.value : null)} />
      </div>
      <Choice id="pf-timing" label="Timing" value={params.get("timing") ?? ""} onChange={(v) => set("timing", v)}
        options={TIMINGS.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-fit" label="SMB fit" value={params.get("fit") ?? ""} onChange={(v) => set("fit", v)}
        options={["high", "medium", "low"].map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-work" label="Work type" value={params.get("workType") ?? ""} onChange={(v) => set("workType", v)}
        options={WORK_TYPES.map((v) => ({ value: v, label: titleCase(v) }))} />
      <Choice id="pf-linked" label="Linked to a lead" value={params.get("linked") ?? ""} onChange={(v) => set("linked", v)}
        options={[{ value: "true", label: "Linked" }, { value: "false", label: "Not linked" }]} />
      <Choice id="pf-sort" label="Sort" value={params.get("sort") ?? ""} onChange={(v) => set("sort", v)}
        options={[{ value: "completion", label: "Soonest completion" }, { value: "fit", label: "SMB fit" }, { value: "registered", label: "Recently registered" }]} />
      <div className="flex items-center gap-2">
        <Checkbox id="pf-excluded" checked={params.get("showExcluded") === "true"} onCheckedChange={(c) => set("showExcluded", c ? "true" : null)} />
        <Label htmlFor="pf-excluded">Show excluded (enterprise)</Label>
      </div>
      <Button variant="outline" size="sm" onClick={() => { dirty.current = false; setQ(""); reset(); }}>Clear filters</Button>
    </div>
  );
}
```

- [ ] **Step 3: Table and drawer**

Create `src/components/projects/ProjectsTable.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { ProjectRow } from "@/lib/projects/queries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate, titleCase } from "@/lib/format";
import { TimingBadge } from "./TimingBadge";
import { FitBadge } from "./FitBadge";

const money = (n: number | null) => (n == null ? "" : `$${Math.round(n).toLocaleString()}`);

type Props = { rows: ProjectRow[]; onOpen: (id: string) => void; onFind: (id: string) => void };

function rowKeys(onOpen: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } },
  };
}

export function ProjectsTable({ rows, onOpen, onFind }: Props) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block dark:bg-neutral-900">
        <Table data-testid="projects-table">
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Zip</TableHead>
              <TableHead>Work</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Completes</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead>SMB fit</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} className="cursor-pointer" onClick={() => onOpen(p.id)} {...rowKeys(() => onOpen(p.id))} data-testid="project-row">
                <TableCell>
                  <div className="font-medium">{p.facilityName || p.projectName}</div>
                  {p.facilityName && p.facilityName !== p.projectName && <div className="text-xs text-neutral-500">{p.projectName}</div>}
                </TableCell>
                <TableCell>{p.zip}</TableCell>
                <TableCell className="text-sm">{titleCase(p.workType)}</TableCell>
                <TableCell className="text-sm tabular-nums">{money(p.estimatedCost)}</TableCell>
                <TableCell className="text-sm">{formatDate(p.completionDate)}</TableCell>
                <TableCell><TimingBadge window={p.timingWindow} /></TableCell>
                <TableCell><FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} /></TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {p.business ? (
                    <Link href={`/leads/${p.business.id}`} className="text-sm text-blue-600 hover:underline">{p.business.name}</Link>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {!p.business && p.exclusion === "none" && (
                    <Button size="sm" variant="outline" onClick={() => onFind(p.id)} data-testid="find-business">Find business</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-2 md:hidden" data-testid="projects-cards">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border bg-white p-3 dark:bg-neutral-900" onClick={() => onOpen(p.id)} {...rowKeys(() => onOpen(p.id))}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{p.facilityName || p.projectName}</div>
                <div className="text-xs text-neutral-500">{p.zip} · {titleCase(p.workType)} · {money(p.estimatedCost)}</div>
              </div>
              <FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TimingBadge window={p.timingWindow} />
              <span className="text-xs text-neutral-500">completes {formatDate(p.completionDate)}</span>
              {p.business && <Link href={`/leads/${p.business.id}`} onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600">Lead: {p.business.name}</Link>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
```

Create `src/components/projects/ProjectDrawer.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDate, timeAgo, titleCase } from "@/lib/format";
import { TimingBadge } from "./TimingBadge";
import { FitBadge } from "./FitBadge";

type Detail = {
  id: string; projectNumber: string; projectName: string; facilityName: string | null; locationAddress: string | null; city: string | null; zip: string | null; county: string | null;
  statusLabel: string | null; workType: string | null; estimatedCost: number | null; squareFootage: number | null; tenantFunded: boolean | null; fundsType: string | null; scopeOfWork: string | null;
  startDate: string | null; completionDate: string | null; registrationDate: string | null; ownerName: string | null; ownerAddress: string | null; ownerPhone: string | null; contactName: string | null;
  tenantName: string | null; designFirmName: string | null; rasName: string | null; smbFitScore: number; smbFitReasons: { code: string; points: number; detail: string }[] | null;
  exclusion: string; exclusionReasons: string[]; timingWindow: string | null;
  business: { id: string; name: string; contactQualityBand: string; outreachStatus: string } | null;
  activity: { id: string; kind: string; message: string; createdAt: string }[];
};

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

export function ProjectDrawer({ id, onClose, onFind }: { id: string | null; onClose: () => void; onFind: (id: string) => void }) {
  const [p, setP] = useState<Detail | null>(null);

  useEffect(() => {
    if (!id) return;
    setP(null);
    fetch(`/api/projects/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => setP(d.project))
      .catch(() => toast.error("Could not load project"));
  }, [id]);

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="sr-only">Project detail</SheetTitle>
        {!p ? <p className="text-sm text-neutral-500">Loading…</p> : (
          <div className="space-y-4" data-testid="project-detail">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">{p.facilityName || p.projectName}</h2>
                <FitBadge score={p.smbFitScore} excluded={p.exclusion !== "none"} />
                <TimingBadge window={p.timingWindow} />
              </div>
              <p className="text-sm text-neutral-500">{p.projectName} · {p.projectNumber} · {p.statusLabel}</p>
              <p className="text-sm">{[p.locationAddress, p.city, p.zip].filter(Boolean).join(", ")}{p.county ? ` (${p.county} County)` : ""}</p>
              {p.exclusion !== "none" && <p className="mt-1 text-xs text-red-600">Excluded: {p.exclusionReasons.join(", ")}</p>}
            </div>
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-neutral-500">Work type</dt><dd>{titleCase(p.workType)}</dd>
              <dt className="text-neutral-500">Estimated cost</dt><dd>{money(p.estimatedCost)}</dd>
              <dt className="text-neutral-500">Square feet</dt><dd>{p.squareFootage?.toLocaleString() ?? "—"}</dd>
              <dt className="text-neutral-500">Tenant funded</dt><dd>{p.tenantFunded == null ? "—" : p.tenantFunded ? "Yes" : "No"}</dd>
              <dt className="text-neutral-500">Start</dt><dd>{formatDate(p.startDate) || "—"}</dd>
              <dt className="text-neutral-500">Completion</dt><dd>{formatDate(p.completionDate) || "—"}</dd>
              <dt className="text-neutral-500">Registered</dt><dd>{formatDate(p.registrationDate) || "—"}</dd>
            </dl>
            {p.scopeOfWork && <p className="text-sm"><span className="text-neutral-500">Scope:</span> {p.scopeOfWork}</p>}
            {p.smbFitReasons && p.smbFitReasons.length > 0 && (
              <p className="text-xs text-neutral-500">Fit: {p.smbFitReasons.map((r) => `${r.detail} (${r.points > 0 ? "+" : ""}${r.points})`).join(", ")}</p>
            )}
            <Separator />
            <section className="space-y-1 text-sm">
              <h3 className="font-medium">People</h3>
              {p.ownerName && <p>Owner: {p.ownerName}{p.ownerPhone ? ` · ${p.ownerPhone}` : ""}</p>}
              {p.contactName && p.contactName !== p.ownerName && <p>Contact: {p.contactName}</p>}
              {p.tenantName && <p>Tenant: {p.tenantName}</p>}
              {p.designFirmName && <p>Design firm: {p.designFirmName}</p>}
              {p.rasName && <p className="text-neutral-500">RAS: {p.rasName}</p>}
            </section>
            <Separator />
            <section className="space-y-2">
              <h3 className="font-medium">Lead</h3>
              {p.business ? (
                <p className="text-sm">
                  Linked to <Link href={`/leads/${p.business.id}`} className="text-blue-600 hover:underline">{p.business.name}</Link>
                  {" "}· {titleCase(p.business.outreachStatus)} · quality {p.business.contactQualityBand}
                </p>
              ) : p.exclusion === "none" ? (
                <Button size="sm" onClick={() => onFind(p.id)} data-testid="drawer-find-business">Find business</Button>
              ) : (
                <p className="text-sm text-neutral-500">Excluded projects are not promoted.</p>
              )}
            </section>
            <Separator />
            <section>
              <h3 className="font-medium">Activity</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {p.activity.map((a) => <li key={a.id} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-neutral-400">{timeAgo(a.createdAt)}</span><span>{a.message}</span></li>)}
                {p.activity.length === 0 && <li className="text-neutral-500">No activity yet.</li>}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Find-business dialog and sync bar**

Create `src/components/projects/FindBusinessDialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Candidate = { placeId: string; name: string; formattedAddress: string | null; zip: string | null; websiteUrl: string | null; rating: number | null };
type State = { phase: "searching" } | { phase: "linked"; businessId: string } | { phase: "choose"; candidates: Candidate[] } | { phase: "error"; message: string };

export function FindBusinessDialog({ projectId, open, onOpenChange, onDone }: { projectId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onDone: (businessId: string) => void }) {
  const [state, setState] = useState<State>({ phase: "searching" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    setState({ phase: "searching" });
    fetch(`/api/projects/${projectId}/find`, { method: "POST" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Find failed");
        if (d.linked) {
          toast.success("Linked to a Google listing; gathering contacts");
          setState({ phase: "linked", businessId: d.businessId });
          onDone(d.businessId);
          onOpenChange(false);
        } else {
          setState({ phase: "choose", candidates: d.candidates });
        }
      })
      .catch((e) => setState({ phase: "error", message: (e as Error).message }));
  }, [open, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function promote(body: { placeId?: string; createFromProject?: boolean }) {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/promote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Promote failed");
      toast.success(body.createFromProject ? "Lead created from project" : "Linked; gathering contacts");
      onDone(d.businessId);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="find-dialog">
        <DialogHeader>
          <DialogTitle>Find this business on Google</DialogTitle>
          <DialogDescription>Match the project to a Google listing so contacts can be gathered, or create a lead from the project details.</DialogDescription>
        </DialogHeader>
        {state.phase === "searching" && <p className="text-sm text-neutral-500">Searching…</p>}
        {state.phase === "error" && <p className="text-sm text-red-600">{state.message}</p>}
        {state.phase === "choose" && (
          <ul className="space-y-2">
            {state.candidates.length === 0 && <li className="text-sm text-neutral-500">No Google listing found yet. Businesses that have not opened often have none.</li>}
            {state.candidates.map((c) => (
              <li key={c.placeId} className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                <div>
                  <div className="font-medium">{c.name}{c.rating != null ? <span className="ml-1 text-xs text-neutral-500">★ {c.rating}</span> : null}</div>
                  <div className="text-xs text-neutral-500">{c.formattedAddress}</div>
                </div>
                <Button size="sm" disabled={busy} onClick={() => promote({ placeId: c.placeId })}>Link</Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          {state.phase === "choose" && (
            <Button variant="outline" disabled={busy} onClick={() => promote({ createFromProject: true })} data-testid="create-from-project">Create lead from project</Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Create `src/components/projects/SyncBar.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";

type Cursor = { status: string; message?: string; current?: number; total?: number; error?: string | null; counts?: Record<string, number> };
type Status = { lastSuccessfulAt: string | null; cursor: Cursor; batch: { lastSuccessfulAt: string | null; cursor: Cursor } };

export function SyncBar({ onActivity }: { onActivity: (running: boolean) => void }) {
  const [s, setS] = useState<Status | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/projects/sync", { cache: "no-store" });
    if (r.ok) setS(await r.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const running = s?.cursor.status === "running" || s?.batch.cursor.status === "running";
  useEffect(() => {
    onActivity(!!running);
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load, onActivity]);

  async function post(url: string, label: string) {
    const r = await fetch(url, { method: "POST" });
    if (r.status === 409) return toast.info(`${label} is already running`);
    if (!r.ok) return toast.error(`${label} failed to start`);
    toast.success(`${label} started`);
    setTimeout(load, 500);
  }

  const c = s?.cursor;
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 text-sm md:flex-row md:items-center md:justify-between dark:bg-neutral-900" data-testid="sync-bar">
      <div>
        <span className="font-medium">TDLR sync:</span>{" "}
        {c?.status === "running" ? (
          <span>{c.message ?? "running"}{c.total ? ` (${c.current ?? 0}/${c.total})` : ""}</span>
        ) : c?.status === "failed" ? (
          <span className="text-red-600">failed — {c.error}</span>
        ) : (
          <span className="text-neutral-500">{s?.lastSuccessfulAt ? `last synced ${timeAgo(s.lastSuccessfulAt)}` : "never synced"}{c?.counts ? ` · ${c.counts.created ?? 0} new` : ""}</span>
        )}
        {s?.batch.cursor.status === "running" && <span className="ml-3 text-blue-700">Promoting high-fit projects {s.batch.cursor.current ?? 0}/{s.batch.cursor.total ?? 0}…</span>}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!!running} onClick={() => post("/api/projects/sync", "Sync")} data-testid="sync-now">Sync now</Button>
        <Button size="sm" disabled={!!running} onClick={() => post("/api/projects/promote-high-fit", "Batch promote")} data-testid="promote-high-fit">Promote high-fit</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: View and page**

Create `src/components/projects/ProjectsView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ProjectRow } from "@/lib/projects/queries";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useLeadFilters } from "@/components/leads/useLeadFilters";
import { ProjectFilters } from "./ProjectFilters";
import { ProjectsTable } from "./ProjectsTable";
import { ProjectDrawer } from "./ProjectDrawer";
import { FindBusinessDialog } from "./FindBusinessDialog";
import { SyncBar } from "./SyncBar";

type ListResponse = { items: ProjectRow[]; total: number; page: number; pageSize: number; syncRunning: boolean };

export function ProjectsView() {
  const { params, set } = useLeadFilters();
  const [data, setData] = useState<ListResponse | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [findId, setFindId] = useState<string | null>(null);
  const [syncActive, setSyncActive] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects?${params.toString()}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!syncActive && !data?.syncRunning) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [syncActive, data?.syncRunning, load]);

  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <SyncBar onActivity={setSyncActive} />
      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="hidden w-64 shrink-0 md:block">
          <div className="sticky top-20 rounded-lg border bg-white p-4 dark:bg-neutral-900"><ProjectFilters /></div>
        </aside>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-neutral-500" data-testid="projects-count">{data ? `${data.total} project${data.total === 1 ? "" : "s"}` : "Loading…"}</div>
            <Sheet>
              <SheetTrigger render={<Button variant="outline" size="sm" className="md:hidden" />}><SlidersHorizontal className="mr-1 h-4 w-4" />Filters</SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
                <SheetTitle className="mb-3">Filters</SheetTitle>
                <ProjectFilters />
              </SheetContent>
            </Sheet>
          </div>
          {data && data.items.length === 0 && <p className="text-sm text-neutral-500">No projects match. Run a sync to pull Houston projects from TDLR.</p>}
          {data && data.items.length > 0 && <ProjectsTable rows={data.items} onOpen={setOpenId} onFind={setFindId} />}
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
              <span>Page {page} of {pages}</span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
            </div>
          )}
        </div>
      </div>
      <ProjectDrawer id={openId} onClose={() => setOpenId(null)} onFind={(id) => { setOpenId(null); setFindId(id); }} />
      <FindBusinessDialog projectId={findId} open={!!findId} onOpenChange={(o) => { if (!o) setFindId(null); }} onDone={() => load()} />
    </div>
  );
}
```

Replace `src/app/projects/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { ProjectsView } from "@/components/projects/ProjectsView";

export default function ProjectsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-neutral-500">Houston construction and renovation projects from the TDLR registry, scored for SMB fit and timing.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <ProjectsView />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run `npm run lint`, `npx tsc --noEmit`, `npm test`. Start the dev server and worker; in the in-app browser: open /projects, click "Sync now", watch the bar go running then idle, see three projects (fake mode) with Memorial Hermann hidden until "Show excluded"; click "Find business" on Bella Nails → toast "Linked…", the row now shows a lead link; on Corner Cafe → dialog shows candidates and "Create lead from project" creates a lead; open a row → drawer shows details; resize to mobile → cards and bottom-sheet filters. Stop servers by PID. Commit:

```bash
git add -A
git commit -m "feat: Projects page with sync bar, filters, table, drawer, and find-business dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Leads integration — timing column and filter from linked projects

**Files:**
- Modify: `src/lib/leads/filters.ts`, `src/lib/leads/queries.ts`, `src/components/leads/LeadsTable.tsx`, `src/components/leads/LeadFilters.tsx`, `tests/unit/leads/filters.test.ts`

**Interfaces:**
- Produces: `LeadFilters.timing?: TimingWindow`; `leadInclude.projects: { select: { id, timingWindow, completionDate } }` so `LeadRow.projects` exists; a "Timing" column in the leads table; a Timing select in the filters.

- [ ] **Step 1: Extend the failing filter test**

Add to `tests/unit/leads/filters.test.ts` inside `describe("buildBusinessWhere")`:

```ts
  it("filters by a linked project's timing window", () => {
    const w = buildBusinessWhere(parseLeadFilters(new URLSearchParams("timing=opening_soon")), "u1");
    expect(w).toEqual({ ownerId: "u1", exclusion: "none", projects: { some: { timingWindow: "opening_soon" } } });
    expect(() => parseLeadFilters(new URLSearchParams("timing=never"))).toThrow();
  });
```

Run `npm test -- tests/unit/leads/filters` — expect the new case to FAIL.

- [ ] **Step 2: Implement**

In `src/lib/leads/filters.ts` add to the schema after `product`:

```ts
  timing: z.enum(["opening_soon", "under_construction", "planned", "just_completed", "stale"]).optional(),
```

and in `buildBusinessWhere` after the `searchId` line:

```ts
  if (f.timing) where.projects = { some: { timingWindow: f.timing } };
```

In `src/lib/leads/queries.ts` add to `leadInclude`:

```ts
  projects: { select: { id: true, timingWindow: true, completionDate: true }, orderBy: { completionDate: "asc" as const }, take: 1 },
```

In `src/components/leads/LeadsTable.tsx`: import `TimingBadge` from `@/components/projects/TimingBadge`; add `<TableHead>Timing</TableHead>` after the Source column header and `<TableCell><TimingBadge window={b.projects?.[0]?.timingWindow} /></TableCell>` in the same position in each row; in the mobile card badge row add `{b.projects?.[0]?.timingWindow && <TimingBadge window={b.projects[0].timingWindow} />}`.

In `src/components/leads/LeadFilters.tsx` add a `Choice` after the Product one:

```tsx
      <Choice id="f-timing" label="Project timing" value={params.get("timing") ?? ""} onChange={(v) => set("timing", v)}
        options={["opening_soon", "under_construction", "planned", "just_completed", "stale"].map((v) => ({ value: v, label: titleCase(v) }))} />
```

The CSV export needs no change (the `LeadRow` gains `projects`, which `businessesToCsv` ignores). If `tests/unit/leads/csv.test.ts`'s `as never` cast objects need a `projects: []` field for TypeScript, add it.

- [ ] **Step 3: Verify and commit**

```bash
npm test -- tests/unit/leads
npx tsc --noEmit && npm run lint && npm test
```

With servers running: after promoting Bella Nails from the Projects page, /leads shows a green "Opening soon" badge on that row, and `?timing=opening_soon` filters to it. Stop servers by PID.

```bash
git add -A
git commit -m "feat: leads timing column and filter from linked TDLR projects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Playwright projects flow and GitHub Actions CI

**Files:**
- Create: `tests/e2e/projects.spec.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: fake providers (`FAKE_PROJECTS`), `JOB_MODE=inline` (sync and promote run inside the web process), `data-testid`s from Task 6.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/projects.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { unlock } from "./helpers";

test.describe.configure({ mode: "serial" });

test("sync pulls Houston projects and hides excluded ones by default", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-bar")).toContainText(/last synced|new/, { timeout: 30_000 });
  await expect(page.getByTestId("project-row")).toHaveCount(2);
  await expect(page.getByText("Bella Nails & Spa")).toBeVisible();
  await expect(page.getByText("Memorial Hermann")).toHaveCount(0);
  await page.getByLabel("Show excluded (enterprise)").check();
  await expect(page.getByText("Memorial Hermann").first()).toBeVisible();
});

test("find business auto-links a confident match and the lead shows project timing", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects?q=bella");
  await page.getByTestId("find-business").first().click();
  await expect(page.getByText(/Linked to a Google listing/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Bella Nails & Spa" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/leads?source=tdlr");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
  await expect(page.getByText("Opening soon")).toBeVisible();
});

test("weak match offers candidates and can create a lead from the project", async ({ page }) => {
  await unlock(page);
  await page.goto("/projects?q=corner");
  await page.getByTestId("find-business").first().click();
  await expect(page.getByTestId("find-dialog")).toBeVisible();
  await page.getByTestId("create-from-project").click();
  await expect(page.getByText("Lead created from project")).toBeVisible();
  await page.goto("/leads?source=tdlr&q=corner");
  await expect(page.getByTestId("leads-count")).toContainText("1 lead");
});
```

`tests/e2e/global-setup.ts` already clears `project` and `syncState` in its `deleteMany` list (verify; add them if missing). Run:

```bash
npm run test:e2e
```

Expected: 8 passed (5 from Plan 1 + 3 new). If the "Linked to a Google listing" toast disappears before the assertion, assert on the row's lead link only.

- [ ] **Step 2: Add CI**

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [master]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: sdr
          POSTGRES_DB: sdr
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgresql://postgres:sdr@localhost:5432/sdr
      TEST_DATABASE_URL: postgresql://postgres:sdr@localhost:5432/sdr_test
      APP_PASSPHRASE: ci-pass
      APP_SECRET: ci-secret-ci-secret-ci-secret-1234567890
      PROVIDER_MODE: fake
      JOB_MODE: inline
      NEXT_TELEMETRY_DISABLED: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.22.3
          cache: npm
      - run: npm ci
      - run: psql "$DATABASE_URL" -c "CREATE DATABASE sdr_test;"
      - run: npx prisma generate
      - run: npx prisma migrate deploy
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm test
      - run: npm run test:db
      - run: npx playwright install --with-deps chromium
      - run: printf 'DATABASE_URL=%s\nTEST_DATABASE_URL=%s\n' "$DATABASE_URL" "$TEST_DATABASE_URL" > .env
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
```

The `.env` write exists because `playwright.config.ts` and `tests/db/setup.ts` load `.env` with dotenv; real env vars still take precedence.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: projects e2e flow; ci: GitHub Actions lint/tsc/unit/db/e2e

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done criteria for Plan 2

- Unit, DB, and e2e suites pass (`npm test`, `npm run test:db`, `npm run test:e2e` with 8 e2e tests).
- In real mode, "Sync now" on /projects pulls the last 12 months of Houston TDLR registrations at one request per second, and the table shows them scored and timed; nightly cron is registered by the worker.
- "Find business" links or creates a lead, the lead appears under /leads with source TDLR and a timing badge, and its contacts are gathered by the promote job.
- CI runs on pull requests.

## Deferred to Plan 3

The Scanner (schedule window, target zips, auto-added hot zips from projects) and the Google Places ID-only search refactor.
