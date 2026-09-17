import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { CATEGORIES } from "@/lib/config/categories";
import type { DiscoveredBusiness } from "@/lib/providers/types";

const OWNER = "local-user";

/** Wraps FakeDiscoveryProvider to reproduce a budget wrapper that reserves budget before doing
 * the work: the first `limit` getPlaceDetails calls succeed (and count against `calls`, same
 * as the real fake); the next one throws BudgetExhaustedError without doing any work, just
 * like withBudget()'s reservation failing before the provider call happens. */
class BudgetLimitedDiscoveryProvider extends FakeDiscoveryProvider {
  private fetched = 0;
  constructor(private limit: number) {
    super();
  }
  async getPlaceDetails(placeId: string): Promise<DiscoveredBusiness | null> {
    if (this.fetched >= this.limit) throw new BudgetExhaustedError("google");
    this.fetched++;
    return super.getPlaceDetails(placeId);
  }
}

/** Wraps FakeDiscoveryProvider to reproduce the category-search phase hitting the budget: the
 * first `limit` searchCategoryIds calls succeed (still recorded in `calls`/`queries`, same as
 * the real fake), and the next one throws BudgetExhaustedError before doing any work. */
class BudgetLimitedCategoryProvider extends FakeDiscoveryProvider {
  private searched = 0;
  constructor(private limit: number) {
    super();
  }
  async searchCategoryIds(rawQuery: string, center?: { lat: number; lng: number }, radiusMeters?: number, maxResults?: number): Promise<string[]> {
    if (this.searched >= this.limit) throw new BudgetExhaustedError("google");
    this.searched++;
    return super.searchCategoryIds(rawQuery, center, radiusMeters, maxResults);
  }
}

function makeProviders(discovery: FakeDiscoveryProvider) {
  return { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment: new FakeEnrichmentProvider() };
}

async function resetData() {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
}

/** googlePlaceId -> { exclusion, smbFitScore } for every business currently on record. */
async function scoresByPlaceId() {
  const rows = await prisma.business.findMany({ where: { ownerId: OWNER }, select: { googlePlaceId: true, exclusion: true, smbFitScore: true } });
  return new Map(rows.map((r) => [r.googlePlaceId!, { exclusion: r.exclusion, smbFitScore: r.smbFitScore }]));
}

beforeEach(async () => {
  await resetData();
  await prisma.tag.deleteMany();
  await prisma.tag.createMany({ data: CATEGORIES.map((c) => ({ ownerId: OWNER, name: c.slug, isSystem: true })) });
});

describe("zip search budget-pause resume", () => {
  it("completes on what it captured when Place Details hits the budget, then a continuation finishes the rest", async () => {
    const total = CATEGORIES.length * 2 + 1;
    const N = 5;
    expect(N).toBeLessThan(total); // sanity: the budget must actually bite mid-discover()

    const limited = new BudgetLimitedDiscoveryProvider(N);
    const search = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(search.id, { providers: makeProviders(limited) });

    const partial = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    // A Google-budget interruption is not a failure state: the search completes on what it
    // captured, with Search.pendingDiscovery recording how many discovered places are still
    // unfetched, instead of sitting "paused" waiting on a person to notice.
    expect(partial.status).toBe("complete");
    expect(partial.error).toBeNull();
    expect(partial.pendingDiscovery).toBe(total - N);
    const partialProgress = partial.progress as { message?: string; partial?: boolean; remaining?: number; doneSteps: string[] };
    expect(partialProgress.partial).toBe(true);
    expect(partialProgress.remaining).toBe(total - N);
    expect(partialProgress.message).toMatch(/more places found but not yet fetched \(Google daily budget\)/);
    expect(partialProgress.doneSteps).not.toContain("discover");
    expect(limited.calls.getPlaceDetails).toBe(N);
    const persisted = await prisma.business.findMany({ where: { googleFetchedAt: { not: null } } });
    expect(persisted).toHaveLength(N);
    // Task 2: discovery being incomplete doesn't block delivery — everything Place Details
    // did fetch before the budget bit is linked, scored, scraped, validated, and quality-scored.
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(N);
    expect(partial.countsFound).toBe(N);
    const scored = await prisma.business.findMany({
      where: { ownerId: OWNER },
      select: { id: true, primaryCategory: true, websiteCheckedAt: true, contactQualityBand: true },
    });
    expect(scored).toHaveLength(N);
    expect(scored.every((b) => b.primaryCategory !== null)).toBe(true); // scored/excluded already
    expect(scored.filter((b) => b.websiteCheckedAt !== null).length).toBeGreaterThan(0); // scraped
    expect(await prisma.contact.count({ where: { ownerId: OWNER } })).toBeGreaterThan(0); // contacts delivered before the resume
    // R1: the "discovered" ActivityLog is written at persist time, in discover(), not deferred
    // to upsertBusinesses — so it already exists for all N places even before the search is
    // ever resumed or scored.
    expect(await prisma.activityLog.count({ where: { kind: "discovered" } })).toBe(N);

    // Snapshot each business's websiteCheckedAt before resuming, to prove the resumed run
    // doesn't re-scrape businesses already checked since the search started.
    const checkedAtBeforeResume = new Map(scored.map((b) => [b.id, b.websiteCheckedAt]));

    // Continue with the budget limit removed (as the nightly continue-partial job, or the "Find
    // more" button, would do — both just re-run runZipSearch against the same search).
    const fresh = new FakeDiscoveryProvider();
    await runZipSearch(search.id, { providers: makeProviders(fresh) });

    const done = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(done.status).toBe("complete");
    expect(done.pendingDiscovery).toBe(0);
    expect(fresh.calls.searchCategoryIds).toBe(0); // Task 1: IDs persisted, so resume makes zero category searches
    // Only the places that weren't already persisted from the first (interrupted) run are
    // re-fetched — the budget-exhausted attempt never got spent twice.
    expect(fresh.calls.getPlaceDetails).toBe(total - N);
    expect(done.countsFound).toBe(total);
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(total);

    // Businesses already scraped/checked before the resume keep their websiteCheckedAt exactly
    // (the existing `websiteCheckedAt < search.createdAt` skip rule).
    const afterResume = await prisma.business.findMany({ where: { ownerId: OWNER }, select: { id: true, websiteCheckedAt: true } });
    const afterById = new Map(afterResume.map((b) => [b.id, b.websiteCheckedAt]));
    for (const [id, checkedAt] of checkedAtBeforeResume) {
      if (checkedAt === null) continue;
      expect(afterById.get(id)?.getTime()).toBe(checkedAt.getTime());
    }

    // Same business count as an uninterrupted run of the same zip/owner combination.
    expect(await prisma.business.count({ where: { ownerId: OWNER } })).toBe(total);

    // R1: still exactly one "discovered" ActivityLog per business — the resumed run's
    // knownFresh places (persisted, and already logged, by the interrupted run) aren't
    // re-logged, and the newly-fetched places each get exactly one.
    const businesses = await prisma.business.findMany({ where: { ownerId: OWNER } });
    for (const b of businesses) {
      expect(await prisma.activityLog.count({ where: { businessId: b.id, kind: "discovered" } })).toBe(1);
    }
    expect(await prisma.activityLog.count({ where: { kind: "discovered" } })).toBe(total);

    // R2: Starbucks (the coffee-shop category's chain fixture) is among the first N places
    // persisted pre-pause (restaurant x2, then coffee-shop x2 + Starbucks = 5th). Since Task 2,
    // the interrupted run itself already links/scores the fetched set, so Starbucks is scored/
    // excluded right there — not stuck at the DB default `exclusion: "none"` from discover()'s
    // unscored persist, and not deferred to the resumed run's `knownFresh` handling.
    const starbucks = await prisma.business.findFirstOrThrow({ where: { name: "Starbucks" } });
    expect(starbucks.exclusion).toBe("enterprise");
    expect(starbucks.exclusionReasons[0]).toMatch(/^chain:/);
  });

  it("scores every business identically whether the search was interrupted or not (R2)", async () => {
    // Run A: interrupted mid-discover(), then resumed.
    const N = 5;
    const limited = new BudgetLimitedDiscoveryProvider(N);
    const searchA = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(searchA.id, { providers: makeProviders(limited) });
    await runZipSearch(searchA.id, { providers: makeProviders(new FakeDiscoveryProvider()) });
    expect((await prisma.search.findUniqueOrThrow({ where: { id: searchA.id } })).status).toBe("complete");
    const scoresA = await scoresByPlaceId();
    expect(scoresA.size).toBe(CATEGORIES.length * 2 + 1);

    // Run B: a completely fresh, uninterrupted run of the same zip for the same owner.
    await resetData();
    const searchB = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(searchB.id, { providers: makeProviders(new FakeDiscoveryProvider()) });
    expect((await prisma.search.findUniqueOrThrow({ where: { id: searchB.id } })).status).toBe("complete");
    const scoresB = await scoresByPlaceId();

    expect(scoresA.size).toBe(scoresB.size);
    for (const [placeId, scoreA] of scoresA) {
      expect(scoresB.get(placeId)).toEqual(scoreA);
    }
  });
});

describe("zip search category-phase budget resume", () => {
  it("completes with pendingDiscovery when the category-search loop itself hits the budget, and a continuation runs only the remaining categories then details", async () => {
    const limit = 3; // restaurant, cafe (coffee shop — includes the Starbucks fixture), bar
    const limited = new BudgetLimitedCategoryProvider(limit);
    const search = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(search.id, { providers: makeProviders(limited) });

    const partial = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(partial.status).toBe("complete");
    expect(partial.error).toBeNull();
    expect(partial.countsFound).toBe(0); // Place Details never ran — the budget was already exhausted
    expect(limited.calls.getPlaceDetails).toBe(0);

    const discoveredIds = partial.discoveredIds as Record<string, string>;
    const discoveredCount = Object.keys(discoveredIds).length;
    expect(discoveredCount).toBe(limit * 2 + 1); // 2 businesses per category, +1 Starbucks from the coffee-shop category
    expect(partial.pendingDiscovery).toBe(discoveredCount); // nothing fetched yet, so everything discovered is pending

    const partialProgress = partial.progress as { partial?: boolean; remaining?: number; categoriesDone?: string[]; doneSteps: string[] };
    expect(partialProgress.partial).toBe(true);
    expect(partialProgress.remaining).toBe(discoveredCount);
    expect(partialProgress.doneSteps).not.toContain("discover");
    expect(partialProgress.categoriesDone).toEqual(CATEGORIES.slice(0, limit).map((c) => c.slug));

    // Continue with the budget limit removed.
    const fresh = new FakeDiscoveryProvider();
    await runZipSearch(search.id, { providers: makeProviders(fresh) });

    // Only the categories that hadn't completed yet were searched this run.
    expect(fresh.calls.searchCategoryIds).toBe(CATEGORIES.length - limit);
    expect(fresh.queries).toEqual(CATEGORIES.slice(limit).map((c) => `${c.query} in 77084`));

    const done = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(done.status).toBe("complete");
    expect(done.pendingDiscovery).toBe(0);
    const total = CATEGORIES.length * 2 + 1;
    expect(done.countsFound).toBe(total);
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(total);
  });
});
