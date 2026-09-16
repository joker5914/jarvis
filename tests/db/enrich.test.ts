import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { runEnrich } from "@/lib/jobs/enrich";
import { FakeEnrichmentProvider, FakeValidationProvider, FakeDiscoveryProvider, FakeGeocodeProvider, FakeRegistryProvider, fakeFetcher } from "@/lib/providers/fake";
import { BudgetExhaustedError } from "@/lib/providers/budget";
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
    expect(r).toEqual({ added: 2, updated: 0, skipped: null });
    expect(d.enrichment.calls).toEqual({ search: 1, enrich: 2 });
    const contacts = await prisma.contact.findMany({ where: { businessId: b.id }, orderBy: { value: "asc" } });
    const email = contacts.find((c) => c.type === "email");
    expect(email).toMatchObject({ value: "owner@bellanails.com", source: "apollo", personName: "Maria Lopez", personTitle: "Owner", validationStatus: "valid" });
    expect(contacts.filter((c) => c.type === "linkedin")).toHaveLength(2);
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).not.toBeNull();
    expect(after.contactQualityScore).toBeGreaterThanOrEqual(45); // email valid (30) + named person (15) at minimum
    const log = await prisma.activityLog.findMany({ where: { businessId: b.id, kind: "enriched" } });
    expect(log).toHaveLength(1);
    expect(log[0].message).toMatch(/Apollo/);
  });
  it("is idempotent: a second run updates instead of duplicating", async () => {
    const b = await biz();
    await runEnrich(b.id, OWNER, deps());
    const r = await runEnrich(b.id, OWNER, deps());
    expect(r.added).toBe(0);
    expect(await prisma.contact.count({ where: { businessId: b.id } })).toBe(3);
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
    const log = await prisma.activityLog.findFirst({ where: { businessId: b.id } });
    expect(log?.message).toMatch(/budget/i);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).lastEnrichedAt).toBeNull();
  });
});
