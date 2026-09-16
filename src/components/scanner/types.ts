export type ScannerPayload = {
  state: { status: string; pauseRequested: boolean; currentActivity: string | null; nextPlanned: { kind: string; at: string | null; detail?: string } | null; lastError: string | null; lastTickAt: string | null; consecutiveFailures: number };
  schedule: { enabled: boolean; windowStart: string | null; windowEnd: string | null; dailyStartTime: string | null; dailyEndTime: string | null; daysOfWeek: number[]; timezone: string; zipRefreshDays: number; tdlrSyncHours: number; websiteRecheckDays: number; autoAddHotZips: boolean; maxConcurrentJobs: number };
  targets: { id: string; zip: string; priority: number; addedBy: string; lastSearchedAt: string | null; lastSearchId: string | null; paused: boolean }[];
  budget: { used: number; limit: number; exhausted: boolean };
  window: { ok: boolean; reason?: string };
  activity: { id: string; message: string; createdAt: string }[];
};
