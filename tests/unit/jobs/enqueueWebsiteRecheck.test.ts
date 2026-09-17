import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fix round (Critical #1): enqueueWebsiteRecheck sends to the "website-recheck" queue, which is
// `policy: "exclusive"` (one job queued-or-active per singletonKey), with a fixed default
// singletonKey. scripts/cleanup-invalid-emails.ts calls it once per 25-id batch; under the
// shared default key every call after the first silently no-ops. This proves the new optional
// `opts.singletonKey` is threaded through to `boss.send` per call, and that omitting it keeps
// the original shared default the scanner tick relies on.
const send = vi.fn(async (_queue: string, _data: unknown, _opts: Record<string, unknown>) => "job-id" as string | null);
vi.mock("@/lib/jobs/boss", () => ({ getBoss: async () => ({ send }) }));

const { enqueueWebsiteRecheck } = await import("@/lib/jobs/enqueue");

describe("enqueueWebsiteRecheck singletonKey", () => {
  const prevMode = process.env.JOB_MODE;

  beforeEach(() => {
    process.env.JOB_MODE = "queue";
    send.mockClear();
  });
  afterEach(() => {
    process.env.JOB_MODE = prevMode;
  });

  it("defaults to the shared 'website-recheck' singletonKey when opts is omitted (tick.ts call shape)", async () => {
    const ok = await enqueueWebsiteRecheck(["biz-1"], "owner-1");
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [, , sendOpts] = send.mock.calls[0];
    expect(sendOpts).toMatchObject({ singletonKey: "website-recheck" });
  });

  it("passes a caller-supplied singletonKey through to boss.send, and two different keys both queue", async () => {
    const ok1 = await enqueueWebsiteRecheck(["biz-1"], "owner-1", { singletonKey: "website-recheck:cleanup:2026-09-17T00:00:00.000Z:0" });
    const ok2 = await enqueueWebsiteRecheck(["biz-2"], "owner-1", { singletonKey: "website-recheck:cleanup:2026-09-17T00:00:00.000Z:1" });

    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    const key1 = (send.mock.calls[0][2] as { singletonKey?: string })?.singletonKey;
    const key2 = (send.mock.calls[1][2] as { singletonKey?: string })?.singletonKey;
    expect(key1).toBe("website-recheck:cleanup:2026-09-17T00:00:00.000Z:0");
    expect(key2).toBe("website-recheck:cleanup:2026-09-17T00:00:00.000Z:1");
    expect(key1).not.toBe(key2);
  });

  it("returns false when boss.send returns null (queue already holds a job under that key)", async () => {
    send.mockResolvedValueOnce(null);
    const ok = await enqueueWebsiteRecheck(["biz-1"], "owner-1", { singletonKey: "website-recheck:cleanup:x:0" });
    expect(ok).toBe(false);
  });
});
