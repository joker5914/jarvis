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

async function biz(name: string) {
  return prisma.business.create({ data: { ownerId: OWNER, name, source: "zip_search", exclusion: "none" } });
}

async function cleanup() {
  await prisma.business.deleteMany({ where: { ownerId: OWNER, name: { in: ["Zumiez", "Zumiez Outlet"] } } });
  await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
}
beforeEach(cleanup);
afterAll(cleanup);

describe("PATCH /api/businesses/:id markAsChain", () => {
  it("excludes the business, adds its normalized name to the owner's chain list, and re-scores look-alikes", async () => {
    const b = await biz("Zumiez");
    const lookalike = await biz("Zumiez Outlet");

    const res = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business.exclusion).toBe("enterprise");
    expect(body.rescore.newlyExcluded).toBeGreaterThanOrEqual(1);

    const cfg = await prisma.appConfig.findUniqueOrThrow({ where: { ownerId: OWNER } });
    const chains = (cfg.overrides as { exclusion?: { chains?: string[] } }).exclusion?.chains ?? [];
    expect(chains).toContain("zumiez");

    const after = await prisma.business.findUniqueOrThrow({ where: { id: lookalike.id } });
    expect(after.exclusion).toBe("enterprise");
  });

  it("is idempotent: a second call does not duplicate the chain-list entry", async () => {
    const b = await biz("Zumiez");
    await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    const res2 = await PATCH(jsonReq({ markAsChain: true }), ctxFor(b.id));
    expect(res2.status).toBe(200);

    const cfg = await prisma.appConfig.findUniqueOrThrow({ where: { ownerId: OWNER } });
    const chains = (cfg.overrides as { exclusion?: { chains?: string[] } }).exclusion?.chains ?? [];
    expect(chains.filter((c) => c === "zumiez")).toHaveLength(1);
  });

  it("rejects markAsChain: false with a 400 (only literal true is accepted)", async () => {
    const b = await biz("Zumiez");
    const res = await PATCH(jsonReq({ markAsChain: false }), ctxFor(b.id));
    expect(res.status).toBe(400);
  });
});
