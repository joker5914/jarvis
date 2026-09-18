import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { saveOverrides } from "@/lib/config/runtime";
import { runEnrich } from "@/lib/jobs/enrich";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
import { ProviderDisabledError, ProviderPlanError, CreditCapReachedError } from "@/lib/providers/errors";
import { ENRICH_CONFIG } from "@/lib/config/enrichment";
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

    // L1 (whole-branch review): the cascade ran (totalAtDomain > searchPageSize) but every
    // located scope came back empty, so searchPeople falls back to the unlocated page and reports
    // scope "any" again — indistinguishable from "no location info was ever available" without
    // this suffix. 139 is below chainHeadcountMin (1000), so the chain guard doesn't fire either.
    it("appends ' (no local match; searched nationally)' when the cascade ran but fell back to the unlocated page, and a located input (city+state) existed", async () => {
      const b = await biz({ name: "H&R Block", websiteUrl: "https://www.hrblock.com", formattedAddress: "1820 Pearland Pkwy, Pearland, TX 77581, USA" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-hrblock.com-owner", firstName: "Nat", lastName: null, name: "Nat", title: "CEO", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "H&R Block" },
      ], totalFound: 139, totalAtDomain: 139, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.added).toBe(1);
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
      expect(log[0].message).toMatch(/ \(no local match; searched nationally\)$/);
    });

    // Sanity check for the guard the previous test relies on: the short-circuit case (a
    // single-location SMB whose whole page comes back on the unlocated call, totalAtDomain <=
    // searchPageSize) must NOT get the "searched nationally" suffix — nothing was ever cascaded.
    it("does not append the national-fallback suffix for a small org (totalAtDomain within searchPageSize)", async () => {
      const b = await biz({ formattedAddress: "1820 Pearland Pkwy, Pearland, TX 77581, USA" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-bellanails.com-owner", firstName: "Maria", lastName: null, name: "Maria", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails & Spa" },
      ], totalFound: ENRICH_CONFIG.searchPageSize, totalAtDomain: ENRICH_CONFIG.searchPageSize, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.added).toBe(1);
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
      expect(log[0].message).not.toMatch(/searched nationally/);
    });
  });

  describe("chain-headcount guard (Task 3)", () => {
    it("marks the business as an excluded chain and skips the reveal loop entirely when totalAtDomain meets the threshold", async () => {
      // 4,753 is the live-measured decision-maker (title/seniority-filtered) count for
      // hrblock.com — see the ENRICH_CONFIG.chainHeadcountMin doc comment (Plan 9 Task 3 fix
      // round, review N1): Apollo's total_entries here is never a raw employee headcount, since
      // every People Search call is already filtered by preferredTitles/seniorities.
      const b = await biz({ name: "H&R Block", websiteUrl: "https://www.hrblock.com" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-hrblock.com-ceo", firstName: "Jamie", lastName: null, name: "Jamie", title: "CEO", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "H&R Block" },
      ], totalFound: 4753, totalAtDomain: 4753, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r).toEqual({ added: 0, updated: 0, skipped: "chain" });
      expect(d.enrichment.calls.enrich).toBe(0);
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.exclusion).toBe("enterprise");
      expect(after.exclusionReasons).toEqual(["chain:apollo_headcount:4753"]);
      expect(after.lastEnrichedAt).toBeNull();
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id } });
      expect(log).toHaveLength(1);
      expect(log[0].message).toBe("Enrichment skipped: 4753 decision-makers at hrblock.com in Apollo — not an SMB (marked as chain)");
    });

    // Plan 9: the threshold is a per-owner Settings value, not a code constant. Same headcount
    // (31, the measured kidsrkids.com count) that passes at the 1000 default must be excluded once
    // the owner lowers the threshold under it -- proving the guard reads config, not ENRICH_CONFIG.
    it("uses the owner's configured threshold instead of the default", async () => {
      await saveOverrides(OWNER, { enrichment: { chainHeadcountMin: 30 } });
      const b = await biz({ name: "Kids R Kids", websiteUrl: "https://www.kidsrkids.com" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-kidsrkids.com-owner", firstName: "Jamie", lastName: null, name: "Jamie", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Kids R Kids" },
      ], totalFound: 31, totalAtDomain: 31, scope: "any" });
      const d = deps(fake);
      expect(await runEnrich(b.id, OWNER, d)).toEqual({ added: 0, updated: 0, skipped: "chain" });
      expect(d.enrichment.calls.enrich).toBe(0);
      expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).exclusionReasons).toEqual(["chain:apollo_headcount:31"]);
    });

    // The configured targeting filters have to reach Apollo, since they are what its total_entries
    // (and therefore the threshold above) counts.
    it("passes the owner's configured titles and seniorities to the provider", async () => {
      await saveOverrides(OWNER, { enrichment: { preferredTitles: ["principal"], seniorities: ["partner"] } });
      const b = await biz({ name: "Bella Nails", websiteUrl: "https://bellanails.com" });
      const fake = new FakeEnrichmentProvider();
      let seen: { titles?: string[]; seniorities?: string[] } | null = null;
      const inner = fake.searchPeople.bind(fake);
      fake.searchPeople = async (q, max) => { seen = { titles: q.titles, seniorities: q.seniorities }; return inner(q, max); };
      await runEnrich(b.id, OWNER, deps(fake));
      expect(seen).toEqual({ titles: ["principal"], seniorities: ["partner"] });
    });

    it("proceeds normally when totalAtDomain is below the threshold (a franchise brand, not a chain)", async () => {
      // 31 is the live-measured decision-maker count for kidsrkids.com — a real franchise SMB
      // prospect (see the ENRICH_CONFIG.chainHeadcountMin doc comment).
      const b = await biz({ name: "Kids R Kids", websiteUrl: "https://www.kidsrkids.com" });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-kidsrkids.com-owner", firstName: "Jamie", lastName: null, name: "Jamie", title: "Preschool Director", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Kids R Kids" },
      ], totalFound: 31, totalAtDomain: 31, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(r.skipped).toBeNull();
      expect(d.enrichment.calls.enrich).toBe(1);
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.exclusion).toBe("none");
    });
  });

  describe("candidate reveal by Apollo id (Task 1)", () => {
    it("reveals exactly the chosen candidate: no search, one reveal, respects the credit cap, writes the 'chosen by you' row", async () => {
      const b = await biz();
      const d = deps();
      const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-gm" });
      expect(d.enrichment.calls.search).toBe(0);
      expect(d.enrichment.calls.enrich).toBe(1);
      expect(r.added).toBe(1); // the gm has no email, but does have a LinkedIn — a new contact row
      const contacts = await prisma.contact.findMany({ where: { businessId: b.id } });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ type: "linkedin", personName: "Lee Tran", personTitle: "General Manager", apolloId: "fake-bellanails.com-gm", source: "apollo" });
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
      expect(log).toHaveLength(1);
      expect(log[0].message).toBe("Enriched via Apollo: revealed General Manager chosen by you; 1 new contact, 0 updated");
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.lastEnrichedAt).not.toBeNull();
    });

    it("bypasses the recheckDays recency gate (force implied) — a second reveal right after the first still runs", async () => {
      const b = await biz();
      await runEnrich(b.id, OWNER, deps(), { apolloId: "fake-bellanails.com-owner" });
      const d2 = deps();
      const r2 = await runEnrich(b.id, OWNER, d2, { apolloId: "fake-bellanails.com-gm" });
      expect(d2.enrichment.calls.search).toBe(0);
      expect(d2.enrichment.calls.enrich).toBe(1);
      expect(r2.skipped).toBeNull();
    });

    it("still throws CreditCapReachedError at the credit cap and logs the same skip row, without calling enrichPerson", async () => {
      await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 0 } });
      try {
        const b = await biz();
        const d = deps();
        await expect(runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-owner" })).rejects.toBeInstanceOf(CreditCapReachedError);
        expect(d.enrichment.calls.enrich).toBe(0);
        const log = await prisma.activityLog.findMany({ where: { businessId: b.id } });
        expect(log).toHaveLength(1);
        expect(log[0].message).toBe("Enrichment skipped: Apollo monthly credit cap reached");
      } finally {
        await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
      }
    });

    it("the auto path skips a suppressed candidate and reveals the next one instead", async () => {
      // Both ids use FakeEnrichmentProvider's built-in "-owner" suffix (see fake.ts's
      // enrichPerson) so the reveal — and its calls.enrich increment — goes through the fake's
      // own tracked implementation rather than a hand-rolled override, matching how the rest of
      // this suite exercises the fake.
      const b = await biz({ suppressedApolloIds: ["fake-domA-owner"] });
      const fake = new FakeEnrichmentProvider();
      fake.searchPeople = async () => ({ people: [
        { apolloId: "fake-domA-owner", firstName: "Pat", lastName: null, name: "Pat", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails & Spa" },
        { apolloId: "fake-domB-owner", firstName: "Robin", lastName: null, name: "Robin", title: "Co-Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Bella Nails & Spa" },
      ], totalFound: 2, totalAtDomain: 2, scope: "any" });
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d);
      expect(d.enrichment.calls.enrich).toBe(1);
      expect(r.added).toBe(1);
      const contact = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
      expect(contact).toMatchObject({ value: "owner@domb", apolloId: "fake-domB-owner" });
    });

    // Fix round R5: a reveal-by-id targets one specific candidate, so "Apollo has no match" is a
    // failure worth surfacing distinctly from a successful reveal that just had nothing to give —
    // and, since apolloId already bypasses the recheckDays gate, lastEnrichedAt must stay null so
    // a retry isn't blocked by the recency check it never went through in the first place.
    it("R5: logs 'Enrichment failed: Apollo could not reveal the chosen person', leaves lastEnrichedAt null, and returns skipped: 'reveal_failed' when the provider has no match", async () => {
      const b = await biz();
      const fake = new FakeEnrichmentProvider();
      fake.enrichPerson = async () => null;
      const d = deps(fake);
      const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-unknown-id" });
      expect(r).toEqual({ added: 0, updated: 0, skipped: "reveal_failed" });
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
      expect(log).toHaveLength(1);
      expect(log[0].message).toBe("Enrichment failed: Apollo could not reveal the chosen person");
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.lastEnrichedAt).toBeNull();
      expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(0);
    });

    // Fix round R4: the id stored on the contact row must be the one the rep actually clicked
    // (opts.apolloId), never whatever id a paid reveal happens to echo back on the person object
    // — Business.suppressedApolloIds and Business.candidates both key on the requested id.
    it("R4: stores the requested apolloId on the contact row, not the one the provider echoes back", async () => {
      const b = await biz();
      const fake = new FakeEnrichmentProvider();
      fake.enrichPerson = async () => ({
        apolloId: "echoed-id-from-provider",
        firstName: "Al", lastName: "Bert", name: "Al Bert", title: "Owner",
        email: "al@bellanails.com", emailStatus: "verified", linkedinUrl: null, hasEmail: true, orgName: null,
      });
      const d = deps(fake);
      await runEnrich(b.id, OWNER, d, { apolloId: "requested-id" });
      const contact = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
      expect(contact.apolloId).toBe("requested-id");
    });

    describe("apolloId backfill scoped to Apollo-sourced rows (R3)", () => {
      it("never backfills apolloId onto an existing website-sourced row, and leaves 'updated' at 0 when nothing else changes", async () => {
        const b = await biz();
        await prisma.contact.create({
          data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@bellanails.com", source: "website", personName: "Maria Lopez", personTitle: "Owner" },
        });
        const d = deps();
        const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-owner" });
        const contact = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
        expect(contact.source).toBe("website");
        expect(contact.apolloId).toBeNull();
        expect(r.updated).toBe(0);
      });

      it("backfills apolloId onto an existing Apollo-sourced row missing it, but a backfill-only change does not count toward 'updated'", async () => {
        const b = await biz();
        await prisma.contact.create({
          data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@bellanails.com", source: "apollo", personName: "Maria Lopez", personTitle: "Owner" },
        });
        const d = deps();
        const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-owner" });
        const contact = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
        expect(contact.apolloId).toBe("fake-bellanails.com-owner");
        expect(r.updated).toBe(0);
      });

      it("a backfill alongside a genuine name/title change still counts toward 'updated'", async () => {
        const b = await biz();
        await prisma.contact.create({
          data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@bellanails.com", source: "apollo" },
        });
        const d = deps();
        const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-owner" });
        const contact = await prisma.contact.findFirstOrThrow({ where: { businessId: b.id, type: "email" } });
        expect(contact).toMatchObject({ apolloId: "fake-bellanails.com-owner", personName: "Maria Lopez", personTitle: "Owner" });
        expect(r.updated).toBe(1);
      });
    });
  });

  // Whole-branch review H1/L2/M3.
  describe("credit ledger, suppressed reveal, and revealed marking (whole-branch review)", () => {
    it("M3: a direct apolloId reveal for a suppressed person is skipped, with no provider call and no credit spent", async () => {
      const b = await biz({ suppressedApolloIds: ["fake-bellanails.com-owner"] });
      const d = deps();
      const r = await runEnrich(b.id, OWNER, d, { apolloId: "fake-bellanails.com-owner" });
      expect(r).toEqual({ added: 0, updated: 0, skipped: "suppressed" });
      expect(d.enrichment.calls.enrich).toBe(0);
      const log = await prisma.activityLog.findMany({ where: { businessId: b.id } });
      expect(log).toHaveLength(1);
      expect(log[0].message).toBe("Enrichment skipped: that person was removed as not the decision-maker");
      const creditLog = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "credit_spent" } });
      expect(creditLog).toHaveLength(0);
    });

    it("PATCH suppress's idempotent no-op branch is unaffected by this — a suppressed id skipped here never reaches lastEnrichedAt", async () => {
      const b = await biz({ suppressedApolloIds: ["fake-bellanails.com-owner"] });
      await runEnrich(b.id, OWNER, deps(), { apolloId: "fake-bellanails.com-owner" });
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      expect(after.lastEnrichedAt).toBeNull();
    });

    it("H1: a direct reveal that returns an email logs one credit_spent row; one that returns no email logs none", async () => {
      const bWithEmail = await biz();
      await runEnrich(bWithEmail.id, OWNER, deps(), { apolloId: "fake-bellanails.com-owner" }); // has email
      const emailLog = await prisma.activityLog.findMany({ where: { businessId: bWithEmail.id, kind: "credit_spent" } });
      expect(emailLog).toHaveLength(1);
      expect(emailLog[0].message).toBe("Apollo credit: email revealed");

      const bNoEmail = await biz();
      await runEnrich(bNoEmail.id, OWNER, deps(), { apolloId: "fake-bellanails.com-gm" }); // no email, LinkedIn only
      const noEmailLog = await prisma.activityLog.findMany({ where: { businessId: bNoEmail.id, kind: "credit_spent" } });
      expect(noEmailLog).toHaveLength(0);
    });

    it("L2: a direct reveal marks the matching candidate's revealedAt in the stored candidate set", async () => {
      const b = await biz({
        candidates: {
          fetchedAt: new Date().toISOString(),
          scope: "any",
          totalAtDomain: 1,
          candidates: [{ apolloId: "fake-bellanails.com-owner", firstName: "Maria", title: "Owner", hasEmail: true, orgName: null, rank: 0, revealedAt: null }],
        },
      });
      await runEnrich(b.id, OWNER, deps(), { apolloId: "fake-bellanails.com-owner" });
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      const set = after.candidates as unknown as { candidates: { apolloId: string; revealedAt: string | null }[] };
      expect(set.candidates[0].revealedAt).not.toBeNull();
    });

    it("L2: the auto-reveal loop also marks revealedAt for the person it reveals", async () => {
      const b = await biz({
        candidates: {
          fetchedAt: new Date().toISOString(),
          scope: "any",
          totalAtDomain: 1,
          candidates: [{ apolloId: "fake-bellanails.com-owner", firstName: "Maria", title: "Owner", hasEmail: true, orgName: null, rank: 0, revealedAt: null }],
        },
      });
      await runEnrich(b.id, OWNER, deps());
      const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
      const set = after.candidates as unknown as { candidates: { apolloId: string; revealedAt: string | null }[] };
      expect(set.candidates[0].revealedAt).not.toBeNull();
    });
  });
});
