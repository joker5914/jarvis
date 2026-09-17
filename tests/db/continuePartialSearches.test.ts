import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { continuePartialSearches } from "@/lib/jobs/continuePartial";
import { MANUAL_PRIORITY } from "@/lib/jobs/enqueue";

async function cleanup() {
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
}
beforeEach(cleanup);

describe("continuePartialSearches", () => {
  it("queues every complete search with discoveryComplete false, clears its error, and leaves everything else alone", async () => {
    const manualPending = await prisma.search.create({
      data: { zip: "77084", status: "complete", discoveryComplete: false, pendingDiscovery: 5, origin: "manual", error: "stale message from a prior run" },
    });
    const scannerPending = await prisma.search.create({
      data: { zip: "77002", status: "complete", discoveryComplete: false, pendingDiscovery: 2, origin: "scanner" },
    });
    // pendingDiscovery alone must never gate this — only discoveryComplete does.
    const completeButDiscoveryDone = await prisma.search.create({
      data: { zip: "77003", status: "complete", discoveryComplete: true, pendingDiscovery: 0 },
    });
    const pausedWithIncompleteDiscovery = await prisma.search.create({ data: { zip: "77004", status: "paused", discoveryComplete: false } });
    const runningWithIncompleteDiscovery = await prisma.search.create({ data: { zip: "77005", status: "running", discoveryComplete: false } });
    const failedWithIncompleteDiscovery = await prisma.search.create({ data: { zip: "77006", status: "failed", discoveryComplete: false } });

    const enqueue = vi.fn(async () => true);
    const { queued } = await continuePartialSearches(enqueue);

    expect(new Set(queued)).toEqual(new Set([manualPending.id, scannerPending.id]));
    expect(enqueue).toHaveBeenCalledTimes(2);
    // Always manual origin/priority, regardless of the search's own Search.origin — see
    // continuePartial.ts's doc comment (00:15 is outside every scan window, so a scanner-origin
    // enqueue would just have the Scanner's own pause/window check re-pause it immediately).
    expect(enqueue).toHaveBeenCalledWith(manualPending.id, { priority: MANUAL_PRIORITY, origin: "manual" });
    expect(enqueue).toHaveBeenCalledWith(scannerPending.id, { priority: MANUAL_PRIORITY, origin: "manual" });

    const updatedManual = await prisma.search.findUniqueOrThrow({ where: { id: manualPending.id } });
    expect(updatedManual.status).toBe("queued");
    expect(updatedManual.error).toBeNull();
    // Search.origin itself is left untouched — only the enqueue call is forced to manual.
    expect(updatedManual.origin).toBe("manual");
    const updatedScanner = await prisma.search.findUniqueOrThrow({ where: { id: scannerPending.id } });
    expect(updatedScanner.status).toBe("queued");
    expect(updatedScanner.origin).toBe("scanner");

    // Untouched: not "complete", or "complete" with discovery already done.
    expect((await prisma.search.findUniqueOrThrow({ where: { id: completeButDiscoveryDone.id } })).status).toBe("complete");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: pausedWithIncompleteDiscovery.id } })).status).toBe("paused");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: runningWithIncompleteDiscovery.id } })).status).toBe("running");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: failedWithIncompleteDiscovery.id } })).status).toBe("failed");
  });

  it("does nothing and returns an empty list when there are no complete-and-incomplete-discovery searches", async () => {
    await prisma.search.create({ data: { zip: "77084", status: "complete", discoveryComplete: true } });
    const enqueue = vi.fn(async () => true);

    const { queued } = await continuePartialSearches(enqueue);

    expect(queued).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips a search already queued or running elsewhere (never matched by the status filter in the first place)", async () => {
    // A search that's already queued/running for some other reason (e.g. a manual "Find more"
    // click beat the nightly sweep to it) is never even a candidate — the WHERE clause only
    // looks at status "complete".
    const alreadyQueued = await prisma.search.create({ data: { zip: "77007", status: "queued", discoveryComplete: false } });
    const alreadyRunning = await prisma.search.create({ data: { zip: "77008", status: "running", discoveryComplete: false } });
    const enqueue = vi.fn(async () => true);

    const { queued } = await continuePartialSearches(enqueue);

    expect(queued).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
    expect((await prisma.search.findUniqueOrThrow({ where: { id: alreadyQueued.id } })).status).toBe("queued");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: alreadyRunning.id } })).status).toBe("running");
  });

  it("tolerates a declined (false) or throwing enqueue without marking that row queued, and keeps sweeping the rest", async () => {
    const ok = await prisma.search.create({ data: { zip: "77009", status: "complete", discoveryComplete: false } });
    const declined = await prisma.search.create({ data: { zip: "77010", status: "complete", discoveryComplete: false } });
    const throwing = await prisma.search.create({ data: { zip: "77011", status: "complete", discoveryComplete: false } });

    const enqueue = vi.fn(async (searchId: string) => {
      if (searchId === declined.id) return false;
      if (searchId === throwing.id) throw new Error("pg-boss unavailable");
      return true;
    });

    const { queued } = await continuePartialSearches(enqueue);

    expect(queued).toEqual([ok.id]);
    expect(enqueue).toHaveBeenCalledTimes(3); // the sweep visits every candidate regardless of earlier failures

    expect((await prisma.search.findUniqueOrThrow({ where: { id: ok.id } })).status).toBe("queued");
    // Left exactly as found: enqueue returning false or throwing must never flip status to
    // "queued" — that would leave the row stuck showing "queued" with nothing running it.
    expect((await prisma.search.findUniqueOrThrow({ where: { id: declined.id } })).status).toBe("complete");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: throwing.id } })).status).toBe("complete");
  });
});
