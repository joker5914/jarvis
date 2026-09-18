import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fix round (B1): the enrich queue is `policy: "stately"` (one job per created/retry/active
// state, per singletonKey — see QUEUE_OPTIONS.enrich), and enqueueEnrich used to send every job
// for a business under the same bare `businessId` singletonKey. That collapsed semantically
// different jobs into one: a queued auto-enrich would silently swallow (boss.send returns null)
// a rep's later reveal-by-id click for a specific candidate, or two different candidate reveals
// queued back to back, even though nothing about either later click was actually a duplicate.
// This proves the key is now `${businessId}:${apolloId ?? "auto"}`, so those stay distinct while
// a genuine repeat of the exact same target (same business, same apolloId or both auto) still
// dedupes as before.
const send = vi.fn(async (_queue: string, _data: unknown, _opts: Record<string, unknown>) => "job-id" as string | null);
vi.mock("@/lib/jobs/boss", () => ({ getBoss: async () => ({ send }) }));

const { enqueueEnrich } = await import("@/lib/jobs/enqueue");

describe("enqueueEnrich singletonKey", () => {
  const prevMode = process.env.JOB_MODE;

  beforeEach(() => {
    process.env.JOB_MODE = "queue";
    send.mockClear();
  });
  afterEach(() => {
    process.env.JOB_MODE = prevMode;
  });

  it("keys the auto-enrich path (no apolloId) as '<businessId>:auto'", async () => {
    await enqueueEnrich("biz-1", "owner-1");
    expect(send).toHaveBeenCalledTimes(1);
    const [, , sendOpts] = send.mock.calls[0];
    expect(sendOpts).toMatchObject({ singletonKey: "biz-1:auto" });
  });

  it("keys a candidate reveal as '<businessId>:<apolloId>', distinct from the auto-enrich key for the same business", async () => {
    await enqueueEnrich("biz-1", "owner-1", { apolloId: "fake-biz1-owner" });
    const [, , sendOpts] = send.mock.calls[0];
    expect(sendOpts).toMatchObject({ singletonKey: "biz-1:fake-biz1-owner" });
    expect((sendOpts as { singletonKey?: string }).singletonKey).not.toBe("biz-1:auto");
  });

  it("two different candidate reveals on the same business get two different keys and both queue", async () => {
    const ok1 = await enqueueEnrich("biz-1", "owner-1", { apolloId: "fake-biz1-owner" });
    const ok2 = await enqueueEnrich("biz-1", "owner-1", { apolloId: "fake-biz1-gm" });
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const key1 = (send.mock.calls[0][2] as { singletonKey?: string })?.singletonKey;
    const key2 = (send.mock.calls[1][2] as { singletonKey?: string })?.singletonKey;
    expect(key1).toBe("biz-1:fake-biz1-owner");
    expect(key2).toBe("biz-1:fake-biz1-gm");
    expect(key1).not.toBe(key2);
  });

  it("returns false when boss.send returns null (a job for this exact target is already queued)", async () => {
    send.mockResolvedValueOnce(null);
    const ok = await enqueueEnrich("biz-1", "owner-1", { apolloId: "fake-biz1-owner" });
    expect(ok).toBe(false);
  });
});
