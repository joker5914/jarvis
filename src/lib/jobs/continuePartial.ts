import { prisma } from "@/lib/db";
import { enqueueZipSearch, MANUAL_PRIORITY } from "./enqueue";

/**
 * Nightly auto-continue for zip searches that completed on a Google-budget interruption
 * (Search.status "complete" with Search.discoveryComplete false — see src/lib/jobs/zipSearch.ts;
 * Search.pendingDiscovery is display-only and must not be used as this gate, since it can
 * legitimately be 0 while categories are still unsearched). The Google daily budget resets at
 * midnight, so re-queueing these shortly after midnight lets each one pick up right where it
 * left off (discover() resumes from the persisted discoveredIds/categoriesDone) with no user
 * action needed. `enqueue` is injectable so tests can assert queuing behavior without a live
 * pg-boss connection.
 */
export async function continuePartialSearches(enqueue: typeof enqueueZipSearch = enqueueZipSearch): Promise<{ queued: string[] }> {
  const candidates = await prisma.search.findMany({
    where: { status: "complete", discoveryComplete: false },
    select: { id: true },
  });

  const queued: string[] = [];
  for (const search of candidates) {
    try {
      // Always manual origin/priority here, regardless of Search.origin (left untouched on the
      // row — it still reflects how the search was originally started, e.g. for the Scanner's
      // "auto" badge). This job runs at 00:15, outside every scan window by construction, so
      // enqueueing a scanner-origin search as "scanner" would have scannerPauseCheck's window
      // check re-pause it as "Paused by user" within seconds, before it could do any work.
      const ok = await enqueue(search.id, { priority: MANUAL_PRIORITY, origin: "manual" });
      if (!ok) {
        // enqueueZipSearch returns false when a job is already queued/active under this
        // search's singletonKey (e.g. a manual "Find more" click beat the nightly sweep to it) —
        // leave the row exactly as that other job will finish it, and move on to the rest of
        // the sweep rather than stopping on one declined search.
        console.warn(`[continue-partial] search ${search.id} already queued/active, skipping`);
        continue;
      }
      // Only mark the row "queued" once the job is actually accepted — flipping status first and
      // then having enqueue fail or decline would leave the search stuck showing "queued" with
      // nothing ever going to run it.
      // Guarded on the status we selected: if the job started (or, in JOB_MODE=inline, already
      // finished) before this write, the job's own status wins and we must not stamp "queued"
      // over it.
      await prisma.search.updateMany({ where: { id: search.id, status: "complete" }, data: { status: "queued", error: null } });
      queued.push(search.id);
    } catch (e) {
      console.error(`[continue-partial] failed to queue search ${search.id}`, e);
    }
  }
  return { queued };
}
