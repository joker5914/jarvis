import { prisma } from "@/lib/db";
import { enqueueZipSearch, MANUAL_PRIORITY, SCANNER_PRIORITY } from "./enqueue";

/**
 * Nightly auto-continue for zip searches that completed on a Google-budget interruption
 * (Search.status "complete" with Search.pendingDiscovery > 0 — see src/lib/jobs/zipSearch.ts).
 * The Google daily budget resets at midnight, so re-queueing these shortly after midnight lets
 * each one pick up right where it left off (discover() resumes from the persisted
 * discoveredIds/categoriesDone) with no user action needed. `enqueue` is injectable so tests can
 * assert queuing behavior without a live pg-boss connection.
 */
export async function continuePartialSearches(enqueue: typeof enqueueZipSearch = enqueueZipSearch): Promise<{ queued: string[] }> {
  const candidates = await prisma.search.findMany({
    where: { status: "complete", pendingDiscovery: { gt: 0 } },
    select: { id: true, origin: true },
  });

  const queued: string[] = [];
  for (const search of candidates) {
    await prisma.search.update({ where: { id: search.id }, data: { status: "queued", error: null } });
    const origin = search.origin === "scanner" ? "scanner" : "manual";
    await enqueue(search.id, { priority: origin === "scanner" ? SCANNER_PRIORITY : MANUAL_PRIORITY, origin });
    queued.push(search.id);
  }
  return { queued };
}
