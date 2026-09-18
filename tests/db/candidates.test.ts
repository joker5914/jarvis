import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { findCandidates, type CandidateSet } from "@/lib/enrichment/candidates";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import type { JobDeps } from "@/lib/jobs/shared";

const OWNER = "test-candidates-owner";
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

describe("findCandidates", () => {
  it("stores a CandidateSet with the fake provider's two people ranked Owner first, scope/totalAtDomain from the result, and stamps candidatesAt", async () => {
    const b = await biz();
    const d = deps();
    const set = await findCandidates(b.id, OWNER, d);
    expect(d.enrichment.calls).toEqual({ search: 1, enrich: 0, orgSearch: 0 });
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates[0]).toMatchObject({ apolloId: "fake-bellanails.com-owner", firstName: "Maria", title: "Owner", hasEmail: true, rank: 0 });
    expect(set.candidates[1]).toMatchObject({ apolloId: "fake-bellanails.com-gm", firstName: "Lee", title: "General Manager", hasEmail: false, rank: 1 });
    // biz()'s address has both a city and a state, so the fake reports scope "city".
    expect(set.scope).toBe("city");
    expect(set.totalAtDomain).toBe(2);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.candidatesAt).not.toBeNull();
    expect((after.candidates as unknown as CandidateSet).candidates).toHaveLength(2);
  });

  it("filters out a suppressed Apollo id", async () => {
    const b = await biz({ suppressedApolloIds: ["fake-bellanails.com-gm"] });
    const d = deps();
    const set = await findCandidates(b.id, OWNER, d);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].apolloId).toBe("fake-bellanails.com-owner");
  });

  it("drops a candidate whose Apollo-reported company doesn't match the lead on the no-domain branch, yielding an empty set with no activity row and no reveal", async () => {
    const b = await biz({ name: "Whiskey Blades", websiteUrl: "https://whiskeyblades.booksy.com/" });
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({
      people: [
        { apolloId: "fake-booksy-exec", firstName: "Sam", lastName: null, name: "Sam", title: "CEO", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Booksy" },
      ],
      totalFound: 1,
      totalAtDomain: 1,
      scope: "any",
    });
    const d = deps(fake);
    const set = await findCandidates(b.id, OWNER, d);
    expect(set.candidates).toEqual([]);
    expect(d.enrichment.calls.enrich).toBe(0);
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(logs).toHaveLength(0);
  });

  it("does not apply the org-name guard when the search was filtered by the lead's own domain", async () => {
    const b = await biz({ name: "Dr. Jane Smith DDS", websiteUrl: "https://www.pearlandfamilydentistry.com/" });
    const fake = new FakeEnrichmentProvider();
    fake.searchPeople = async () => ({
      people: [
        { apolloId: "fake-pfd-owner", firstName: "Jane", lastName: null, name: "Jane", title: "Owner", email: null, emailStatus: null, linkedinUrl: null, hasEmail: true, orgName: "Pearland Family Dentistry" },
      ],
      totalFound: 1,
      totalAtDomain: 1,
      scope: "any",
    });
    const d = deps(fake);
    const set = await findCandidates(b.id, OWNER, d);
    expect(set.candidates).toHaveLength(1);
    expect(set.candidates[0].apolloId).toBe("fake-pfd-owner");
  });

  it("never reveals: enrichPerson is never called regardless of how many candidates come back", async () => {
    const b = await biz();
    const d = deps();
    await findCandidates(b.id, OWNER, d);
    expect(d.enrichment.calls.enrich).toBe(0);
  });

  // Whole-branch review H1: a no-domain lead's free "Find people" call falls back to a credited
  // Organization Search — this resolves and persists `apolloOrgDomain` so a later call can route
  // through the free domain branch instead, and logs the real spend to the credit ledger (since
  // Contact rows alone never see an Organization Search — nothing gets revealed here at all).
  it("H1: a no-domain business gets apolloOrgDomain resolved and persisted, and logs one credit_spent row for the Organization Search", async () => {
    const b = await biz({ websiteUrl: null });
    const d = deps();
    const set = await findCandidates(b.id, OWNER, d);
    expect(d.enrichment.calls.orgSearch).toBe(1);
    expect(set.candidates.length).toBeGreaterThan(0);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.apolloOrgDomain).toBeTruthy();
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "credit_spent" } });
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("Apollo credit: organization search");
  });

  it("H1: once apolloOrgDomain is memoized, a later findCandidates call is free (no Organization Search, no credit logged)", async () => {
    const b = await biz({ websiteUrl: null, apolloOrgDomain: "bellanailsspa.example" });
    const d = deps();
    await findCandidates(b.id, OWNER, d);
    expect(d.enrichment.calls.orgSearch).toBe(0);
    const logs = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "credit_spent" } });
    expect(logs).toHaveLength(0);
  });
});
