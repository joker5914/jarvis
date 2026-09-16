import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

function makeProviders() {
  const discovery = new FakeDiscoveryProvider();
  return { discovery, providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment: new FakeEnrichmentProvider() } };
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

describe("zip search with ID-only discovery", () => {
  it("fetches details once per place and skips them on a fresh re-run", async () => {
    const a = makeProviders();
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s1.id, { providers: a.providers });
    const total = CATEGORIES.length * 2 + 1;
    expect(a.discovery.calls.searchCategoryIds).toBe(CATEGORIES.length);
    expect(a.discovery.calls.getPlaceDetails).toBe(total);
    expect(a.discovery.calls.searchCategory).toBe(0);
    expect(await prisma.business.count({ where: { googleFetchedAt: { not: null } } })).toBe(total);

    const b = makeProviders();
    const s2 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s2.id, { providers: b.providers });
    expect(b.discovery.calls.searchCategoryIds).toBe(CATEGORIES.length);
    expect(b.discovery.calls.getPlaceDetails).toBe(0);
    expect(await prisma.searchBusiness.count({ where: { searchId: s2.id } })).toBe(total);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: s2.id } })).countsFound).toBe(total);
  });

  it("re-fetches details for a stale place", async () => {
    const a = makeProviders();
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s1.id, { providers: a.providers });
    const old = new Date(Date.now() - 40 * 86_400_000);
    await prisma.business.updateMany({ where: { name: "restaurant One" }, data: { googleFetchedAt: old } });
    const b = makeProviders();
    const s2 = await prisma.search.create({ data: { zip: "77084" } });
    await runZipSearch(s2.id, { providers: b.providers });
    expect(b.discovery.calls.getPlaceDetails).toBe(1);
    const r = await prisma.business.findFirstOrThrow({ where: { name: "restaurant One" } });
    expect(r.googleFetchedAt!.getTime()).toBeGreaterThan(old.getTime());
  });
});
