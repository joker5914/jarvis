import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { saveOverrides } from "@/lib/config/runtime";
import { runEnrich } from "@/lib/jobs/enrich";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderDisabledError, ProviderPlanError } from "@/lib/providers/errors";
import type { JobDeps } from "@/lib/jobs/shared";

const OWNER = "test-enrich-owner";
async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

function deps(enrichment = new FakeEnrichmentProvider()): JobDeps & { enrichment: FakeEnrichmentProvider } {
  return {
    providers: { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment },
    log: () => {},
    enrichment,
  } as never;
}

async function biz(over: Partial<Parameters<typeof prisma.business.create>[0]["data"]> = {}) {
  return prisma.business.create({ data: { ownerId: OWNER, name: "Bella Nails & Spa", websiteUrl: "https://www.bellanails.com", formattedAddress: "123 Main St, Houston, TX 77084, USA", source: "zip_search", ...over } });
}

describe("runEnrich", () => {
  it("adds Apollo contacts with names and titles, validates, re-scores, logs, and stamps lastEnrichedAt", async () => {
    const b = await biz();
    const d = deps();
    const r = await runEnrich(b.id, OWNER, d);
    expect(r).toEqual({ added: 1, updated: 0, skipped: null });
    expect(d.enrichment.calls).toEqual({ search: 1, enrich: 1, orgSearch: 0 });
    const contacts = await prisma.contact.findMany({ where: { businessId: b.id }, orderBy: { value: "asc" } });
    const email = contacts.find((c) => c.type === "email");
    expect(email).toMatchObject({ value: "owner@bellanails.com", source: "apollo", personName: "Maria Lopez", personTitle: "Owner", validationStatus: "valid" });
    expect(contacts.filter((c) => c.type === "linkedin")).toHaveLength(1);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).not.toBeNull();
    expect(after.contactQualityScore).toBeGreaterThanOrEqual(45); // email valid (30) + named person (15) at minimum
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toMatch(/Apollo/);
    // "out of 2 found" — the fake's searchPeople now returns its full ranked candidate list
    // (Owner + General Manager), matching real Apollo's search (free of credits, up to
    // searchPageSize); maxPeople=1 only bounds how many get a *paid* reveal, at the loop below.
    // The fake reports scope "city" whenever both a city and a state are available (biz()'s
    // default address has both), so the success message carries the location suffix too.
    expect(log[0].message).toBe("Enriched via Apollo: 1 person with a verified email out of 2 found; 2 new contacts, 0 updated (matched in Houston, TX)");
  });
  it("m=0: search returns no candidates at all — names what was searched for, not a generic '0 people'", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({ people: [], totalFound: 0, totalAtDomain: 0, scope: "any" });
    const d = deps(fake);
    const r = await runEnrich(b.id, OWNER, d);
    expect(r).toEqual({ added: 0, updated: 0, skipped: null });
    expect(d.enrichment.calls.enrich).toBe(0);
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Enriched via Apollo: no people found for bellanails.com");
  });
  // Live bug (Plan 8 Task 7): searching found 2 candidates but neither had an email; the old
  // message ("Enriched via Apollo: 0 people, 0 new contacts, 0 updated") read like a targeting
  // failure that returned nothing, when Apollo actually did find people — just none with an
  // email. The new message names the titles that came back empty-handed.
  it("m=2, n=0: search finds two candidates, neither has an email — names the titles instead of a generic '0 people'", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({ people: [
      { apolloId: "fake-store-mgr", firstName: "Casey", lastName: null, name: "Casey", title: "Store Manager", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false, orgName: "Bella Nails & Spa" },
      { apolloId: "fake-barista", firstName: "Sam", lastName: null, name: "Sam", title: "Barista", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false, orgName: "Bella Nails & Spa" },
    ], totalFound: 2, totalAtDomain: 2, scope: "any" });
    const d = deps(fake);
    const r = await runEnrich(b.id, OWNER, d);
    expect(r).toEqual({ added: 0, updated: 0, skipped: null });
    expect(d.enrichment.calls.enrich).toBe(0); // never worth a paid reveal — search already said no email
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Enriched via Apollo: none of 2 people found had an email (Store Manager, Barista)");
  });
  it("walks past a no-email candidate at rank 0 and reveals the emailed one at rank 1 within maxPeople=1 (re-review D2)", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({ people: [
      { apolloId: "fake-bellanails.com-gm", firstName: "Lee", lastName: null, name: "Lee", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false, orgName: "Bella Nails & Spa" },
      { apolloId: "fake-bellanails.com-owner", firstName: "Maria", lastName: null, name: "Maria", title: "General Manager", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails & Spa" },
    ], totalFound: 2, totalAtDomain: 2, scope: "any" });
    const d = deps(fake);
    const r = await runEnrich(b.id, OWNER, d);
    expect(r.added).toBe(1);
    expect(d.enrichment.calls.enrich).toBe(1);
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log[0].message).toMatch(/^Enriched via Apollo: 1 person with a verified email out of 2 found; /);
  });

  it("m=1, n=0: singular wording — 'none of 1 person found had an email'", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({ people: [
      { apolloId: "fake-store-mgr", firstName: "Casey", lastName: null, name: "Casey", title: "Store Manager", email: null, emailStatus: null, linkedinUrl: null, hasEmail: false, orgName: "Bella Nails & Spa" },
    ], totalFound: 1, totalAtDomain: 1, scope: "any" });
    const d = deps(fake);
    const r = await runEnrich(b.id, OWNER, d);
    expect(r).toEqual({ added: 0, updated: 0, skipped: null });
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Enriched via Apollo: none of 1 person found had an email (Store Manager)");
  });
  it("is idempotent: a second run without force is skipped as recently enriched, and force re-runs without duplicating", async () => {
    const b = await biz();
    const d1 = deps();
    await runEnrich(b.id, OWNER, d1);
    expect(d1.enrichment.calls.enrich).toBe(1);

    const d2 = deps();
    const r2 = await runEnrich(b.id, OWNER, d2);
    expect(r2).toEqual({ added: 0, updated: 0, skipped: "recent" });
    expect(d2.enrichment.calls.enrich).toBe(0);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(2);

    const d3 = deps();
    const r3 = await runEnrich(b.id, OWNER, d3, { force: true });
    expect(r3.added).toBe(0);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(2);
  });
  it("fills the name and title on an existing website email instead of creating a duplicate", async () => {
    const b = await biz();
    await prisma.contact.create({ data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@bellanails.com", source: "website" } });
    const r = await runEnrich(b.id, OWNER, deps());
    expect(r.updated).toBe(1);
    const c = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
    expect(c).toMatchObject({ source: "website", personName: "Maria Lopez", personTitle: "Owner" });
  });
  it("skips excluded businesses without calling Apollo", async () => {
    const b = await biz({ exclusion: "enterprise" });
    const d = deps();
    expect(await runEnrich(b.id, OWNER, d)).toEqual({ added: 0, updated: 0, skipped: "excluded" });
    expect(d.enrichment.calls.search).toBe(0);
  });
  it("falls back to name + city when there is no usable domain", async () => {
    const b = await biz({ websiteUrl: "https://facebook.com/bella" });
    const d = deps();
    await runEnrich(b.id, OWNER, d);
    expect(d.enrichment.calls.search).toBe(1);
    expect(await prisma.contact.count({ where: { businessId: b.id, source: "apollo" } })).toBeGreaterThan(0);
  });
  it("logs and rethrows when the Apollo budget is exhausted", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => { throw new BudgetExhaustedError("apollo"); };
    await expect(runEnrich(b.id, OWNER, deps(fake))).rejects.toBeInstanceOf(BudgetExhaustedError);
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toMatch(/budget/i);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });
  it("logs a disabled-provider activity row and rethrows ProviderDisabledError", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => { throw new ProviderDisabledError("apollo"); };
    await expect(runEnrich(b.id, OWNER, deps(fake))).rejects.toBeInstanceOf(ProviderDisabledError);
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("Enrichment skipped: Apollo is disabled in Settings");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });
  it("logs exactly one 'Enrichment unavailable' activity row and rethrows ProviderPlanError, leaving lastEnrichedAt null", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    const planError = new ProviderPlanError("apollo", "/mixed_people/api_search", "API_INACCESSIBLE");
    fake.searchPeople = async () => { throw planError; };
    await expect(runEnrich(b.id, OWNER, deps(fake))).rejects.toBeInstanceOf(ProviderPlanError);
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe(`Enrichment unavailable: ${planError.message} (API_INACCESSIBLE)`);
    expect(logs[0].message).toMatch(/^Enrichment unavailable/);
    expect(logs[0].message).toMatch(/\(API_INACCESSIBLE\)$/);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });

  // M3 (whole-branch review): a generic provider failure (429/5xx/network — anything not one of
  // the typed provider errors above) used to leave no activity row at all, so a lead that failed
  // enrichment looked identical to one that had simply never been attempted.
  it("logs one 'Enrichment failed: <message>' activity row and rethrows for a generic (non-typed) provider error", async () => {
    const b = await biz();
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => { throw new Error("Apollo /x HTTP 503"); };
    await expect(runEnrich(b.id, OWNER, deps(fake))).rejects.toThrow("Apollo /x HTTP 503");
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("Enrichment failed: Apollo /x HTTP 503");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });

  it("passes the configured metro area to the search and names it in the activity row (Plan 9 Task 2)", async () => {
    await saveOverrides(OWNER, { enrichment: { metroLocation: "Metro City, Texas" } });
    try {
      const b = await biz();
      const fake = new FakeEnrichmentProvider();
      let seenMetro: string | null | undefined;
      fake.searchPeople = async (q) => {
        seenMetro = q.metro;
        return { people: [{ apolloId: "fake-bellanails.com-owner", firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails & Spa" }], totalFound: 1, totalAtDomain: 30, scope: "metro" };
      };
      const d = deps(fake);
      await runEnrich(b.id, OWNER, d);
      expect(seenMetro).toBe("Metro City, Texas");
      const log = await prisma.activityLog.findFirst({ where: { businessId: b.id, kind: "enriched" }, orderBy: { createdAt: "desc" } });
      expect(log?.message).toMatch(/ \(matched in Metro City, Texas\)$/);
    } finally {
      await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
    }
  });

  describe("enrichment targeting guard (Task 4)", () => {
    it("skips a candidate whose Apollo-reported company doesn't match the lead (e.g. a shared booking-platform page returning the platform's own staff), with one explanatory activity row, no contact created, no paid reveal, and lastEnrichedAt set (L1: so a later bulk pass doesn't re-spend the Organization Search credit on the same mismatch)", async () => {
      const b = await biz({ name: "Whiskey Blades", websiteUrl: "https://whiskeyblades.booksy.com/" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-booksy-exec", firstName: "Sam", lastName: null, name: "Sam", title: "CEO", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Booksy" },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const d = deps(fake);
      const before = new Date();
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).toEqual({ added: 0, updated: 0, skipped: "org_mismatch" });
      expect(d.enrichment.calls.enrich).toBe(0);
      expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
      const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Enrichment skipped: Apollo matched a different company (Booksy)");
      const updatedBiz = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(updatedBiz.lastEnrichedAt).not.toBeNull();
      expect(updatedBiz.lastEnrichedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());

      // Re-enrich with force still bypasses the recheckDays gate and retries against Apollo.
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-bella-owner", firstName: "Sam", lastName: null, name: "Sam", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Whiskey Blades" },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const forced = await runEnrich(b.id, OWNER, d, { force: true });
      expect(forced.skipped).toBeNull();
      expect(forced.added).toBe(1);
    });

    it("normalizes punctuation and connectors before comparing (\"Bella Nails & Spa\" vs \"Bella Nails and Spa\" is the same company)", async () => {
      const b = await biz({ name: "Bella Nails & Spa" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-bella-owner", firstName: "Linh", lastName: null, name: "Linh", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails and Spa" },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).not.toMatchObject({ skipped: "org_mismatch" });
      expect(d.enrichment.calls.enrich).toBe(1);
    });

    it("does not apply the name guard when the search was filtered by the lead's own domain (a domain owner often trades under another name)", async () => {
      const b = await biz({ name: "Dr. Jane Smith DDS", websiteUrl: "https://www.pearlandfamilydentistry.com/" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-pfd-owner", firstName: "Jane", lastName: null, name: "Jane", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Pearland Family Dentistry" },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).not.toMatchObject({ skipped: "org_mismatch" });
      expect(d.enrichment.calls.enrich).toBe(1);
    });

    it("proceeds when the candidate's orgName loosely matches the lead's name (case-insensitive, tolerant of a trailing legal suffix)", async () => {
      const b = await biz({ name: "ZERO Training Center" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-zerotrainingcenter.example-owner", firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Zero Training Center LLC" },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).toEqual({ added: 1, updated: 0, skipped: null });
      expect(d.enrichment.calls.enrich).toBe(1);
      const contacts = await prisma.contact.findMany({ where: { businessId: b.id, type: "email" } });
      expect(contacts).toHaveLength(1);
      expect(contacts[0].value).toBe("owner@zerotrainingcenter.example");
      expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).not.toBeNull();
    });

    it("is unaffected when candidates carry no orgName at all", async () => {
      const b = await biz();
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-noorg-owner", firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: null },
      ], totalFound: 1, totalAtDomain: 1, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.skipped).toBeNull();
      expect(r.added).toBe(1);
    });
  });

  describe("location cascade activity message suffix (Task 2)", () => {
    it("appends ' (matched in <city>, <state>)' to the success message when the search matched in the city scope", async () => {
      const b = await biz({ name: "Kids R Kids", websiteUrl: "https://www.kidsrkids.com", formattedAddress: "1820 Pearland Pkwy, Pearland, TX 77581, USA" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        // apolloId matches FakeEnrichmentProvider.enrichPerson's `fake-<domain>-(owner|gm)`
        // pattern so the default fake reveal resolves an email, and this run actually adds a
        // contact (a null reveal would make `added` 0 and never log the success message below).
        { apolloId: "fake-kidsrkids.com-owner", firstName: "Jamie", lastName: null, name: "Jamie", title: "Preschool Director", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Kids R Kids" },
      ], totalFound: 20, totalAtDomain: 20, scope: "city" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.added).toBe(1);
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
      expect(log[0].message).toMatch(/ \(matched in Pearland, TX\)$/);
    });
  });

  describe("chain-headcount guard (Task 3)", () => {
    it("marks the business as an excluded chain and skips the reveal loop entirely when totalAtDomain meets the threshold", async () => {
      const b = await biz({ name: "H&R Block", websiteUrl: "https://www.hrblock.com" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-hrblock.com-ceo", firstName: "Jamie", lastName: null, name: "Jamie", title: "CEO", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "H&R Block" },
      ], totalFound: 6579, totalAtDomain: 6579, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).toEqual({ added: 0, updated: 0, skipped: "chain" });
      expect(d.enrichment.calls.enrich).toBe(0);
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.exclusion).toBe("enterprise");
      expect(after.exclusionReasons).toEqual(["chain:apollo_headcount:6579"]);
      expect(after.lastEnrichedAt).toBeNull();
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id } });
      expect(log).toHaveLength(1);
      expect(log[0].message).toBe("Enrichment skipped: 6579 people at hrblock.com in Apollo — not an SMB (marked as chain)");
    });

    it("proceeds normally when totalAtDomain is below the threshold (a franchise brand, not a chain)", async () => {
      const b = await biz({ name: "Kids R Kids", websiteUrl: "https://www.kidsrkids.com" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-kidsrkids.com-owner", firstName: "Jamie", lastName: null, name: "Jamie", title: "Preschool Director", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Kids R Kids" },
      ], totalFound: 139, totalAtDomain: 139, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.skipped).toBeNull();
      expect(d.enrichment.calls.enrich).toBe(1);
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.exclusion).toBe("none");
    });
  });
});
