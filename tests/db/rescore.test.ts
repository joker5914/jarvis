import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { rescoreExclusions } from "@/lib/jobs/rescore";
import { mergeConfig } from "@/lib/config/runtime";

const OWNER = "test-rescore-owner";

async function cleanup() {
  await prisma.activityLog.deleteMany({ where: { ownerId: OWNER } });
  await prisma.business.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

function cfgWithChains(chains: string[]) {
  return mergeConfig({ exclusion: { chains } });
}

async function biz(over: Partial<Parameters<typeof prisma.business.create>[0]["data"]> = {}) {
  return prisma.business.create({ data: { ownerId: OWNER, name: "Untitled", source: "zip_search", exclusion: "none", ...over } });
}

describe("rescoreExclusions", () => {
  it("excludes the businesses whose name matches a newly added chain, leaves the rest untouched, and logs an activity row per newly excluded business", async () => {
    const zumiez = await biz({ name: "Zumiez" });
    const bella = await biz({ name: "Bella Nails" });
    const zumiezOutlet = await biz({ name: "Zumiez Outlet" });

    const result = await rescoreExclusions(OWNER, cfgWithChains(["zumiez"]));
    expect(result).toEqual({ scanned: 3, newlyExcluded: 2, restored: 0 });

    const [z, b, zo] = await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: zumiez.id } }),
      prisma.business.findUniqueOrThrow({ where: { id: bella.id } }),
      prisma.business.findUniqueOrThrow({ where: { id: zumiezOutlet.id } }),
    ]);
    expect(z.exclusion).toBe("enterprise");
    expect(z.exclusionReasons[0]).toMatch(/^chain:zumiez/);
    expect(zo.exclusion).toBe("enterprise");
    expect(b.exclusion).toBe("none");
    expect(b.exclusionReasons).toEqual([]);

    const bellaActivity = await prisma.activityLog.findMany({ where: { businessId: bella.id } });
    expect(bellaActivity).toHaveLength(0);

    const zumiezActivity = await prisma.activityLog.findMany({ where: { businessId: zumiez.id } });
    expect(zumiezActivity).toHaveLength(1);
    expect(zumiezActivity[0]).toMatchObject({ kind: "status_changed" });
    expect(zumiezActivity[0].message).toMatch(/^Excluded as chain: chain:zumiez/);

    const outletActivity = await prisma.activityLog.findMany({ where: { businessId: zumiezOutlet.id } });
    expect(outletActivity).toHaveLength(1);
    expect(outletActivity[0].message).toMatch(/^Excluded as chain:/);
  });

  it("is idempotent: a second run against the same config makes no further changes", async () => {
    await biz({ name: "Zumiez" });
    await biz({ name: "Bella Nails" });
    await biz({ name: "Zumiez Outlet" });

    await rescoreExclusions(OWNER, cfgWithChains(["zumiez"]));
    const second = await rescoreExclusions(OWNER, cfgWithChains(["zumiez"]));
    expect(second).toEqual({ scanned: 3, newlyExcluded: 0, restored: 0 });
  });

  it("keeps a business excluded by an apollo_headcount reason even when its name matches nothing in the chain list", async () => {
    const chain = await biz({ name: "Local Sounding Co", exclusion: "enterprise", exclusionReasons: ["chain:apollo_headcount:2000"] });

    const result = await rescoreExclusions(OWNER, cfgWithChains(["zumiez"]));
    expect(result.scanned).toBe(1);

    const after = await prisma.business.findUniqueOrThrow({ where: { id: chain.id } });
    expect(after.exclusion).toBe("enterprise");
    expect(after.exclusionReasons).toEqual(["chain:apollo_headcount:2000"]);
  });
});
