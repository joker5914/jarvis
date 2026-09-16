import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runWebsiteRecheck } from "@/lib/jobs/websiteRecheck";
import { scrapeOne } from "@/lib/jobs/zipSearch";
import { FakeDiscoveryProvider, FakeEnrichmentProvider, FakeGeocodeProvider, FakeRegistryProvider, FakeValidationProvider, fakeFetcher } from "@/lib/providers/fake";
import type { PageFetcher } from "@/lib/extract/website";

const providers = { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment: new FakeEnrichmentProvider() };
const OWNER = "local-user";

class ThrowingValidationProvider extends FakeValidationProvider {
  async domainHasMx(): Promise<boolean> {
    throw new Error("mx lookup failed");
  }
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.business.deleteMany();
  await prisma.scannerState.deleteMany();
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

  // D4: the job clears its own `website_recheck:<ISO>` marker on the way out, but never one it
  // doesn't own (e.g. a newer marker, or an unrelated job id) left on ScannerState.currentJobId.
  it("D4: clears its own website_recheck marker on ScannerState in a finally", async () => {
    const b = await prisma.business.create({ data: { name: "X", websiteUrl: "https://x.fake.test/" } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, currentJobId: "website_recheck:2026-01-01T00:00:00.000Z" } });
    await runWebsiteRecheck([b.id], OWNER, { providers });
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentJobId).toBeNull();
  });

  it("D4: still clears its own marker when the job throws (e.g. paused)", async () => {
    const b = await prisma.business.create({ data: { name: "X", websiteUrl: "https://x.fake.test/" } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, currentJobId: "website_recheck:2026-01-01T00:00:00.000Z" } });
    await expect(runWebsiteRecheck([b.id], OWNER, { providers, shouldPause: async () => true })).rejects.toThrow(/paused/);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentJobId).toBeNull();
  });

  it("D4: does not clear a currentJobId it doesn't own", async () => {
    const b = await prisma.business.create({ data: { name: "X", websiteUrl: "https://x.fake.test/" } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, currentJobId: "some-other-job-id" } });
    await runWebsiteRecheck([b.id], OWNER, { providers });
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentJobId).toBe("some-other-job-id");
  });

  // D6: extractWebsiteContacts awaits opts.beforeFetch before every page fetch, and scrapeOne
  // wires it to checkPause, so a pause requested mid-scrape stops before the next candidate
  // page is fetched rather than only between businesses.
  it("D6: stops fetching once shouldPause flips true after the first page fetch", async () => {
    const b = await prisma.business.create({ data: { name: "Multi", websiteUrl: "https://multi.fake.test/" } });
    let fetchCalls = 0;
    const countingFetcher: PageFetcher = async (url) => {
      fetchCalls++;
      return fakeFetcher(url);
    };
    const throttledProviders = { ...providers, fetcher: countingFetcher };
    const shouldPause = async () => fetchCalls >= 1;
    await expect(scrapeOne(b.id, OWNER, { providers: throttledProviders, shouldPause })).rejects.toThrow(/paused/);
    // The home page was fetched (1), but the pause is caught before the /contact candidate
    // page (fakeFetcher's html always links one) is requested.
    expect(fetchCalls).toBe(1);
  });

  it("D6: a no-op beforeFetch (no shouldPause, manual-origin style) fetches every page", async () => {
    const b = await prisma.business.create({ data: { name: "Multi", websiteUrl: "https://multi.fake.test/" } });
    let fetchCalls = 0;
    const countingFetcher: PageFetcher = async (url) => {
      fetchCalls++;
      return fakeFetcher(url);
    };
    const manualProviders = { ...providers, fetcher: countingFetcher };
    await scrapeOne(b.id, OWNER, { providers: manualProviders }); // no shouldPause, like a manual job
    expect(fetchCalls).toBe(2); // home + the one /contact candidate page
  });
});
