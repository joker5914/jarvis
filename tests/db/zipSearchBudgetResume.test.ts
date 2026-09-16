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
  it("persists Place Details as they're fetched, so a budget pause never re-spends on resume", async () => {
    const total = CATEGORIES.length * 2 + 1;
    const N = 5;
    expect(N).toBeLessThan(total); // sanity: the budget must actually bite mid-discover()

    const limited = new BudgetLimitedDiscoveryProvider(N);
    const search = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(search.id, { providers: makeProviders(limited) });

    const paused = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(paused.status).toBe("paused");
    expect(limited.calls.getPlaceDetails).toBe(N);
    const persisted = await prisma.business.findMany({ where: { googleFetchedAt: { not: null } } });
    expect(persisted).toHaveLength(N);
    // Not linked to the search yet, and no scoring/exclusion has run — that's upsertBusinesses' job.
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(0);
    // R1: the "discovered" ActivityLog is written at persist time, in discover(), not deferred
    // to upsertBusinesses — so it already exists for all N places even before the search is
    // ever resumed or scored.
    expect(await prisma.activityLog.count({ where: { kind: "discovered" } })).toBe(N);

    // Resume with the budget limit removed.
    const fresh = new FakeDiscoveryProvider();
    await runZipSearch(search.id, { providers: makeProviders(fresh) });

    const done = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(done.status).toBe("complete");
    // Only the places that weren't already persisted from the first (interrupted) run are
    // re-fetched — the budget-exhausted attempt never got spent twice.
    expect(fresh.calls.getPlaceDetails).toBe(total - N);
    expect(done.countsFound).toBe(total);
    expect(await prisma.searchBusiness.count({ where: { searchId: search.id } })).toBe(total);

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
    // persisted pre-pause (restaurant x2, then coffee-shop x2 + Starbucks = 5th), so it becomes
    // `knownFresh` on resume. It must still end up scored/excluded like any other business —
    // not stuck at the DB default `exclusion: "none"` from discover()'s unscored persist.
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
