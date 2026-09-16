export const QUEUES = {
  zipSearch: "zip-search",
  tdlrSync: "tdlr-sync",
  promote: "promote",
  promoteBatch: "promote-batch",
  websiteRecheck: "website-recheck",
  scannerTick: "scanner-tick",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// A real 12-month Houston TDLR backfill is ~2.5–4k detail fetches at 1 req/s (45–70 min),
// so sync/batch get six hours; the tick is tiny and must never overlap itself.
//
// `policy` is what actually makes `singletonKey` dedupe queued-or-active jobs: pg-boss's
// default "standard" policy allows unlimited jobs under the same singletonKey (it only
// throttles when paired with `singletonSeconds`). Queues that should never have two jobs
// in flight for the same owner/key at once ("exclusive": at most one job total, queued or
// active, per singletonKey) get scannerTick/tdlrSync/websiteRecheck/promoteBatch, all of
// which are already sent with one fixed singletonKey. zipSearch/promote key per item
// (searchId/businessId) and legitimately need to hold a retry (queued) alongside an
// active run of the same key without colliding, so they get "stately" (one job per
// created/retry/active state, per singletonKey) instead.
export const QUEUE_OPTIONS: Record<QueueName, { expireInSeconds: number; policy: "exclusive" | "stately" }> = {
  [QUEUES.zipSearch]: { expireInSeconds: 3600, policy: "stately" },
  [QUEUES.tdlrSync]: { expireInSeconds: 6 * 3600, policy: "exclusive" },
  [QUEUES.promote]: { expireInSeconds: 3600, policy: "stately" },
  [QUEUES.promoteBatch]: { expireInSeconds: 6 * 3600, policy: "exclusive" },
  [QUEUES.websiteRecheck]: { expireInSeconds: 3600, policy: "exclusive" },
  [QUEUES.scannerTick]: { expireInSeconds: 300, policy: "exclusive" },
};

export type JobOrigin = "manual" | "scanner";
export type ZipSearchJobData = { searchId: string; origin?: JobOrigin };
export type TdlrSyncJobData = { origin?: JobOrigin };
export type PromoteJobData = { businessId: string; ownerId: string };
export type PromoteBatchJobData = Record<string, never>;
export type WebsiteRecheckJobData = { businessIds: string[]; ownerId: string };
export type ScannerTickJobData = Record<string, never>;

// Minimal structural type for the pg-boss instance this helper needs: avoids importing the
// `pg-boss` package (and its types) into every caller just to type one parameter.
type BossLike = {
  createQueue(name: string, options?: unknown): Promise<void>;
  getQueues(names?: string[]): Promise<{ name: string; policy?: string }[]>;
  deleteQueue(name: string): Promise<void>;
};

/**
 * `createQueue` is `ON CONFLICT DO NOTHING` once the queue row exists — pg-boss 12.32 has no
 * API that changes an existing queue's `policy`: `updateQueue`'s `UpdateQueueOptions` type
 * excludes `policy`, and its SQL (`plans.updateQueue`) never touches the `policy` column
 * either. So a database that already has these queues from before this policy was introduced
 * needs to actually drop and recreate the queue to pick it up. That's destructive (any jobs
 * still queued for it are discarded), so it's applied only outside production, where these
 * are disposable dev/test databases; in production it only logs a warning so an operator can
 * migrate deliberately (e.g. during a maintenance window) instead of silently losing jobs.
 */
export async function ensureQueue(boss: BossLike, name: QueueName, options: (typeof QUEUE_OPTIONS)[QueueName]): Promise<void> {
  await boss.createQueue(name, options);
  const [existing] = await boss.getQueues([name]);
  if (existing && existing.policy !== options.policy) {
    if (process.env.NODE_ENV === "production") {
      console.warn(`[pg-boss] queue "${name}" has policy "${existing.policy}", expected "${options.policy}"; pg-boss cannot change an existing queue's policy in place — recreate it manually`);
      return;
    }
    console.log(`[pg-boss] recreating queue "${name}" to pick up policy "${options.policy}" (was "${existing.policy}")`);
    await boss.deleteQueue(name);
    await boss.createQueue(name, options);
  }
}
