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

  it("falls back to geocoding the zip for city/state when the project is missing them", async () => {
    const cafe = await project("TABS2027000002");
    await prisma.project.update({ where: { id: cafe.id }, data: { city: null, state: null } });

    const businessId = await createBusinessFromProject(cafe.id, OWNER, { providers });
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(b.formattedAddress).toBe("123 Fake St, Houston, TX 77084");
  });

  it("omits the city line when city/state are missing and no geocode deps are provided", async () => {
    const cafe = await project("TABS2027000002");
    await prisma.project.update({ where: { id: cafe.id }, data: { city: null, state: null } });

    const businessId = await createBusinessFromProject(cafe.id, OWNER);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(b.formattedAddress).toBe("123 Fake St, 77084");
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

  it("links to a pre-existing Google-sourced business without rewriting its origin, and fixes the phone contact's source", async () => {
    const preexisting = await prisma.business.create({
      data: { ownerId: OWNER, name: "Bella Nails & Spa", googlePlaceId: "fake-bella-nails", source: "zip_search", phone: "(713) 555-0142" },
    });
    await prisma.contact.create({
      data: { ownerId: OWNER, businessId: preexisting.id, type: "phone", value: "+17135550142", source: "google", validationStatus: "valid" },
    });

    const bella = await project("TABS2027000001");
    const found = await findBusinessCandidates(bella.id, OWNER, { providers });
    const businessId = await linkProjectToPlace(bella.id, OWNER, found.auto!);

    expect(await prisma.business.count({ where: { googlePlaceId: "fake-bella-nails" } })).toBe(1);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { contacts: true } });
    expect(b.source).toBe("zip_search");
    const phoneContact = b.contacts.find((c) => c.type === "phone" && c.value === "+17135550142");
    expect(phoneContact?.source).toBe("tdlr");
    expect(phoneContact?.personName).toBe("Ana Ruiz");
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
