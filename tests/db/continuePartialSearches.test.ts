import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { continuePartialSearches } from "@/lib/jobs/continuePartial";
import { MANUAL_PRIORITY, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";

async function cleanup() {
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
}
beforeEach(cleanup);

describe("continuePartialSearches", () => {
  it("queues every complete search with pendingDiscovery > 0 at the right priority/origin, clears its error, and leaves everything else alone", async () => {
    const manualPending = await prisma.search.create({
      data: { zip: "77084", status: "complete", pendingDiscovery: 5, origin: "manual", error: "stale message from a prior run" },
    });
    const scannerPending = await prisma.search.create({ data: { zip: "77002", status: "complete", pendingDiscovery: 2, origin: "scanner" } });
    const completeNoPending = await prisma.search.create({ data: { zip: "77003", status: "complete", pendingDiscovery: 0 } });
    const pausedWithPending = await prisma.search.create({ data: { zip: "77004", status: "paused", pendingDiscovery: 3 } });
    const runningWithPending = await prisma.search.create({ data: { zip: "77005", status: "running", pendingDiscovery: 1 } });
    const failedWithPending = await prisma.search.create({ data: { zip: "77006", status: "failed", pendingDiscovery: 4 } });

    const enqueue = vi.fn(async () => true);
    const { queued } = await continuePartialSearches(enqueue);

    expect(new Set(queued)).toEqual(new Set([manualPending.id, scannerPending.id]));
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(manualPending.id, { priority: MANUAL_PRIORITY, origin: "manual" });
    expect(enqueue).toHaveBeenCalledWith(scannerPending.id, { priority: SCANNER_PRIORITY, origin: "scanner" });

    const updatedManual = await prisma.search.findUniqueOrThrow({ where: { id: manualPending.id } });
    expect(updatedManual.status).toBe("queued");
    expect(updatedManual.error).toBeNull();
    const updatedScanner = await prisma.search.findUniqueOrThrow({ where: { id: scannerPending.id } });
    expect(updatedScanner.status).toBe("queued");

    // Untouched: not "complete", or "complete" with nothing pending.
    expect((await prisma.search.findUniqueOrThrow({ where: { id: completeNoPending.id } })).status).toBe("complete");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: pausedWithPending.id } })).status).toBe("paused");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: runningWithPending.id } })).status).toBe("running");
    expect((await prisma.search.findUniqueOrThrow({ where: { id: failedWithPending.id } })).status).toBe("failed");
  });

  it("does nothing and returns an empty list when there are no complete-and-pending searches", async () => {
    await prisma.search.create({ data: { zip: "77084", status: "complete", pendingDiscovery: 0 } });
    const enqueue = vi.fn(async () => true);

    const { queued } = await continuePartialSearches(enqueue);

    expect(queued).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
