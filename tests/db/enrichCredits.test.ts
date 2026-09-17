import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runEnrich } from "@/lib/jobs/enrich";
import { creditStatus } from "@/lib/enrichment/credits";
import { CreditCapReachedError } from "@/lib/providers/errors";
import { loadConfig, saveOverrides } from "@/lib/config/runtime";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import type { EnrichPerson, PeopleSearchQuery, PeopleSearchResult } from "@/lib/providers/types";
import type { JobDeps } from "@/lib/jobs/shared";

const OWNER = "test-enrich-credits-owner";

async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
  await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

/** Marks the second search hit (General Manager) as hasEmail so a two-person run pays to reveal both. */
class BothHaveEmailProvider extends FakeEnrichmentProvider {
  async searchPeople(q: PeopleSearchQuery, max: number): Promise<PeopleSearchResult> {
    const result = await super.searchPeople(q, max);
    return { ...result, people: result.people.map((p) => (p.title === "General Manager" ? { ...p, hasEmail: true } : p)) };
  }
  async enrichPerson(apolloId: string): Promise<EnrichPerson | null> {
    const person = await super.enrichPerson(apolloId);
    if (person && person.title === "General Manager") return { ...person, email: "gm@fake.example", emailStatus: "verified", hasEmail: true };
    return person;
  }
}

function deps(enrichment: FakeEnrichmentProvider = new FakeEnrichmentProvider()): JobDeps & { enrichment: FakeEnrichmentProvider } {
  return {
    providers: { geocode: new FakeGeocodeProvider(), discovery: new FakeDiscoveryProvider(), validation: new FakeValidationProvider(), registry: new FakeRegistryProvider(), fetcher: fakeFetcher, enrichment },
    log: () => {},
    enrichment,
  } as never;
}

async function biz(over: Partial<Parameters<typeof prisma.business.create>[0]["data"]> = {}) {
  return prisma.business.create({ data: { ownerId: OWNER, name: "Bella Nails & Spa", websiteUrl: "https://www.bellanails.com", formattedAddress: "123 Main St, Houston, TX 77084, USA", source: "zip_search", ...over } });
}

describe("runEnrich: Apollo credit policy", () => {
  it("enriches one person by default and skips people Apollo flags as having no email", async () => {
    const b = await biz();
    const d = deps();
    const r = await runEnrich(b.id, OWNER, d);
    expect(d.enrichment.calls).toEqual({ search: 1, enrich: 1, orgSearch: 0 });
    expect(await prisma.contact.count({ where: { businessId: b.id, type: "email" } })).toBe(1);
    expect(r.added).toBe(1);
  });

  it("with people=2 still skips the no-email hit instead of paying to reveal it", async () => {
    const b = await biz();
    const d = deps();
    await runEnrich(b.id, OWNER, d, { people: 2 });
    expect(d.enrichment.calls.enrich).toBe(1); // Lee (hasEmail false) never revealed
  });

  it("refuses at the monthly cap without any provider call and logs one activity", async () => {
    await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 1 } });
    const b1 = await biz();
    await runEnrich(b1.id, OWNER, deps()); // uses the 1 credit
    const b2 = await biz({ name: "Corner Cafe", websiteUrl: "https://cornercafe.com" });
    const d = deps();
    await expect(runEnrich(b2.id, OWNER, d)).rejects.toBeInstanceOf(CreditCapReachedError);
    expect(d.enrichment.calls).toEqual({ search: 0, enrich: 0, orgSearch: 0 });
    const log = await prisma.activityLog.findMany({ where: { businessId: b2.id } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toMatch(/credit cap/i);
    const status = await creditStatus(OWNER, await loadConfig(OWNER));
    expect(status).toMatchObject({ used: 1, cap: 1, remaining: 0 });
  });

  // Task 1 follow-up: when Apollo's own account balance is the binding constraint (already at/below
  // 0, independent of what the app cap would otherwise allow), the activity row should say so
  // specifically rather than blaming "the monthly credit cap" — which reads as an app-side setting
  // the user could just raise, when actually Apollo itself has nothing left this cycle.
  it("logs 'Apollo account is out of credits' (not the generic cap message) when Apollo's live balance is the binding constraint", async () => {
    const fake = new FakeEnrichmentProvider();
    fake.fakeCreditUsage = {
      limit: 2510,
      consumed: 2510,
      leftOver: 0,
      cycleStart: new Date("2026-09-01T00:00:00Z"),
      cycleEnd: new Date("2026-10-01T00:00:00Z"),
      fetchedAt: new Date(),
    };
    const b = await biz();
    const d = deps(fake);
    await expect(runEnrich(b.id, OWNER, d)).rejects.toBeInstanceOf(CreditCapReachedError);
    expect(d.enrichment.calls).toEqual({ search: 0, enrich: 0, orgSearch: 0 });
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("Enrichment skipped: Apollo account is out of credits");
  });

  it("stops mid-run when the cap is hit between people (people=2, cap=1) and still finishes the business", async () => {
    await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 1 } });
    const b = await biz();
    const d = deps(new BothHaveEmailProvider());
    const r = await runEnrich(b.id, OWNER, d, { people: 2 });
    expect(d.enrichment.calls.enrich).toBe(1); // only the first (Maria) reveal is paid before the cap stops further reveals
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).not.toBeNull(); // partial but complete run
    expect(r.added).toBe(1);
  });
});
