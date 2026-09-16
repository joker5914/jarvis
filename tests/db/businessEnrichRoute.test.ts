import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ProviderConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { POST as enrichPost } from "@/app/api/businesses/[id]/enrich/route";
import { POST as bulkPost } from "@/app/api/businesses/bulk/route";

// The routes resolve the actor via getActor(), which is always "local-user" (see src/lib/actor.ts).
const OWNER = "local-user";

function jsonReq(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const noCtx = { params: Promise.resolve({}) };

async function biz(exclusion: "none" | "enterprise" = "none") {
  return prisma.business.create({
    data: { ownerId: OWNER, name: "Enrich Route Test Biz", source: "zip_search", exclusion },
  });
}

async function cleanup() {
  await prisma.business.deleteMany({ where: { ownerId: OWNER, name: "Enrich Route Test Biz" } });
}

describe("enrich routes: excluded businesses (M2)", () => {
  let prevJobMode: string | undefined;

  beforeAll(() => {
    // Run enqueueEnrich inline so this test never needs a live pg-boss connection (same pattern
    // as tests/db/scannerTick.test.ts).
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
  });
  afterAll(async () => {
    process.env.JOB_MODE = prevJobMode;
    await cleanup();
  });
  beforeEach(cleanup);

  it("POST /businesses/:id/enrich returns 409 for an excluded business and never queues", async () => {
    const b = await biz("enterprise");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Excluded businesses are not enriched");
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).toBeNull();
  });

  it("POST /businesses/:id/enrich still queues a non-excluded business", async () => {
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(202);
  });

  it("POST /businesses/bulk enrich skips excluded businesses silently but reports enrichSkipped", async () => {
    const included = await biz("none");
    const excluded = await biz("enterprise");
    const res = await bulkPost(jsonReq({ ids: [included.id, excluded.id], enrich: true }), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrichQueued).toBe(1);
    expect(body.enrichFailed).toBe(0);
    expect(body.enrichSkipped).toBe(1);
  });
});

describe("enrich routes: disabled provider (M3)", () => {
  let prevJobMode: string | undefined;
  let apolloSnapshot: ProviderConfig | null;

  beforeAll(async () => {
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
    apolloSnapshot = await prisma.providerConfig.findUnique({ where: { provider: "apollo" } });
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { enabled: false },
      create: { provider: "apollo", enabled: false },
    });
  });
  afterAll(async () => {
    process.env.JOB_MODE = prevJobMode;
    await cleanup();
    if (apolloSnapshot) {
      await prisma.providerConfig.update({ where: { provider: "apollo" }, data: apolloSnapshot });
    } else {
      await prisma.providerConfig.delete({ where: { provider: "apollo" } }).catch(() => {});
    }
  });
  beforeEach(cleanup);

  it("POST /businesses/:id/enrich returns 409 with settingsHref when Apollo is disabled", async () => {
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Apollo is disabled in Settings");
    expect(body.settingsHref).toBe("/settings");
  });

  it("POST /businesses/bulk enrich returns 409 with settingsHref when Apollo is disabled", async () => {
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Apollo is disabled in Settings");
    expect(body.settingsHref).toBe("/settings");
  });
});
