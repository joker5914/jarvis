export type PlannerTarget = { id: string; zip: string; priority: number; paused: boolean; lastSearchedAt: Date | null };

export type PlannerInput = {
  now: Date;
  schedule: { tdlrSyncHours: number; zipRefreshDays: number; websiteRecheckDays: number; maxConcurrentJobs: number };
  tdlrLastSuccessfulAt: Date | null;
  tdlrRunning: boolean;
  runningScannerJobs: number;
  pausedSearch: { id: string; zip: string } | null;
  targets: PlannerTarget[];
  staleBusinessIds: string[];
  skipUntil: Record<string, string>;
};

export type Work =
  | { kind: "busy" }
  | { kind: "tdlr_sync" }
  | { kind: "resume_search"; searchId: string; zip: string }
  | { kind: "zip_search"; targetId: string; zip: string }
  | { kind: "website_recheck"; businessIds: string[] }
  | { kind: "idle"; nextDueAt: Date | null; reason: string };

const HOUR = 3_600_000;
const DAY = 86_400_000;

export function workKey(w: Work): string | null {
  switch (w.kind) {
    case "tdlr_sync":
      return "tdlr";
    case "zip_search":
    case "resume_search":
      return `zip:${w.zip}`;
    case "website_recheck":
      return "website_recheck";
    default:
      return null;
  }
}

function skipped(i: PlannerInput, key: string): boolean {
  const until = i.skipUntil[key];
  return !!until && Date.parse(until) > i.now.getTime();
}

export function pickNextWork(i: PlannerInput): Work {
  if (i.runningScannerJobs >= i.schedule.maxConcurrentJobs) return { kind: "busy" };
  const t = i.now.getTime();
  const candidates: Date[] = [];

  // 1. TDLR sync
  const tdlrDueAt = i.tdlrLastSuccessfulAt ? new Date(i.tdlrLastSuccessfulAt.getTime() + i.schedule.tdlrSyncHours * HOUR) : i.now;
  if (!i.tdlrRunning && !skipped(i, "tdlr")) {
    if (tdlrDueAt.getTime() <= t) return { kind: "tdlr_sync" };
    candidates.push(tdlrDueAt);
  }

  // 2. Resume a paused scanner search
  if (i.pausedSearch && !skipped(i, `zip:${i.pausedSearch.zip}`)) {
    return { kind: "resume_search", searchId: i.pausedSearch.id, zip: i.pausedSearch.zip };
  }

  // 3. Highest-priority due target; ties → oldest (null first)
  const ordered = [...i.targets]
    .filter((x) => !x.paused && !skipped(i, `zip:${x.zip}`))
    .sort((a, b) => b.priority - a.priority || (a.lastSearchedAt?.getTime() ?? 0) - (b.lastSearchedAt?.getTime() ?? 0));
  for (const target of ordered) {
    const dueAt = target.lastSearchedAt ? new Date(target.lastSearchedAt.getTime() + i.schedule.zipRefreshDays * DAY) : i.now;
    if (dueAt.getTime() <= t) return { kind: "zip_search", targetId: target.id, zip: target.zip };
    candidates.push(dueAt);
  }

  // 4. Website re-checks
  if (i.staleBusinessIds.length > 0 && !skipped(i, "website_recheck")) {
    return { kind: "website_recheck", businessIds: i.staleBusinessIds };
  }

  const nextDueAt = candidates.length ? new Date(Math.min(...candidates.map((c) => c.getTime()))) : null;
  return { kind: "idle", nextDueAt, reason: nextDueAt ? "waiting for the next due item" : "nothing scheduled" };
}
