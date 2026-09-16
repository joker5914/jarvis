import { prisma } from "@/lib/db";
import { Prisma, type ScannerStatus } from "@prisma/client";
import { upsertIgnoringConflict } from "@/lib/jobs/shared";

/**
 * Two (or more) callers can hit `readScanner` for the same brand-new owner at once (e.g. two
 * dashboard tabs polling right after the first scanner page load, before either row exists).
 * `upsert()` is not immune to that race: a concurrent create attempt can still lose to another
 * transaction's insert and surface as P2002 rather than silently updating. Wrapping each create
 * in `upsertIgnoringConflict` (shared with the jobs layer's own first-write races) discards the
 * losing call instead of throwing, then a plain re-read below is guaranteed to find the row
 * either caller (or a third one) created.
 */
export async function readScanner(ownerId: string) {
  await Promise.all([
    upsertIgnoringConflict(() => prisma.scanSchedule.upsert({ where: { ownerId }, update: {}, create: { ownerId } })),
    // A brand-new state row baselines lastTickAt at "now" rather than leaving it null (which
    // the tick would otherwise treat as "since the epoch" for failure accounting), so the
    // very first tick doesn't scoop up every scanner-origin search ever created.
    upsertIgnoringConflict(() =>
      prisma.scannerState.upsert({ where: { ownerId }, update: {}, create: { ownerId, lastTickAt: new Date() } }),
    ),
  ]);
  const [schedule, state, targets] = await Promise.all([
    prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId } }),
    prisma.scannerState.findUniqueOrThrow({ where: { ownerId } }),
    prisma.scanTarget.findMany({ where: { ownerId }, orderBy: [{ priority: "desc" }, { zip: "asc" }] }),
  ]);
  return { schedule, state, targets };
}

export type NextPlanned = { kind: string; at: string | null; detail?: string };

/**
 * Prefix `ScannerState.currentJobId` carries while a `website_recheck` job is in flight,
 * followed by the ISO instant the tick enqueued it — e.g. `website_recheck:2026-09-16T15:00:00.000Z`.
 * Shared between `tick.ts` (which stamps it) and `websiteRecheck.ts` (which clears it, and only
 * if it's still this job's own marker) so the two never drift apart.
 */
export const WEBSITE_RECHECK_JOB_PREFIX = "website_recheck:";

export async function setScannerState(
  ownerId: string,
  data: {
    status?: ScannerStatus;
    currentJobId?: string | null;
    currentActivity?: string | null;
    nextPlanned?: NextPlanned | null;
    lastError?: string | null;
    lastTickAt?: Date;
    backoffUntil?: Date | null;
    consecutiveFailures?: number;
    skipUntil?: Record<string, string>;
  },
) {
  const { nextPlanned, skipUntil, ...rest } = data;
  await prisma.scannerState.update({
    where: { ownerId },
    data: {
      ...rest,
      ...(nextPlanned !== undefined && { nextPlanned: (nextPlanned ?? Prisma.JsonNull) as Prisma.InputJsonValue }),
      ...(skipUntil !== undefined && { skipUntil: skipUntil as Prisma.InputJsonValue }),
    },
  });
}

export async function logScanner(ownerId: string, message: string) {
  await prisma.activityLog.create({ data: { ownerId, kind: "scanner", message } });
}
