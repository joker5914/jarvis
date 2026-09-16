/** Defaults for TDLR sync and promotion. A Settings UI edits these in a later plan. */
export const PROJECT_CONFIG = {
  backfillMonths: 12,
  staleAfterDays: 90,
  recheckAfterDays: 30,
  refreshBatchSize: 500,
  highFitThreshold: 60,
  autoLinkSimilarity: 0.8,
  justCompletedDays: 60,
  openingSoonDays: 45,
} as const;

/**
 * TDLR status code for "Project Closed". Lives here (rather than in
 * providers/tdlr.ts) so scoring/timingWindow.ts doesn't need to depend on the
 * provider layer; providers/tdlr.ts re-exports it for compatibility.
 */
export const TDLR_STATUS_CLOSED = 3007;
