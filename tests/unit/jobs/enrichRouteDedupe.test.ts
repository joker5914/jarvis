import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Fix round (B1): POST /businesses/:id/enrich used to always answer 202 once past the credit-cap
// check, trusting enqueueEnrich's `queued` boolean only for the response body, never the status.
// Now that enqueueEnrich's singletonKey is per-target (businessId:apolloId) rather than a bare
// businessId (see enqueueEnrich.test.ts), `queued === false` means pg-boss genuinely refused to
// queue a second job for the *same* target — the route must say so with a 409, not claim success.
// Everything the route touches besides enqueueEnrich (prisma, provider gates, config, credits) is
// mocked here so this exercises only the route's own dedupe branch, with no DB/provider involved.
const bizFindFirst = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { business: { findFirst: (...args: unknown[]) => bizFindFirst(...args) } } }));
vi.mock("@/lib/providers/keys", () => ({ isProviderConfigured: async () => true, isProviderEnabled: async () => true }));
vi.mock("@/lib/providers/apollo", () => ({ apolloPlanBlocked: async () => ({ blocked: false }) }));
vi.mock("@/lib/config/runtime", () => ({ loadConfig: async () => ({ enrichment: { maxPeople: 1 } }) }));
vi.mock("@/lib/enrichment/credits", () => ({
  assertCredits: async () => null,
  estimateCredits: (businesses: number, people: number) => businesses * people,
}));
const enqueueEnrich = vi.fn();
vi.mock("@/lib/jobs/enqueue", () => ({ enqueueEnrich: (...args: unknown[]) => enqueueEnrich(...args) }));

const { POST } = await import("@/app/api/businesses/[id]/enrich/route");

function jsonReq(body: unknown = {}): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /businesses/:id/enrich dedupe response (B1)", () => {
  beforeEach(() => {
    bizFindFirst.mockReset();
    enqueueEnrich.mockReset();
    bizFindFirst.mockResolvedValue({ id: "biz-1", exclusion: "none" });
  });

  it("returns 409 'An enrichment for this lead is already queued' (no settingsHref) when enqueueEnrich reports the target already queued", async () => {
    enqueueEnrich.mockResolvedValue(false);
    const res = await POST(jsonReq({ apolloId: "fake-owner" }), ctxFor("biz-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("An enrichment for this lead is already queued");
    expect(body.settingsHref).toBeUndefined();
  });

  it("still returns 202 with queued: true and estimatedCredits when enqueueEnrich succeeds", async () => {
    enqueueEnrich.mockResolvedValue(true);
    const res = await POST(jsonReq({}), ctxFor("biz-1"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ queued: true, estimatedCredits: 1 });
  });
});
