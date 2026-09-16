import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { PROJECT_CONFIG } from "@/lib/config/projects";
import { SCANNER_CONFIG } from "@/lib/config/scanner";
import { budgetStatus } from "@/lib/providers/budget";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { enqueueTdlrSync, enqueueWebsiteRecheck, enqueueZipSearch, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";
import { isWithinWindow } from "./window";
import { pickNextWork, workKey, type Work } from "./planner";
import { logScanner, readScanner, setScannerState } from "./state";
import type { ScannerStatus } from "@prisma/client";

export type TickDeps = {
  now?: () => Date;
  enqueue?: {
    zipSearch(searchId: string, opts: { priority: number; origin: "scanner" }): Promise<boolean>;
    tdlrSync(): Promise<boolean>;
    websiteRecheck(ids: string[], ownerId: string): Promise<boolean>;
  };
};

const defaultEnqueue: NonNullable<TickDeps["enqueue"]> = {
  zipSearch: async (id, opts) => enqueueZipSearch(id, opts),
  tdlrSync: () => enqueueTdlrSync(),
  websiteRecheck: (ids, ownerId) => enqueueWebsiteRecheck(ids, ownerId),
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function describe(w: Work): string {
  switch (w.kind) {
    case "tdlr_sync": return "TDLR sync";
    case "zip_search": return `Zip search ${w.zip}`;
    case "resume_search": return `Resuming zip search ${w.zip}`;
    case "website_recheck": return `Re-checking ${w.businessIds.length} websites`;
    case "busy": return "Waiting for the running job";
    case "idle": return w.reason;
  }
}

/** One Scanner tick: decide state, enqueue at most one item, record status. Safe to call every 5 minutes. */
export async function runScannerTick(deps: TickDeps = {}): Promise<{ status: ScannerStatus; work: Work | null }> {
  const now = deps.now ? deps.now() : new Date();
  const enqueue = deps.enqueue ?? defaultEnqueue;
  const { id: ownerId } = await getActor();
  const { schedule, state, targets } = await readScanner(ownerId);
  const finish = async (status: ScannerStatus, extra: Parameters<typeof setScannerState>[1] = {}, work: Work | null = null) => {
    await setScannerState(ownerId, { status, lastTickAt: now, ...extra });
    return { status, work };
  };

  // Failure accounting: scanner-origin searches that failed since the last tick.
  const since = state.lastTickAt ?? new Date(0);
  const failed = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: "failed", updatedAt: { gt: since } }, select: { zip: true, error: true } });
  const completed = await prisma.search.count({ where: { ownerId, origin: "scanner", status: "complete", updatedAt: { gt: since } } });
  let consecutiveFailures = completed > 0 ? 0 : state.consecutiveFailures;
  const skipUntil: Record<string, string> = { ...((state.skipUntil as Record<string, string> | null) ?? {}) };
  for (const k of Object.keys(skipUntil)) if (Date.parse(skipUntil[k]) <= now.getTime()) delete skipUntil[k];
  let lastError = state.lastError;
  for (const f of failed) {
    consecutiveFailures++;
    skipUntil[`zip:${f.zip}`] = new Date(now.getTime() + SCANNER_CONFIG.failureSkipHours * HOUR).toISOString();
    lastError = f.error ?? "search failed";
    await logScanner(ownerId, `Zip search ${f.zip} failed: ${lastError}; skipping it for ${SCANNER_CONFIG.failureSkipHours} h`);
  }
  if (consecutiveFailures >= SCANNER_CONFIG.maxConsecutiveFailures) {
    await prisma.scannerState.update({ where: { ownerId }, data: { pauseRequested: true } });
    await logScanner(ownerId, `Paused after ${consecutiveFailures} consecutive failures: ${lastError}`);
    return finish("paused", { consecutiveFailures: 0, skipUntil, lastError, currentActivity: null, nextPlanned: null });
  }

  if (!schedule.enabled) return finish("disabled", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures });
  const win = isWithinWindow(schedule, now);
  if (!win.ok) return finish("outside_window", { currentActivity: null, nextPlanned: { kind: "window", at: schedule.windowStart?.toISOString() ?? null, detail: win.reason }, skipUntil, consecutiveFailures });
  if (state.pauseRequested) return finish("paused", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures });

  const budget = await budgetStatus("google");
  if (budget.exhausted) return finish("budget_exhausted", { currentActivity: `Google budget used ${budget.used}/${budget.limit}; resets at midnight`, nextPlanned: null, skipUntil, consecutiveFailures });

  // Hot zips from TDLR projects
  if (schedule.autoAddHotZips) {
    const hot = await prisma.project.findMany({
      where: { ownerId, exclusion: "none", smbFitScore: { gte: PROJECT_CONFIG.highFitThreshold }, timingWindow: { in: ["opening_soon", "under_construction"] }, zip: { not: null } },
      select: { zip: true },
      distinct: ["zip"],
    });
    for (const p of hot) {
      await prisma.scanTarget.upsert({
        where: { ownerId_zip: { ownerId, zip: p.zip! } },
        update: {},
        create: { ownerId, zip: p.zip!, priority: SCANNER_CONFIG.hotZipPriority, addedBy: "auto_tdlr" },
      });
    }
  }

  // Running work
  const running = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: { in: ["queued", "running"] } }, select: { id: true, zip: true, progress: true } });
  const tdlr = await readSync(SYNC_KEYS.tdlr);
  const tdlrRunning = isSyncRunning(tdlr.cursor, now);
  const runningScannerJobs = running.length + (tdlrRunning && state.currentJobId === "tdlr" ? 1 : 0);
  const pausedSearch = await prisma.search.findFirst({ where: { ownerId, origin: "scanner", status: "paused" }, select: { id: true, zip: true }, orderBy: { updatedAt: "asc" } });
  const staleBefore = new Date(now.getTime() - schedule.websiteRecheckDays * DAY);
  const stale = await prisma.business.findMany({
    where: { ownerId, exclusion: "none", websiteUrl: { not: null }, OR: [{ websiteCheckedAt: null }, { websiteCheckedAt: { lt: staleBefore } }] },
    select: { id: true },
    orderBy: { websiteCheckedAt: "asc" },
    take: SCANNER_CONFIG.recheckBatchSize,
  });
  const freshTargets = await prisma.scanTarget.findMany({ where: { ownerId }, select: { id: true, zip: true, priority: true, paused: true, lastSearchedAt: true } });

  const work = pickNextWork({
    now,
    schedule,
    tdlrLastSuccessfulAt: tdlr.lastSuccessfulAt,
    tdlrRunning,
    runningScannerJobs,
    pausedSearch,
    targets: freshTargets.length ? freshTargets : targets,
    staleBusinessIds: stale.map((b) => b.id),
    skipUntil,
  });

  if (work.kind === "busy") {
    const cur = running[0];
    const p = (cur?.progress as { step?: string; current?: number; total?: number } | null) ?? null;
    const activity = cur ? `Zip search ${cur.zip}${p?.step ? `: ${p.step}` : ""}${p?.total ? ` ${p.current ?? 0}/${p.total}` : ""}` : "TDLR sync running";
    return finish("running", { currentActivity: activity, currentJobId: cur?.id ?? state.currentJobId, nextPlanned: null, skipUntil, consecutiveFailures }, work);
  }
  if (work.kind === "idle") {
    return finish("idle", { currentActivity: null, currentJobId: null, nextPlanned: { kind: "next", at: work.nextDueAt?.toISOString() ?? null, detail: work.reason }, skipUntil, consecutiveFailures }, work);
  }

  let queued = false;
  let jobId: string | null = null;
  if (work.kind === "tdlr_sync") {
    queued = await enqueue.tdlrSync();
    jobId = "tdlr";
  } else if (work.kind === "resume_search") {
    await prisma.search.update({ where: { id: work.searchId }, data: { status: "queued" } });
    queued = await enqueue.zipSearch(work.searchId, { priority: SCANNER_PRIORITY, origin: "scanner" });
    jobId = work.searchId;
  } else if (work.kind === "zip_search") {
    const search = await prisma.search.create({ data: { ownerId, zip: work.zip, origin: "scanner" } });
    await prisma.scanTarget.update({ where: { id: work.targetId }, data: { lastSearchedAt: now, lastSearchId: search.id } });
    queued = await enqueue.zipSearch(search.id, { priority: SCANNER_PRIORITY, origin: "scanner" });
    jobId = search.id;
  } else if (work.kind === "website_recheck") {
    queued = await enqueue.websiteRecheck(work.businessIds, ownerId);
    jobId = "website_recheck";
  }
  const key = workKey(work);
  if (key === "website_recheck") skipUntil[key] = new Date(now.getTime() + HOUR).toISOString(); // one batch per hour at most
  await logScanner(ownerId, `${describe(work)}${queued ? "" : " (already queued)"}`);
  return finish("running", { currentActivity: describe(work), currentJobId: jobId, nextPlanned: null, skipUntil, consecutiveFailures }, work);
}
