import { prisma } from "@/lib/db";
import { WEBSITE_RECHECK_JOB_PREFIX } from "@/lib/scanner/state";
import { checkPause, JobPausedError, type JobDeps } from "./shared";
import { recomputeContactQuality, scrapeOne, validateEmails } from "./zipSearch";

/**
 * Re-scrape and re-validate a batch of businesses whose website check is stale.
 *
 * Unlike `runZipSearch`/`runTdlrSync`/`runPromoteHighFit`, this function has no outer
 * `catch (JobPausedError)` of its own: it deliberately lets a pause reject the returned
 * promise (the `finally` below still clears this job's own `currentJobId` marker either way).
 * The caller decides what "paused" means for a batch with no single stateful row to mark —
 * `enqueueWebsiteRecheck`'s `JOB_MODE=inline` branch and the worker's pg-boss handler both
 * treat a `JobPausedError` here as an expected pause rather than a job failure.
 */
export async function runWebsiteRecheck(businessIds: string[], ownerId: string, deps: JobDeps): Promise<{ rechecked: number }> {
  try {
    let rechecked = 0;
    for (const id of businessIds) {
      await checkPause(deps);
      const b = await prisma.business.findFirst({ where: { id, ownerId }, select: { id: true, websiteUrl: true } });
      if (!b) continue;
      if (b.websiteUrl) {
        try {
          await scrapeOne(id, ownerId, deps);
        } catch (e) {
          // A pause mid-scrape (via the D6 `beforeFetch` hook in extractWebsiteContacts) must
          // propagate rather than be recorded as a scrape failure on the business that
          // happened to be in flight when the pause landed.
          if (e instanceof JobPausedError) throw e;
          await prisma.business.update({ where: { id }, data: { websiteReachable: false, websiteError: (e as Error).message, websiteCheckedAt: new Date() } });
        }
      } else {
        await prisma.business.update({ where: { id }, data: { websiteCheckedAt: new Date() } });
      }
      rechecked++;
    }
    try {
      await validateEmails(businessIds, deps);
    } catch (e) {
      deps.log?.(`website recheck: validateEmails failed: ${(e as Error).message}`);
    }
    for (const id of businessIds) {
      try {
        await recomputeContactQuality(id);
      } catch (e) {
        deps.log?.(`website recheck: recomputeContactQuality failed for ${id}: ${(e as Error).message}`);
      }
    }
    deps.log?.(`website recheck: ${rechecked} businesses`);
    return { rechecked };
  } finally {
    // Only clear the marker if it's still a `website_recheck:<ISO>` stamp — a plain
    // currentJobId belonging to some other job is left alone. The clear itself is conditioned
    // at the DB level on currentJobId still equalling the exact value just read: `updateMany`
    // (not `update`, since the where clause needs both ownerId and currentJobId) only performs
    // the write if nothing changed it between the read and the write, so a newer
    // website_recheck marker set by another run in that gap can never be clobbered — this run
    // can only ever clear the marker it saw, never a different one that replaced it.
    const state = await prisma.scannerState.findUnique({ where: { ownerId }, select: { currentJobId: true } });
    const marker = state?.currentJobId;
    if (marker?.startsWith(WEBSITE_RECHECK_JOB_PREFIX)) {
      await prisma.scannerState.updateMany({ where: { ownerId, currentJobId: marker }, data: { currentJobId: null } });
    }
  }
}
