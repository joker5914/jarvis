import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { DISCOVERY_CONFIG } from "@/lib/config/discovery";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeValidationProvider, FakeRegistryProvider, FakeEnrichmentProvider, fakeFetcher } from "@/lib/providers/fake";

const OWNER = "test-discovery-cap-owner";

async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { business: { ownerId: OWNER } } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.businessTag.deleteMany({ where: { business: { ownerId: OWNER } } });
  await prisma.searchBusiness.deleteMany({ where: { search: { ownerId: OWNER } } });
  await prisma.search.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

function deps(discovery: FakeDiscoveryProvider) {
  return { providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), enrichment: new FakeEnrichmentProvider(), fetcher: fakeFetcher }, log: () => {} } as never;
}

describe("discovery cap and persisted IDs", () => {
  it("passes maxPlacesPerCategory to every category search and persists the discovered IDs", async () => {
    const discovery = new FakeDiscoveryProvider();
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search.id, deps(discovery));
    expect(discovery.calls.searchCategoryIds).toBeGreaterThan(0);
    expect(new Set(discovery.maxResultsSeen)).toEqual(new Set([DISCOVERY_CONFIG.maxPlacesPerCategory]));
    const after = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    const ids = after.discoveredIds as Record<string, string>;
    expect(Object.keys(ids).length).toBe(discovery.known.size); // every discovered place recorded with its first category
    expect(Object.values(ids).every((slug) => typeof slug === "string" && slug.length > 0)).toBe(true);
  });

  it("a resumed search reuses the persisted IDs and makes zero category searches", async () => {
    const first = new FakeDiscoveryProvider();
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search.id, deps(first));
    // Force a resume from before the discover step (as a budget pause would leave it).
    await prisma.search.update({ where: { id: search.id }, data: { status: "paused", progress: { step: "paused", doneSteps: [] } } });
    const second = new FakeDiscoveryProvider();
    await runZipSearch(search.id, deps(second));
    expect(second.calls.searchCategoryIds).toBe(0);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: search.id } })).status).toBe("complete");
  });
});
