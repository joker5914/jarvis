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
export const QUEUE_OPTIONS: Record<QueueName, { expireInSeconds: number }> = {
  [QUEUES.zipSearch]: { expireInSeconds: 3600 },
  [QUEUES.tdlrSync]: { expireInSeconds: 6 * 3600 },
  [QUEUES.promote]: { expireInSeconds: 3600 },
  [QUEUES.promoteBatch]: { expireInSeconds: 6 * 3600 },
  [QUEUES.websiteRecheck]: { expireInSeconds: 3600 },
  [QUEUES.scannerTick]: { expireInSeconds: 300 },
};

export type JobOrigin = "manual" | "scanner";
export type ZipSearchJobData = { searchId: string; origin?: JobOrigin };
export type TdlrSyncJobData = Record<string, never>;
export type PromoteJobData = { businessId: string; ownerId: string };
export type PromoteBatchJobData = Record<string, never>;
export type WebsiteRecheckJobData = { businessIds: string[]; ownerId: string };
export type ScannerTickJobData = Record<string, never>;
