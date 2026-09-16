/** Defaults for TDLR sync and promotion. A Settings UI edits these in a later plan. */
export const PROJECT_CONFIG = {
  backfillMonths: 12,
  staleAfterDays: 90,
  recheckAfterDays: 30,
  highFitThreshold: 60,
  autoLinkSimilarity: 0.8,
  justCompletedDays: 60,
  openingSoonDays: 45,
} as const;
