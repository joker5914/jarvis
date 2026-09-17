import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { PATCH } from "@/app/api/businesses/[id]/route";

// The route resolves the actor via getActor(), which is always "local-user" (see src/lib/actor.ts).
const OWNER = "local-user";

function jsonReq(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

async function biz(name: string, over: Partial<Parameters<typeof prisma.business.create>[0]["data"]> = {}) {
  return prisma.business.create({ data: { ownerId: OWNER, name, source: "zip_search", exclusion: "none", ...over } });
}

async function chains(): Promise<string[]> {
  const cfg = await prisma.appConfig.findUnique({ where: { ownerId: OWNER } });
  return (cfg?.overrides as { exclusion?: { chains?: string[] } } | null)?.exclusion?.chains ?? [];
}

const NAMES = ["Zumiez", "Zumiez Outlet", "H&R Block", "Walmart Supercenter"];

async function cleanup() {
  await prisma.business.deleteMany({ where: { ownerId: OWNER, name: { in: NAMES } } });
  await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("PATCH /api/businesses/:id markAsChain", () => {
  it("excludes the business, adds its chain key to the owner's chain list, and re-scores look-alikes", async () => {
    const b = await biz("Zumiez");
    const lookalike = await biz("Zumiez Outlet");

    const res = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.exclusion).toBe("enterprise");
    expect(body.rescore.newlyExcluded).toBeGreaterThanOrEqual(1);

    expect(await chains()).toContain("zumiez");

    const after = await prisma.business.findUniqueOrThrow({ where: { id: lookalike.id } });
    expect(after.exclusion).toBe("enterprise");
  });

  // B1 (fix round review): mergeConfig REPLACES the chains array wholesale when an override is
  // present rather than merging element-wise, so seeding the new chain-list entry from the raw
  // override (instead of the effective/merged list) would silently wipe every default seed entry
  // on the very first click. A fixture named after a DEFAULT seed entry must stay excluded after
  // marking an unrelated business as a chain.
  it("does not wipe the default seed chain list on the first click", async () => {
    const walmart = await biz("Walmart Supercenter");
    // scoreSmbFit runs at biz() creation time via zip-search normally, not via a raw prisma.create
    // here, so seed the pre-existing exclusion state this fixture would already have from the
    // default "walmart" seed entry before any override exists.
    await prisma.business.update({ where: { id: walmart.id }, data: { exclusion: "enterprise", exclusionReasons: ["chain:walmart"] } });

    const b = await biz("Zumiez");
    const res = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res.status).toBe(200);

    const list = await chains();
    expect(list).toContain("zumiez");
    expect(list).toContain("walmart"); // the default seed entry, still present after the save

    const after = await prisma.business.findUniqueOrThrow({ where: { id: walmart.id } });
    expect(after.exclusion).toBe("enterprise");
  });

  // B2 (fix round review): normalizeName strips "&", so "H&R Block" would normalize to "h r
  // block" — a key hasWord could never match against the raw lowercase name again. chainKeyFor
  // keeps the punctuation intact.
  it("keeps punctuation in the persisted chain key (H&R Block)", async () => {
    const b = await biz("H&R Block");
    const res = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.exclusion).toBe("enterprise");
    expect(await chains()).toContain("h&r block");
  });

  it("is idempotent: a second call does not duplicate the chain-list entry", async () => {
    const b = await biz("Zumiez");
    await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    const res2 = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res2.status).toBe(200);

    const list = await chains();
    expect(list.filter((c) => c === "zumiez")).toHaveLength(1);
  });

  it("rejects markAsChain: false with a 400 (only literal true is accepted)", async () => {
    const b = await biz("Zumiez");
    const res = await PATCH(jsonReq({ markAsChain: false }), ctxFor(b.id));
    expect(res.status).toBe(400);
  });

  it("rejects markAsChain and clearChain together with a 400 (mutually exclusive)", async () => {
    const b = await biz("Zumiez");
    const res = await PATCH(jsonReq({ markAsChain: true, clearChain: true }), ctxFor(b.id));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/businesses/:id clearChain (Restore as SMB)", () => {
  it("restores just this business, removes its key from the chain list, and does not touch a look-alike", async () => {
    const b = await biz("Zumiez");
    const lookalike = await biz("Zumiez Outlet");
    await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect((await prisma.business.findUniqueOrThrow({ where: { id: lookalike.id } })).exclusion).toBe("enterprise");
    expect(await chains()).toContain("zumiez");

    const res = await PATCH(jsonReq({ clearChain: true }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.exclusion).toBe("none");
    expect(body.business.exclusionReasons).toEqual([]);
    expect(body.rescore).toEqual({ scanned: 1, newlyExcluded: 0, restored: 1 });

    expect(await chains()).not.toContain("zumiez");

    // Scoped to this one business only — the look-alike keeps its own exclusion, since restoring
    // it too would require the user to have reviewed it, which clearChain does not assume.
    const lookalikeAfter = await prisma.business.findUniqueOrThrow({ where: { id: lookalike.id } });
    expect(lookalikeAfter.exclusion).toBe("enterprise");

    const activity = await prisma.activityLog.findMany({ where: { businessId: b.id, message: "Restored as SMB" } });
    expect(activity).toHaveLength(1);
  });

  it("strips a chain:apollo_headcount reason too, but leaves an unrelated reason (e.g. a TDLR cost_over_) in place", async () => {
    const b = await biz("Some Franchise Location", {
      exclusion: "enterprise",
      exclusionReasons: ["chain:apollo_headcount:4000", "cost_over_2000000"],
    });

    const res = await PATCH(jsonReq({ clearChain: true }), ctxFor(b.id));
    const body = await res.json();
    expect(body.business.exclusion).toBe("enterprise"); // still excluded — cost_over_ reason remains
    expect(body.business.exclusionReasons).toEqual(["cost_over_2000000"]);
    expect(body.rescore.restored).toBe(0); // did not actually flip to "none"
  });

  it("rejects clearChain: false with a 400 (only literal true is accepted)", async () => {
    const b = await biz("Zumiez");
    const res = await PATCH(jsonReq({ clearChain: false }), ctxFor(b.id));
    expect(res.status).toBe(400);
  });
});
