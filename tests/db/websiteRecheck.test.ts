import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runWebsiteRecheck } from "@/lib/jobs/websiteRecheck";
import { FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";

const providers = { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher };

class ThrowingValidationProvider extends FakeValidationProvider {
  async domainHasMx(): Promise<boolean> {
    throw new Error("mx lookup failed");
  }
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.business.deleteMany();
});

describe("runWebsiteRecheck", () => {
  it("re-scrapes, validates, and re-scores the batch", async () => {
    const b = await prisma.business.create({ data: { name: "Old Site", websiteUrl: "https://old-site.fake.test/", phone: "(713) 555-0100", contactQualityBand: "red" } });
    const dead = await prisma.business.create({ data: { name: "Dead", websiteUrl: "https://dead.old.fake.test/" } });
    const r = await runWebsiteRecheck([b.id, dead.id], "local-user", { providers });
    expect(r.rechecked).toBe(2);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id }, include: { contacts: true } });
    expect(after.websiteReachable).toBe(true);
    expect(after.contacts.some((c) => c.type === "email" && c.validationStatus === "valid")).toBe(true);
    expect(after.contactQualityBand).toBe("green");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: dead.id } })).websiteReachable).toBe(false);
  });
  it("pauses between businesses", async () => {
    const b = await prisma.business.create({ data: { name: "X", websiteUrl: "https://x.fake.test/" } });
    let calls = 0;
    await expect(runWebsiteRecheck([b.id], "local-user", { providers, shouldPause: async () => ++calls > 0 })).rejects.toThrow(/paused/);
  });
  it("keeps rechecking the batch even when email validation throws", async () => {
    const b = await prisma.business.create({ data: { name: "Reachable", websiteUrl: "https://old-site.fake.test/" } });
    const throwingProviders = { ...providers, validation: new ThrowingValidationProvider() };
    const r = await runWebsiteRecheck([b.id], "local-user", { providers: throwingProviders });
    expect(r.rechecked).toBe(1);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).websiteReachable).toBe(true);
  });
});
