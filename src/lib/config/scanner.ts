export const SCANNER_CONFIG = {
  tickMinutes: 5,
  recheckBatchSize: 25,
  failureSkipHours: 6,
  maxConsecutiveFailures: 3,
  hotZipPriority: 100,
} as const;
