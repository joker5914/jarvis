import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { listBusinesses, getBusinessDetail } from "@/lib/leads/queries";
import { leadFiltersSchema } from "@/lib/leads/filters";

// Fix round (R1): candidates/candidatesAt/suppressedApolloIds are detail-only — the list query
// (and therefore the /api/businesses payload and the CSV export, both of which go through
// listBusinesses) must never carry them, even though a `select`-less `include` would otherwise
// return every Business scalar column by default. getBusinessDetail (the lead drawer) still gets
// all five.
//
// Task 3 amendment: `primaryPerson` is no longer in that omit — LeadsTable's contact column
// needs it in the list row — so this suite now asserts the opposite for that one field:
// present in the list row, not just in the detail. `primaryPersonTitle` (Task 3's new column)
// joins the still-omitted set instead.
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
      primaryPersonTitle: "Owner",
      suppressedApolloIds: ["fake-b"],
    },
  });
}

describe("listBusinesses omits candidate JSON but keeps the primary contact name; getBusinessDetail keeps everything", () => {
  it("list row (as used by /api/businesses and the CSV export) has the primary name but none of the three JSON/title detail-only keys", async () => {
    await bizWithCandidates();
    const { items } = await listBusinesses(leadFiltersSchema.parse({}), OWNER);
    expect(items).toHaveLength(1);
    const row = items[0] as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty("candidates");
    expect(row).not.toHaveProperty("candidatesAt");
    expect(row).not.toHaveProperty("primaryPersonTitle");
    expect(row).not.toHaveProperty("suppressedApolloIds");
    // Task 3 amendment: primaryPerson is ordinary list data now — LeadsTable's contact column reads it.
    expect(row).toHaveProperty("primaryPerson", "Albert");
    // Sanity: this isn't just an empty row — ordinary list fields are still there.
    expect(row).toHaveProperty("name", "Omit Test Biz");
  });

  it("getBusinessDetail (the lead drawer) still returns all five", async () => {
    const b = await bizWithCandidates();
    const detail = await getBusinessDetail(b.id, OWNER);
    expect(detail?.primaryPerson).toBe("Albert");
    expect(detail?.primaryPersonTitle).toBe("Owner");
    expect(detail?.suppressedApolloIds).toEqual(["fake-b"]);
    expect(detail?.candidatesAt).not.toBeNull();
    expect(detail?.candidates).not.toBeNull();
  });
});
