import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadConfig, saveOverrides } from "@/lib/config/runtime";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";

const OWNER = "test-runtime-config-owner";

async function cleanup() {
  await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.searchBusiness.deleteMany({ where: { search: { ownerId: OWNER } } });
  await prisma.search.deleteMany({ where: { ownerId: OWNER } });
  await prisma.businessTag.deleteMany({ where: { business: { ownerId: OWNER } } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

function deps(discovery: FakeDiscoveryProvider) {
  return {
    providers: {
      geocode: new FakeGeocodeProvider(),
      discovery,
      validation: new FakeValidationProvider(),
      registry: new FakeRegistryProvider(),
      fetcher: fakeFetcher,
      enrichment: new FakeEnrichmentProvider(),
    },
    log: () => {},
  };
}

describe("runtime config", () => {
  it("defaults without a row, round-trips overrides", async () => {
    expect((await loadConfig(OWNER)).projects.highFitThreshold).toBe(60);
    await saveOverrides(OWNER, { projects: { highFitThreshold: 75 }, exclusion: { chains: ["bella"] } });
    const c = await loadConfig(OWNER);
    expect(c.projects.highFitThreshold).toBe(75);
    expect(c.exclusion.chains).toEqual(["bella"]);
  });

  // Reproduces the Plan 9 production failure at the DB boundary: a row written by a newer build
  // carries a key this build's `.strict()` schema has never heard of. It used to sink the whole
  // row -- monthlyCreditCap reverted to the 80 default. The unknown key must cost only itself.
  // Written via prisma directly because `saveOverrides` is strict and would reject it by design.
  it("keeps the valid settings in a row that also carries a key this build does not know", async () => {
    await prisma.appConfig.create({
      data: { ownerId: OWNER, overrides: { enrichment: { monthlyCreditCap: 1000 }, projects: { highFitThreshold: 75 }, futureSection: { a: 1 } } },
    });
    const c = await loadConfig(OWNER);
    expect(c.enrichment.monthlyCreditCap).toBe(1000);
    expect(c.projects.highFitThreshold).toBe(75);
  });

  it("a disabled category is not searched, and re-enabling it with a new chain override excludes the matching business", async () => {
    // First search: nail_salon disabled, plus a chain override that never matches anything the
    // fixture generates (the fake discovery only yields "Bella Nails & Spa" for the promote
    // flow's exact-name lookup, never through zip search's category-based discovery) — so this
    // config change can only be observed via the category not being searched at all.
    await saveOverrides(OWNER, { categories: { disabled: ["nail_salon"] }, exclusion: { chains: ["bella nails"] } });
    const discovery1 = new FakeDiscoveryProvider();
    const search1 = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search1.id, deps(discovery1));
    expect(discovery1.queries.some((q) => q.includes("nail salon"))).toBe(false);
    expect(await prisma.business.findFirst({ where: { ownerId: OWNER, name: { contains: "nail salon", mode: "insensitive" } } })).toBeNull();

    // Second search: a fresh saveOverrides replaces the whole overrides row, so nail_salon is
    // implicitly re-enabled; set a chain override matching the business the fixture generates
    // only under that category ("nail salon Two"), which has never been fetched for this owner
    // before, so it's guaranteed to go through the freshly-scored path (not the 30-day details
    // cache) and prove the new config was actually applied, not just carried over from search 1.
    await saveOverrides(OWNER, { exclusion: { chains: ["nail salon two"] } });
    const discovery2 = new FakeDiscoveryProvider();
    const search2 = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084" } });
    await runZipSearch(search2.id, deps(discovery2));
    expect(discovery2.queries.some((q) => q.includes("nail salon"))).toBe(true);

    const excluded = await prisma.business.findFirst({ where: { ownerId: OWNER, name: { equals: "nail salon Two", mode: "insensitive" } } });
    expect(excluded).not.toBeNull();
    expect(excluded?.exclusion).toBe("enterprise");
    expect(excluded?.exclusionReasons.some((r) => r.startsWith("chain:"))).toBe(true);
  });
});
