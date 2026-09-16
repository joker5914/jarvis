import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { readScanner } from "@/lib/scanner/state";
import { applyScheduleUpdate } from "@/lib/scanner/schedule";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { CATEGORIES } from "@/lib/config/categories";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import type { PageFetcher } from "@/lib/extract/website";

// TEST_DATABASE_URL is required and wired to DATABASE_URL by tests/db/setup.ts (a global
// setupFile for this suite), which throws before any test runs if it's missing.
const OWNER_D1 = "test-scanner-deferrals-d1-owner";
const OWNER_D2 = "test-scanner-deferrals-d2-owner";
const HOUR = 3_600_000;

async function cleanup() {
  await prisma.scanSchedule.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
  await prisma.scannerState.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
  await prisma.scanTarget.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("D1: readScanner first-poll race", () => {
  it("three concurrent calls on a fresh owner resolve without throwing and leave one row each", async () => {
    const results = await Promise.all([readScanner(OWNER_D1), readScanner(OWNER_D1), readScanner(OWNER_D1)]);
    for (const r of results) {
      expect(r.schedule.ownerId).toBe(OWNER_D1);
      expect(r.state.ownerId).toBe(OWNER_D1);
    }
    const schedules = await prisma.scanSchedule.findMany({ where: { ownerId: OWNER_D1 } });
    const states = await prisma.scannerState.findMany({ where: { ownerId: OWNER_D1 } });
    expect(schedules).toHaveLength(1);
    expect(states).toHaveLength(1);
  });
});

describe("D2: applyScheduleUpdate atomicity", () => {
  it("never persists windowEnd < windowStart under concurrent conflicting updates", async () => {
    const T = new Date("2026-09-16T10:00:00.000Z");
    await applyScheduleUpdate(OWNER_D2, { windowStart: T, windowEnd: new Date(T.getTime() + 20 * HOUR) });

    const results = await Promise.allSettled([
      applyScheduleUpdate(OWNER_D2, { windowStart: new Date(T.getTime() + 10 * HOUR) }),
      applyScheduleUpdate(OWNER_D2, { windowEnd: new Date(T.getTime() + 5 * HOUR) }),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // At least one of the two conflicting updates must have been rejected (either immediately,
    // because it read the other's already-committed change, or after a P2034 retry saw it).
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ApiError);
      expect((r.reason as ApiError).status).toBe(400);
    }

    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER_D2 } });
    if (row.windowStart && row.windowEnd) {
      expect(row.windowEnd.getTime()).toBeGreaterThanOrEqual(row.windowStart.getTime());
    }
  });
});

// Fix round: the pLimit(4) concurrent scrape loop's per-business catch used to swallow
// JobPausedError from the D6 mid-scrape hook the same as any other scrape error, recording the
// interrupted businesses as unreachable ("websiteError: 'paused'") instead of letting the pause
// reach runZipSearch's outer catch (which sets `status: "paused"` and leaves the businesses
// alone). It must now rethrow, and Promise.allSettled (replacing Promise.all) must surface
// exactly one of those rejections without leaving any concurrent sibling's rejection unhandled.
describe("fix: a mid-scrape pause during a scanner zip search propagates through the concurrent scrape step", () => {
  const OWNER = "local-user"; // Search/Business default ownerId

  beforeEach(async () => {
    await prisma.activityLog.deleteMany();
    await prisma.contact.deleteMany();
    await prisma.businessTag.deleteMany();
    await prisma.searchBusiness.deleteMany();
    await prisma.business.deleteMany();
    await prisma.search.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.tag.createMany({ data: CATEGORIES.map((c) => ({ ownerId: OWNER, name: c.slug, isSystem: true })) });
  });

  it("ends the search as paused, with no business's websiteError mentioning the pause", async () => {
    const search = await prisma.search.create({ data: { zip: "77084", origin: "scanner" } });
    let fetchCalls = 0;
    const countingFetcher: PageFetcher = async (url) => {
      fetchCalls++;
      return fakeFetcher(url);
    };
    const providers = {
      geocode: new FakeGeocodeProvider(),
      discovery: new FakeDiscoveryProvider(),
      validation: new FakeValidationProvider(),
      registry: new FakeRegistryProvider(),
      fetcher: countingFetcher,
      enrichment: new FakeEnrichmentProvider(),
    };
    // Flips true only once the scrape step's first fetch happens — discover() never calls the
    // fetcher, so the pause lands squarely inside the concurrent scrape loop, not earlier.
    const shouldPause = async () => fetchCalls >= 1;

    await runZipSearch(search.id, { providers, shouldPause });

    const done = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(done.status).toBe("paused");

    const businesses = await prisma.business.findMany();
    expect(businesses.length).toBeGreaterThan(0); // discover() ran to completion before the pause
    for (const b of businesses) {
      expect(b.websiteError ?? "").not.toMatch(/pause/i);
    }
  });
});
