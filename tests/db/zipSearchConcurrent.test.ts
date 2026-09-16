import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

function makeProviders() {
  const discovery = new FakeDiscoveryProvider();
  return { discovery, providers: { geocode: new FakeGeocodeProvider(), discovery, validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher } };
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

describe("zip search concurrency", () => {
  // The fake discovery provider yields identical place IDs per category regardless of zip,
  // and every search here shares the same owner, so two concurrent searches for the same zip
  // discover the exact same businesses at the same time. That reproduces the findUnique-then-create
  // race in upsertBusinesses: without the P2002 retry-as-update, the loser's create() throws and
  // its search ends "failed" instead of "complete".
  it("two concurrent searches for the same zip and owner both complete with no duplicate googlePlaceId rows", async () => {
    const a = makeProviders();
    const b = makeProviders();
    const s1 = await prisma.search.create({ data: { zip: "77084" } });
    const s2 = await prisma.search.create({ data: { zip: "77084" } });

    await Promise.all([runZipSearch(s1.id, { providers: a.providers }), runZipSearch(s2.id, { providers: b.providers })]);

    const [search1, search2] = await Promise.all([
      prisma.search.findUniqueOrThrow({ where: { id: s1.id } }),
      prisma.search.findUniqueOrThrow({ where: { id: s2.id } }),
    ]);
    expect(search1.status).toBe("complete");
    expect(search2.status).toBe("complete");

    const businesses = await prisma.business.findMany({ where: { ownerId: "local-user", googlePlaceId: { not: null } } });
    const placeIds = businesses.map((biz) => biz.googlePlaceId);
    expect(new Set(placeIds).size).toBe(placeIds.length);
  });
});
