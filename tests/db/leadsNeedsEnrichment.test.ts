import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { buildBusinessWhere, parseLeadFilters } from "@/lib/leads/filters";

const OWNER = "test-needs-enrichment-owner";

async function cleanup() {
  await prisma.contact.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("Leads needs=enrichment filter", () => {
  it("returns only website-bearing, non-excluded, yellow-or-better leads never enriched and without an email contact", async () => {
    const a = await prisma.business.create({
      data: { ownerId: OWNER, name: "A Yellow No Email", source: "zip_search", websiteUrl: "https://a.example.com", contactQualityBand: "yellow", exclusion: "none" },
    });
    const b = await prisma.business.create({
      data: { ownerId: OWNER, name: "B Green Has Email", source: "zip_search", websiteUrl: "https://b.example.com", contactQualityBand: "green", exclusion: "none" },
    });
    await prisma.contact.create({ data: { ownerId: OWNER, businessId: b.id, type: "email", value: "owner@b.example.com", source: "website" } });
    await prisma.business.create({
      data: { ownerId: OWNER, name: "C No Website", source: "zip_search", websiteUrl: null, contactQualityBand: "green", exclusion: "none" },
    });
    await prisma.business.create({
      data: { ownerId: OWNER, name: "D Excluded", source: "zip_search", websiteUrl: "https://d.example.com", contactQualityBand: "green", exclusion: "enterprise" },
    });
    await prisma.business.create({
      data: { ownerId: OWNER, name: "E Red Band", source: "zip_search", websiteUrl: "https://e.example.com", contactQualityBand: "red", exclusion: "none" },
    });

    const filters = parseLeadFilters(new URLSearchParams("needs=enrichment"));
    const where = buildBusinessWhere(filters, OWNER);
    const items = await prisma.business.findMany({ where });

    expect(items.map((i) => i.id)).toEqual([a.id]);
  });
});
