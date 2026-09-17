import { getBoss } from "./boss";
import {
  QUEUES,
  QUEUE_OPTIONS,
  type EnrichJobData,
  type JobOrigin,
  type PromoteBatchJobData,
  type PromoteJobData,
  type ScannerTickJobData,
  type TdlrSyncJobData,
  type WebsiteRecheckJobData,
  type ZipSearchJobData,
} from "./queues";
import { runZipSearch } from "./zipSearch";
import { runTdlrSync } from "./tdlrSync";
import { runPromoteBusiness, runPromoteHighFit } from "./promote";
import { runWebsiteRecheck } from "./websiteRecheck";
import { JobPausedError, scannerPauseCheck } from "./shared";
import { getProviders } from "@/lib/providers";
import { getActor } from "@/lib/actor";

export const MANUAL_PRIORITY = 10;
export const SCANNER_PRIORITY = 1;

/**
 * JOB_MODE=queue (default): hand the job to the pg-boss worker.
 * JOB_MODE=inline: run it inside this process (e2e tests and single-process demos).
 */
export async function enqueueZipSearch(searchId: string, opts: { priority?: number; origin?: JobOrigin } = {}): Promise<boolean> {
  const origin = opts.origin ?? "manual";
  if (process.env.JOB_MODE === "inline") {
    const shouldPause = origin === "scanner" ? scannerPauseCheck((await getActor()).id) : undefined;
    void runZipSearch(searchId, { providers: getProviders(), log: console.log, shouldPause }).catch((e) =>
      console.error("[inline zip-search]", e),
    );
    return true;
  }
  const boss = await getBoss();
  const data: ZipSearchJobData = { searchId, origin };
  const id = await boss.send(QUEUES.zipSearch, data, {
    retryLimit: 3,
    retryDelay: 60,
    priority: opts.priority ?? MANUAL_PRIORITY,
    singletonKey: searchId,
  });
  return id !== null;
}

/** Returns false when a tdlr-sync job is already queued under the "tdlr" singleton key (boss.send returns null). */
export async function enqueueTdlrSync(opts: { origin?: JobOrigin } = {}): Promise<boolean> {
  const origin = opts.origin ?? "manual";
  if (process.env.JOB_MODE === "inline") {
    const shouldPause = origin === "scanner" ? scannerPauseCheck((await getActor()).id) : undefined;
    void runTdlrSync({ providers: getProviders(), log: console.log, shouldPause }).catch((e) => console.error("[inline tdlr-sync]", e));
    return true;
  }
  const boss = await getBoss();
  const data: TdlrSyncJobData = { origin };
  const id = await boss.send(QUEUES.tdlrSync, data, { retryLimit: 3, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: "tdlr" });
  return id !== null;
}

export async function enqueuePromote(businessId: string, ownerId: string): Promise<void> {
  if (process.env.JOB_MODE === "inline") {
    void runPromoteBusiness(businessId, ownerId, { providers: getProviders(), log: console.log }).catch((e) =>
      console.error("[inline promote]", e),
    );
    return;
  }
  const boss = await getBoss();
  const data: PromoteJobData = { businessId, ownerId };
  await boss.send(QUEUES.promote, data, { retryLimit: 3, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: `promote:${businessId}` });
}

/** Returns false when a promote-batch job is already queued under the "promote-batch" singleton key (boss.send returns null). */
export async function enqueuePromoteBatch(): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    void runPromoteHighFit({ providers: getProviders(), log: console.log }).catch((e) => console.error("[inline promote-batch]", e));
    return true;
  }
  const boss = await getBoss();
  const data: PromoteBatchJobData = {};
  const id = await boss.send(QUEUES.promoteBatch, data, { retryLimit: 1, retryDelay: 60, priority: MANUAL_PRIORITY, singletonKey: "promote-batch" });
  return id !== null;
}

/**
 * Unlike the other inline branches (which fire-and-forget with `void run…().catch(...)`),
 * this one awaits `runEnrich` so a `JOB_MODE=inline` caller's 202 response comes back only
 * after enrichment has actually finished (the Task 5 e2e relies on this).
 */
export async function enqueueEnrich(businessId: string, ownerId: string, opts: { force?: boolean; people?: number } = {}): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    const { runEnrich } = await import("./enrich");
    await runEnrich(businessId, ownerId, { providers: getProviders(), log: console.log }, { force: opts.force, people: opts.people });
    return true;
  }
  const boss = await getBoss();
  const data: EnrichJobData = { businessId, ownerId, force: opts.force, people: opts.people };
  const id = await boss.send(QUEUES.enrich, data, {
    singletonKey: businessId,
    priority: MANUAL_PRIORITY,
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: QUEUE_OPTIONS.enrich.expireInSeconds,
  });
  return id !== null;
}

const DEFAULT_WEBSITE_RECHECK_SINGLETON_KEY = "website-recheck";

/**
 * `singletonKey` defaults to the fixed `"website-recheck"` key the scanner tick (`tick.ts`)
 * relies on: that queue is `policy: "exclusive"` (one job queued-or-active per key), which is
 * exactly the dedupe the tick wants — it never passes `opts`, so it keeps the shared key.
 * A caller that needs to queue more than one batch at a time (e.g. the cleanup script firing
 * several batches back to back) must pass a unique `singletonKey` per batch, or every batch
 * after the first will silently no-op (return `false`) under the shared key.
 */
export async function enqueueWebsiteRecheck(
  businessIds: string[],
  ownerId: string,
  opts: { singletonKey?: string } = {},
): Promise<boolean> {
  const singletonKey = opts.singletonKey ?? DEFAULT_WEBSITE_RECHECK_SINGLETON_KEY;
  if (process.env.JOB_MODE === "inline") {
    // runWebsiteRecheck has no outer JobPausedError handling of its own (see its doc comment);
    // a pause is expected/normal here, not a bug, so it's logged quietly rather than as an error.
    void runWebsiteRecheck(businessIds, ownerId, { providers: getProviders(), log: console.log, shouldPause: scannerPauseCheck(ownerId) }).catch((e) => {
      if (e instanceof JobPausedError) console.log("[inline website-recheck] paused");
      else console.error("[inline website-recheck]", e);
    });
    return true;
  }
  const boss = await getBoss();
  const data: WebsiteRecheckJobData = { businessIds, ownerId };
  const id = await boss.send(QUEUES.websiteRecheck, data, { retryLimit: 1, retryDelay: 60, priority: SCANNER_PRIORITY, singletonKey });
  return id !== null;
}

/**
 * `enqueue.ts` <-> `scanner/tick.ts` import cycle: `runScannerTick` calls
 * `enqueueZipSearch`/`enqueueTdlrSync`/`enqueueWebsiteRecheck` from this file, so this
 * function imports it lazily instead of at module scope.
 */
let inlineTick: Promise<unknown> | null = null;

/**
 * In `JOB_MODE=inline`, a tick isn't sent to pg-boss (whose "exclusive" policy on this queue
 * would dedupe it), so it needs its own in-process guard: without it, two calls that land
 * before either's first `await` (e.g. the navbar pill and a manual "Run now" firing close
 * together) would both pass a naive check-then-set and run `runScannerTick` concurrently.
 * Assigning `inlineTick` synchronously, before any `await` in this branch, closes that race —
 * a concurrent call sees it set and returns `false` instead of starting a second tick.
 */
export async function enqueueScannerTick(): Promise<boolean> {
  if (process.env.JOB_MODE === "inline") {
    if (inlineTick) return false;
    inlineTick = import("@/lib/scanner/tick")
      .then(({ runScannerTick }) => runScannerTick())
      .catch((e) => console.error("[inline scanner-tick]", e))
      .finally(() => {
        inlineTick = null;
      });
    return true;
  }
  const boss = await getBoss();
  const data: ScannerTickJobData = {};
  const id = await boss.send(QUEUES.scannerTick, data, { retryLimit: 0, priority: MANUAL_PRIORITY, singletonKey: "scanner-tick" });
  return id !== null;
}
