import { prisma } from "@/lib/db";
import { getActor } from "@/lib/actor";
import { loadConfig } from "@/lib/config/runtime";
import { SCANNER_CONFIG } from "@/lib/config/scanner";
import { budgetStatus } from "@/lib/providers/budget";
import { isSyncRunning, readSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";
import { enqueueTdlrSync, enqueueWebsiteRecheck, enqueueZipSearch, SCANNER_PRIORITY } from "@/lib/jobs/enqueue";
import { QUEUE_OPTIONS, QUEUES } from "@/lib/jobs/queues";
import { isWithinWindow, nextWindowStart } from "./window";
import { pickNextWork, workKey, type Work } from "./planner";
import { logScanner, readScanner, setScannerState, WEBSITE_RECHECK_JOB_PREFIX } from "./state";
import type { ScannerStatus } from "@prisma/client";

export type TickDeps = {
  now?: () => Date;
  enqueue?: {
    zipSearch(searchId: string, opts: { priority: number; origin: "scanner" }): Promise<boolean>;
    tdlrSync(opts: { origin: "scanner" }): Promise<boolean>;
    websiteRecheck(ids: string[], ownerId: string): Promise<boolean>;
  };
};

const defaultEnqueue: NonNullable<TickDeps["enqueue"]> = {
  zipSearch: async (id, opts) => enqueueZipSearch(id, opts),
  tdlrSync: (opts) => enqueueTdlrSync(opts),
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

  // Clean up expired per-item skips regardless of whether the Scanner is enabled, so a
  // disabled schedule doesn't leave stale entries sitting in the persisted state forever.
  const since = state.lastTickAt ?? new Date(0);
  const skipUntil: Record<string, string> = { ...((state.skipUntil as Record<string, string> | null) ?? {}) };
  for (const k of Object.keys(skipUntil)) if (Date.parse(skipUntil[k]) <= now.getTime()) delete skipUntil[k];

  // The disabled gate comes before failure accounting/auto-pause: a schedule the user has
  // turned off shouldn't have its failure counter or pauseRequested touched by searches
  // that happened to fail while it was off (e.g. a stray manual-origin retry).
  if (!schedule.enabled) return finish("disabled", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures: state.consecutiveFailures });

  // Failure accounting: scanner-origin searches that failed since the last tick. A zip whose
  // `zip:<zip>` key is already in `skipUntil` was already counted toward `consecutiveFailures`
  // (the skip entry doubles as that "already counted" marker for its 6 h window), so a search
  // that keeps getting observed as `failed` across ticks — e.g. retried and failing again —
  // only nudges the counter once rather than once per observation.
  const failed = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: "failed", updatedAt: { gt: since } }, select: { zip: true, error: true } });
  const completed = await prisma.search.count({ where: { ownerId, origin: "scanner", status: "complete", updatedAt: { gt: since } } });
  let consecutiveFailures = completed > 0 ? 0 : state.consecutiveFailures;
  let lastError = state.lastError;
  const alreadyCounted = new Set(Object.keys(skipUntil));
  for (const f of failed) {
    const key = `zip:${f.zip}`;
    if (!alreadyCounted.has(key)) consecutiveFailures++;
    skipUntil[key] = new Date(now.getTime() + SCANNER_CONFIG.failureSkipHours * HOUR).toISOString();
    lastError = f.error ?? "search failed";
    await logScanner(ownerId, `Zip search ${f.zip} failed: ${lastError}; skipping it for ${SCANNER_CONFIG.failureSkipHours} h`);
  }
  if (consecutiveFailures >= SCANNER_CONFIG.maxConsecutiveFailures) {
    await prisma.scannerState.update({ where: { ownerId }, data: { pauseRequested: true } });
    await logScanner(ownerId, `Paused after ${consecutiveFailures} consecutive failures: ${lastError}`);
    return finish("paused", { consecutiveFailures: 0, skipUntil, lastError, currentActivity: null, nextPlanned: null });
  }

  const win = isWithinWindow(schedule, now);
  if (!win.ok) {
    // before_start: windowStart is itself the next future time. after_end: the window is
    // permanently over, so there's no next time. day_off/outside_daily: windowStart (if any)
    // is in the past by now, so compute the next real occurrence of the daily/weekly window
    // instead of surfacing a stale past timestamp to the UI.
    const at =
      win.reason === "before_start" ? (schedule.windowStart?.toISOString() ?? null) : win.reason === "after_end" ? null : nextWindowStart(schedule, now).toISOString();
    return finish("outside_window", { currentActivity: null, nextPlanned: { kind: "window", at, detail: win.reason }, skipUntil, consecutiveFailures });
  }
  if (state.pauseRequested) return finish("paused", { currentActivity: null, nextPlanned: null, skipUntil, consecutiveFailures });

  // Busy check (spec 5.6 step 3) runs before the budget check (step 4): a job that's still
  // running shouldn't have this tick flip status to budget_exhausted just because the budget
  // also happens to be used up — the running job is the more relevant thing to report, and
  // this tick isn't going to enqueue anything regardless of budget.
  const running = await prisma.search.findMany({ where: { ownerId, origin: "scanner", status: { in: ["queued", "running"] } }, select: { id: true, zip: true, progress: true } });
  const tdlr = await readSync(SYNC_KEYS.tdlr);
  const tdlrRunning = isSyncRunning(tdlr.cursor, now);
  // A `website_recheck:<ISO>` marker on currentJobId counts toward concurrency the same as a
  // running Search row while it's still fresh — "fresh" meaning within the website-recheck
  // queue's own expireInSeconds, since pg-boss would have expired (and the job would have
  // cleared) the underlying job by then regardless of whether anything actually cleared the
  // marker. A stale marker (left behind by a crashed worker, say) is ignored rather than
  // wedging the scanner "busy" forever.
  const websiteRecheckMarker = state.currentJobId?.startsWith(WEBSITE_RECHECK_JOB_PREFIX) ? state.currentJobId : null;
  const websiteRecheckMarkerAt = websiteRecheckMarker ? Date.parse(websiteRecheckMarker.slice(WEBSITE_RECHECK_JOB_PREFIX.length)) : NaN;
  const websiteRecheckRunning = !Number.isNaN(websiteRecheckMarkerAt) && now.getTime() - websiteRecheckMarkerAt < QUEUE_OPTIONS[QUEUES.websiteRecheck].expireInSeconds * 1000;
  // A running TDLR sync counts against the scanner's concurrency regardless of who started
  // it (conservative and correct) — don't gate this on currentJobId, which only reflects
  // what this tick's own bookkeeping last wrote.
  const runningScannerJobs = running.length + (tdlrRunning ? 1 : 0) + (websiteRecheckRunning ? 1 : 0);
  if (runningScannerJobs >= schedule.maxConcurrentJobs) {
    const cur = running[0];
    const p = (cur?.progress as { step?: string; current?: number; total?: number } | null) ?? null;
    const activity = cur
      ? `Zip search ${cur.zip}${p?.step ? `: ${p.step}` : ""}${p?.total ? ` ${p.current ?? 0}/${p.total}` : ""}`
      : tdlrRunning
        ? "TDLR sync running"
        : websiteRecheckRunning
          ? "Re-checking websites"
          : "Running";
    return finish("running", { currentActivity: activity, currentJobId: cur?.id ?? state.currentJobId, nextPlanned: null, skipUntil, consecutiveFailures }, { kind: "busy" });
  }

  const budget = await budgetStatus("google");
  if (budget.exhausted) return finish("budget_exhausted", { currentActivity: `Google budget used ${budget.used}/${budget.limit}; resets at midnight`, nextPlanned: null, skipUntil, consecutiveFailures });

  // Hot zips from TDLR projects
  if (schedule.autoAddHotZips) {
    const cfg = await loadConfig(ownerId);
    const hot = await prisma.project.findMany({
      where: { ownerId, exclusion: "none", smbFitScore: { gte: cfg.projects.highFitThreshold }, timingWindow: { in: ["opening_soon", "under_construction"] }, zip: { not: null } },
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

  // pickNextWork's own busy check can never trigger here — runningScannerJobs is already
  // below schedule.maxConcurrentJobs, or this tick would have returned above.
  if (work.kind === "idle") {
    return finish("idle", { currentActivity: null, currentJobId: null, nextPlanned: { kind: "next", at: work.nextDueAt?.toISOString() ?? null, detail: work.reason }, skipUntil, consecutiveFailures }, work);
  }

  let queued = false;
  let jobId: string | null = null;
  if (work.kind === "tdlr_sync") {
    queued = await enqueue.tdlrSync({ origin: "scanner" });
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
    // Timestamped so a later tick can tell a fresh marker (still counts toward
    // maxConcurrentJobs) from a stale one (ignored) — see websiteRecheckRunning above.
    jobId = `${WEBSITE_RECHECK_JOB_PREFIX}${now.toISOString()}`;
    // Persisted BEFORE enqueueing, not after: in JOB_MODE=inline, enqueue.websiteRecheck starts
    // runWebsiteRecheck fire-and-forget and returns immediately, so the job can run to
    // completion — including its own `finally` reading and clearing currentJobId — before this
    // function would otherwise get around to writing the marker via `finish()` below. Writing
    // it here first means the job's `finally` always finds its own marker already in place, so
    // it always finds something to clear rather than racing to clear a marker that isn't there
    // yet. This is also the *only* write of currentJobId for this branch — see below.
    await setScannerState(ownerId, { currentJobId: jobId });
    try {
      queued = await enqueue.websiteRecheck(work.businessIds, ownerId);
    } catch (e) {
      // enqueue.websiteRecheck can itself throw (e.g. boss.send rejects) after the marker
      // above was already persisted — without this, the marker would be stuck until it
      // expires (up to QUEUE_OPTIONS[websiteRecheck].expireInSeconds, i.e. up to an hour),
      // reporting the scanner "busy" the whole time even though no job is actually running.
      // Clear it (conditioned on it still being the exact marker just written, same
      // optimistic-concurrency guard as the job's own `finally` in websiteRecheck.ts) before
      // rethrowing — this mirrors runScannerTick's existing behavior for every other enqueue
      // call (e.g. a rejecting enqueue.zipSearch), none of which are caught here either: the
      // tick's promise rejects and propagates to its caller rather than being swallowed.
      await prisma.scannerState.updateMany({ where: { ownerId, currentJobId: jobId }, data: { currentJobId: null } });
      throw e;
    }
  }
  const key = workKey(work);
  if (key === "website_recheck") skipUntil[key] = new Date(now.getTime() + HOUR).toISOString(); // one batch per hour at most
  await logScanner(ownerId, `${describe(work)}${queued ? "" : " (already queued)"}`);
  // website_recheck's marker was already persisted above, before enqueueing; omitting
  // currentJobId from this patch (rather than redundantly re-writing the identical value)
  // means this write can never race a fast inline job's own `finally` and clobber it back in
  // after the job has already cleared it — setScannerState leaves a field untouched whenever
  // the caller's patch doesn't include that key at all.
  const extra: Parameters<typeof setScannerState>[1] =
    work.kind === "website_recheck"
      ? { currentActivity: describe(work), nextPlanned: null, skipUntil, consecutiveFailures }
      : { currentActivity: describe(work), currentJobId: jobId, nextPlanned: null, skipUntil, consecutiveFailures };
  return finish("running", extra, work);
}
