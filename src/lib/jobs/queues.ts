export const QUEUES = {
  zipSearch: "zip-search",
  tdlrSync: "tdlr-sync",
  promote: "promote",
  promoteBatch: "promote-batch",
} as const;

// A real-mode zip search (discovery + scraping + MX validation across many
// businesses) can run well past pg-boss's default 900s job expiry, as can a
// real 12-month Houston TDLR backfill (roughly 2.5k-4k detail fetches at 1
// req/s, i.e. 45-70 minutes) or a promote-batch pass over many high-fit
// projects. Give each queue headroom sized to its worst case instead of one
// shared constant.
export const QUEUE_OPTIONS: Record<string, { expireInSeconds: number }> = {
  [QUEUES.zipSearch]: { expireInSeconds: 3600 },
  [QUEUES.tdlrSync]: { expireInSeconds: 6 * 3600 },
  [QUEUES.promote]: { expireInSeconds: 3600 },
  [QUEUES.promoteBatch]: { expireInSeconds: 6 * 3600 },
};

export type ZipSearchJobData = { searchId: string };
export type TdlrSyncJobData = Record<string, never>;
export type PromoteJobData = { businessId: string; ownerId: string };
export type PromoteBatchJobData = Record<string, never>;
