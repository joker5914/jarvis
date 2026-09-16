import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { CATEGORIES } from "@/lib/config/categories";
import type { DiscoveredBusiness } from "@/lib/providers/types";

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
  return { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher };
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.businessTag.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.tag.createMany({ data: CATEGORIES.map((c) => ({ ownerId: "local-user", name: c.slug, isSystem: true })) });
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
    expect(await prisma.business.count({ where: { ownerId: "local-user" } })).toBe(total);
  });
});
