import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";

beforeEach(async () => {
  await prisma.business.deleteMany();
  await prisma.search.deleteMany();
});

describe("schema", () => {
  it("creates a search and a business linked through SearchBusiness", async () => {
    const search = await prisma.search.create({ data: { zip: "77084" } });
    const biz = await prisma.business.create({
      data: {
        name: "Test Nails",
        zip: "77084",
        searches: { create: { searchId: search.id, surfacedByCategory: "nail_salon" } },
      },
      include: { searches: true },
    });
    expect(biz.ownerId).toBe("local-user");
    expect(biz.searches[0].searchId).toBe(search.id);
    expect(biz.outreachStatus).toBe("not_contacted");
  });
});
