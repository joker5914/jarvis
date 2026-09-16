import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runZipSearch } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import { CATEGORIES } from "@/lib/config/categories";

const providers = {
  geocode: new FakeGeocodeProvider(),
  discovery: new FakeDiscoveryProvider(),
  validation: new FakeValidationProvider(),
  registry: new FakeRegistryProvider(),
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

    // R1: every business linked by an uninterrupted search has exactly one "discovered"
    // ActivityLog entry (previously lost once discover() started persisting the row itself,
    // which made upsertBusinesses' own create-and-log branch unreachable).
    const linked = await prisma.searchBusiness.findMany({ where: { searchId: search.id }, select: { businessId: true } });
    expect(linked).toHaveLength(done.countsFound);
    for (const { businessId } of linked) {
      expect(await prisma.activityLog.count({ where: { businessId, kind: "discovered" } })).toBe(1);
    }
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
    // R1: re-discovering the same business in a second search doesn't log "discovered" again.
    expect(await prisma.activityLog.count({ where: { businessId: biz.id, kind: "discovered" } })).toBe(1);
  });

  it("pauses when shouldPause returns true and marks the search paused", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    let calls = 0;
    await runZipSearch(search.id, { providers, shouldPause: async () => ++calls > 3 });
    const s = await prisma.search.findUniqueOrThrow({ where: { id: search.id } });
    expect(s.status).toBe("paused");
    expect((s.progress as { step: string }).step).toBe("paused");
  });

  it("treats an already-aborted signal (pg-boss job expiry/shutdown) like a pause", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    const controller = new AbortController();
    controller.abort();
    await runZipSearch(search.id, { providers, signal: controller.signal });
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
