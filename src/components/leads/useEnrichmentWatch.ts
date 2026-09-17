/**
 * Polls the lead detail endpoint after an enrich request is queued, so the drawer can show a
 * live "still working" vs "done" status instead of a one-shot "Enrichment queued" toast that
 * leaves the user to refresh manually to learn the outcome (Plan 8 Task 7).
 *
 * `watchEnrichment` is pure (no React, no `fetch` of its own) so it's trivially testable with
 * fake timers and an injected `fetchDetail` — the caller (LeadDetail) supplies the real fetch and
 * an AbortSignal so the poll loop stops cleanly on unmount/close.
 */

export type WatchableActivity = { kind: string; message: string; createdAt: string };

/** The shape watchEnrichment needs from a lead detail response — a subset of what
 * `GET /api/businesses/:id` returns today (its `activity` is most-recent-first). */
export type WatchableDetail = {
  lastEnrichedAt: string | null;
  activity: WatchableActivity[];
};

export type WatchEnrichmentResult = "done" | "timeout";

export type WatchEnrichmentOptions = {
  businessId: string;
  /** Only activity/lastEnrichedAt changes strictly after this instant count as "the run finished". */
  since: Date;
  /** Fetches (and parses) the current lead detail. Injected so tests can fake it and the caller
   * can supply the real `fetch('/api/businesses/'+id)` round-trip. */
  fetchDetail: () => Promise<WatchableDetail>;
  /** Milliseconds between polls. */
  intervalMs: number;
  /** Give up (resolve "timeout") after this many milliseconds total. */
  timeoutMs: number;
  /** Aborting stops the poll loop immediately; the promise resolves "timeout" rather than hanging. */
  signal?: AbortSignal;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    // `onAbort` closes over `timer` before `timer` is assigned — fine, since onAbort only ever
    // runs later (async, from the "abort" event), by which point the assignment below has run.
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** True once the detail reflects a completed run that started after `since`: either the newest
 * `enriched`-kind activity row is newer than `since`, or `lastEnrichedAt` itself moved past it. */
function reflectsCompletedRun(detail: WatchableDetail, since: Date): boolean {
  const sinceMs = since.getTime();
  const newestEnriched = detail.activity.find((a) => a.kind === "enriched");
  if (newestEnriched && new Date(newestEnriched.createdAt).getTime() > sinceMs) return true;
  if (detail.lastEnrichedAt && new Date(detail.lastEnrichedAt).getTime() > sinceMs) return true;
  return false;
}

export async function watchEnrichment(opts: WatchEnrichmentOptions): Promise<WatchEnrichmentResult> {
  const { since, fetchDetail, intervalMs, timeoutMs, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) return "timeout";
    // A single poll failing (transient 5xx, offline, a bad response the caller's fetchDetail
    // turned into a rejection) must not tear down the whole watch — the caller has no `catch`
    // around this promise, so an unguarded rejection here would escape all the way out of
    // LeadDetail's enrich() and skip its finally block. Treat a failed poll like "not done yet"
    // and keep trying until timeoutMs.
    try {
      const detail = await fetchDetail();
      if (reflectsCompletedRun(detail, since)) return "done";
    } catch {
      // fall through to the sleep/retry below
    }
    if (signal?.aborted) return "timeout";
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "timeout";
    await sleep(Math.min(intervalMs, remaining), signal);
  }
}
