import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { ProviderConfig } from "@prisma/client";
import { prisma } from "@/lib/db";
import { saveOverrides } from "@/lib/config/runtime";
import { POST as enrichPost } from "@/app/api/businesses/[id]/enrich/route";
import { POST as bulkPost } from "@/app/api/businesses/bulk/route";
import { GET as creditsGet } from "@/app/api/enrichment/credits/route";
import { PEOPLE_SEARCH_PATH, __setPlanBlockedForTests, __resetPlanBlockedForTests } from "@/lib/providers/apollo";

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

describe("enrich routes: not-configured provider (real mode, no key)", () => {
  let prevJobMode: string | undefined;
  let apolloSnapshot: ProviderConfig | null;
  let prevApolloKey: string | undefined;

  beforeAll(async () => {
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
    vi.stubEnv("PROVIDER_MODE", "real");
    prevApolloKey = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    apolloSnapshot = await prisma.providerConfig.findUnique({ where: { provider: "apollo" } });
    // No stored key: clear any encryptedKey so isProviderConfigured() falls through to "not configured".
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { encryptedKey: null },
      create: { provider: "apollo" },
    });
  });
  afterAll(async () => {
    process.env.JOB_MODE = prevJobMode;
    vi.unstubAllEnvs();
    if (prevApolloKey !== undefined) process.env.APOLLO_API_KEY = prevApolloKey;
    await cleanup();
    if (apolloSnapshot) {
      await prisma.providerConfig.update({ where: { provider: "apollo" }, data: apolloSnapshot });
    } else {
      await prisma.providerConfig.delete({ where: { provider: "apollo" } }).catch(() => {});
    }
  });
  beforeEach(cleanup);

  it("POST /businesses/bulk enrich returns 409 with settingsHref when Apollo is not configured", async () => {
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Apollo API key is not configured");
    expect(body.settingsHref).toBe("/settings");
  });
});

describe("enrich routes: Apollo plan-blocked (Free plan API_INACCESSIBLE)", () => {
  let prevJobMode: string | undefined;

  beforeAll(() => {
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
  });
  afterAll(async () => {
    process.env.JOB_MODE = prevJobMode;
    await cleanup();
  });
  beforeEach(cleanup);
  afterEach(() => __resetPlanBlockedForTests());

  it("POST /businesses/:id/enrich returns 409 with settingsHref while the plan-block memo is set, without queuing", async () => {
    __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() + 60_000);
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Your Apollo plan does not include the people search and enrichment API/);
    expect(body.settingsHref).toBe("/settings");
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).toBeNull();
  });

  it("POST /businesses/bulk enrich returns 409 with settingsHref while the plan-block memo is set", async () => {
    __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() + 60_000);
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Your Apollo plan does not include the people search and enrichment API/);
    expect(body.settingsHref).toBe("/settings");
  });

  it("a memo that has already expired no longer blocks the route", async () => {
    __setPlanBlockedForTests(PEOPLE_SEARCH_PATH, Date.now() - 1000);
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(202);
  });
});

// In production JOB_MODE=queue, so only the worker process ever sees a live Apollo 403 and
// populates the in-memory memo above — the Next.js web process's copy is always empty. These
// tests exercise that real split: they never call __setPlanBlockedForTests, so the memo starts
// (and, per afterEach, stays) empty, and instead write straight to the ProviderConfig row the
// worker would have persisted, proving the routes' gate reads the database, not just memory.
describe("enrich routes: Apollo plan-blocked via persisted ProviderConfig row (web process, no memo)", () => {
  let prevJobMode: string | undefined;
  let apolloSnapshot: ProviderConfig | null;

  beforeAll(async () => {
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
    apolloSnapshot = await prisma.providerConfig.findUnique({ where: { provider: "apollo" } });
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
  // apolloPlanBlocked() primes this process's memo when it finds a blocked row, so a leftover
  // memo from one test in this block must not leak into the next (or into other describe blocks).
  afterEach(() => __resetPlanBlockedForTests());

  it("POST /businesses/:id/enrich returns 409 with settingsHref from a persisted row alone, without queuing", async () => {
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { planBlockedUntil: new Date(Date.now() + 60_000), planBlockDetail: "API_INACCESSIBLE" },
      create: { provider: "apollo", planBlockedUntil: new Date(Date.now() + 60_000), planBlockDetail: "API_INACCESSIBLE" },
    });
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Your Apollo plan does not include the people search and enrichment API/);
    expect(body.settingsHref).toBe("/settings");
    const after = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.lastEnrichedAt).toBeNull();
  });

  it("POST /businesses/bulk enrich returns 409 with settingsHref from a persisted row alone", async () => {
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { planBlockedUntil: new Date(Date.now() + 60_000), planBlockDetail: "API_INACCESSIBLE" },
      create: { provider: "apollo", planBlockedUntil: new Date(Date.now() + 60_000), planBlockDetail: "API_INACCESSIBLE" },
    });
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Your Apollo plan does not include the people search and enrichment API/);
    expect(body.settingsHref).toBe("/settings");
  });

  it("an expired persisted planBlockedUntil does not block the route", async () => {
    await prisma.providerConfig.upsert({
      where: { provider: "apollo" },
      update: { planBlockedUntil: new Date(Date.now() - 1000), planBlockDetail: "API_INACCESSIBLE" },
      create: { provider: "apollo", planBlockedUntil: new Date(Date.now() - 1000), planBlockDetail: "API_INACCESSIBLE" },
    });
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(202);
  });
});

describe("enrich routes: credit cap and estimates (Plan 7 Task 2)", () => {
  let prevJobMode: string | undefined;

  beforeAll(() => {
    prevJobMode = process.env.JOB_MODE;
    process.env.JOB_MODE = "inline";
  });
  afterAll(async () => {
    process.env.JOB_MODE = prevJobMode;
    await cleanup();
    await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
  });
  beforeEach(async () => {
    await cleanup();
    await prisma.appConfig.deleteMany({ where: { ownerId: OWNER } });
  });

  it("GET /api/enrichment/credits returns the credit status for a fresh owner", async () => {
    const res = await creditsGet({} as NextRequest, noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ used: 0, cap: 80, remaining: 80, maxPeople: 1 });
    expect(body.cycleStart).toBeTruthy();
  });

  it("POST /businesses/:id/enrich 202 body carries estimatedCredits (default and overridden)", async () => {
    const b1 = await biz("none");
    const res1 = await enrichPost(jsonReq(), ctxFor(b1.id));
    expect(res1.status).toBe(202);
    const body1 = await res1.json();
    expect(body1.estimatedCredits).toBe(1);

    const b2 = await biz("none");
    const res2 = await enrichPost(jsonReq({ people: 3 }), ctxFor(b2.id));
    expect(res2.status).toBe(202);
    const body2 = await res2.json();
    expect(body2.estimatedCredits).toBe(3);
  });

  it("POST /businesses/:id/enrich validates `people` with zod: out-of-range is a 400, absent body still queues", async () => {
    const bTooHigh = await biz("none");
    const resTooHigh = await enrichPost(jsonReq({ people: 6 }), ctxFor(bTooHigh.id));
    expect(resTooHigh.status).toBe(400);
    const bodyTooHigh = await resTooHigh.json();
    expect(bodyTooHigh.issues?.[0]?.message).toMatch(/<=\s*5/i);
    const afterTooHigh = await prisma.business.findUniqueOrThrow({ where: { id: bTooHigh.id } });
    expect(afterTooHigh.lastEnrichedAt).toBeNull();

    const bTooLow = await biz("none");
    const resTooLow = await enrichPost(jsonReq({ people: 0 }), ctxFor(bTooLow.id));
    expect(resTooLow.status).toBe(400);

    const bAbsent = await biz("none");
    const resAbsent = await enrichPost({ json: async () => { throw new Error("no body"); } } as unknown as NextRequest, ctxFor(bAbsent.id));
    expect(resAbsent.status).toBe(202);
    const bodyAbsent = await resAbsent.json();
    expect(bodyAbsent.estimatedCredits).toBe(1);
  });

  it("POST /businesses/:id/enrich returns 409 with settingsHref at the credit cap", async () => {
    await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 0 } });
    const b = await biz("none");
    const res = await enrichPost(jsonReq(), ctxFor(b.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/credit cap/i);
    expect(body.settingsHref).toBe("/settings");
  });

  it("POST /businesses/bulk enrich returns 409 at the credit cap", async () => {
    await saveOverrides(OWNER, { enrichment: { monthlyCreditCap: 0 } });
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/credit cap/i);
    expect(body.settingsHref).toBe("/settings");
  });

  it("POST /businesses/bulk enrich rejects more than 10 ids with 400", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `fake-id-${i}`);
    const res = await bulkPost(jsonReq({ ids, enrich: true }), noCtx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Enrich at most 10 leads per action");
  });

  it("POST /businesses/bulk enrich response includes estimatedCredits", async () => {
    const b = await biz("none");
    const res = await bulkPost(jsonReq({ ids: [b.id], enrich: true }), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estimatedCredits).toBe(1);
  });
});
