import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchEnrichment, type WatchableDetail } from "@/components/leads/useEnrichmentWatch";

const SINCE = new Date("2026-09-17T12:00:00.000Z");

function detail(over: Partial<WatchableDetail> = {}): WatchableDetail {
  return { lastEnrichedAt: null, activity: [], ...over };
}

beforeEach(() => vi.useFakeTimers({ now: SINCE }));
afterEach(() => vi.useRealTimers());

describe("watchEnrichment", () => {
  it('resolves "done" once the newest enriched activity is newer than `since`', async () => {
    let calls = 0;
    const fetchDetail = vi.fn(async () => {
      calls++;
      if (calls === 1) return detail(); // first poll: nothing yet
      return detail({
        activity: [{ kind: "enriched", message: "Enriched via Apollo: 1 person with a verified email out of 1 found; 1 new contact, 0 updated", createdAt: new Date(SINCE.getTime() + 1000).toISOString() }],
      });
    });
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 2000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(2000); // triggers the second poll
    await expect(promise).resolves.toBe("done");
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });

  it('resolves "done" once lastEnrichedAt moves past `since`, even with no matching activity row', async () => {
    let calls = 0;
    const fetchDetail = vi.fn(async () => {
      calls++;
      if (calls === 1) return detail();
      return detail({ lastEnrichedAt: new Date(SINCE.getTime() + 500).toISOString() });
    });
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 2000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBe("done");
  });

  it('ignores an enriched activity row from before `since` (e.g. a prior run) and keeps polling', async () => {
    const fetchDetail = vi.fn(async () =>
      detail({ activity: [{ kind: "enriched", message: "old", createdAt: new Date(SINCE.getTime() - 1000).toISOString() }] }),
    );
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBe("timeout");
    expect(fetchDetail.mock.calls.length).toBeGreaterThan(1);
  });

  it('resolves "timeout" after timeoutMs when nothing ever changes', async () => {
    const fetchDetail = vi.fn(async () => detail());
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toBe("timeout");
  });

  it("polls at intervalMs — one fetch immediately, then one per interval until it resolves", async () => {
    const fetchDetail = vi.fn(async () => detail());
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 4000 });
    // Immediate first poll happens before any timer advances.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchDetail).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchDetail).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000); // reaches the 4000ms deadline
    await expect(promise).resolves.toBe("timeout");
  });

  // C1: a poll failing (transient 5xx, offline, a rejected fetchDetail) must not blow up the
  // whole watch — the caller (LeadDetail) has no catch around this promise.
  it('a fetchDetail that rejects on every call still resolves "timeout" (kept polling, at least 2 attempts)', async () => {
    const fetchDetail = vi.fn(async () => { throw new Error("network down"); });
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(promise).resolves.toBe("timeout");
    expect(fetchDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a fetchDetail that rejects once then returns a completed run resolves "done"', async () => {
    let calls = 0;
    const fetchDetail = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("transient 503");
      return detail({ lastEnrichedAt: new Date(SINCE.getTime() + 500).toISOString() });
    });
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 90_000 });
    await vi.advanceTimersByTimeAsync(1000); // the failed first poll still schedules a retry
    await expect(promise).resolves.toBe("done");
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });

  it("stops polling and resolves \"timeout\" as soon as the signal is aborted", async () => {
    const controller = new AbortController();
    const fetchDetail = vi.fn(async () => detail());
    const promise = watchEnrichment({ businessId: "b1", since: SINCE, fetchDetail, intervalMs: 1000, timeoutMs: 90_000, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeAbort = fetchDetail.mock.calls.length;
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe("timeout");
    // No further polling happened once aborted mid-sleep.
    expect(fetchDetail.mock.calls.length).toBe(callsBeforeAbort);
  });
});
