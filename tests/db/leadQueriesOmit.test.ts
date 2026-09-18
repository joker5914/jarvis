import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { listBusinesses, getBusinessDetail } from "@/lib/leads/queries";
import { leadFiltersSchema } from "@/lib/leads/filters";

// Fix round (R1): candidates/candidatesAt/primaryPerson/suppressedApolloIds are detail-only —
// the list query (and therefore the /api/businesses payload and the CSV export, both of which
// go through listBusinesses) must never carry them, even though a `select`-less `include` would
// otherwise return every Business scalar column by default. getBusinessDetail (the lead drawer)
// still gets all four.
const OWNER = "test-leadqueries-omit-owner";

async function cleanup() {
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

async function bizWithCandidates() {
  return prisma.business.create({
    data: {
      ownerId: OWNER,
      name: "Omit Test Biz",
      source: "zip_search",
      candidates: { fetchedAt: new Date().toISOString(), scope: "any", totalAtDomain: 1, candidates: [{ apolloId: "fake-a", firstName: "A", title: "Owner", hasEmail: true, orgName: null, rank: 0 }] },
      candidatesAt: new Date(),
      primaryPerson: "Albert",
      suppressedApolloIds: ["fake-b"],
    },
  });
}

describe("listBusinesses omits candidate/primary-contact fields; getBusinessDetail keeps them", () => {
  it("list row (as used by /api/businesses and the CSV export) has none of the four detail-only keys", async () => {
    await bizWithCandidates();
    const { items } = await listBusinesses(leadFiltersSchema.parse({}), OWNER);
    expect(items).toHaveLength(1);
    const row = items[0] as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty("candidates");
    expect(row).not.toHaveProperty("candidatesAt");
    expect(row).not.toHaveProperty("primaryPerson");
    expect(row).not.toHaveProperty("suppressedApolloIds");
    // Sanity: this isn't just an empty row — ordinary list fields are still there.
    expect(row).toHaveProperty("name", "Omit Test Biz");
  });

  it("getBusinessDetail (the lead drawer) still returns all four", async () => {
    const b = await bizWithCandidates();
    const detail = await getBusinessDetail(b.id, OWNER);
    expect(detail?.primaryPerson).toBe("Albert");
    expect(detail?.suppressedApolloIds).toEqual(["fake-b"]);
    expect(detail?.candidatesAt).not.toBeNull();
    expect(detail?.candidates).not.toBeNull();
  });
});
