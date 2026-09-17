export type ActivityLike = { kind: string; message: string };

/**
 * True when an enrich-related activity message represents an unavailable or paused attempt —
 * worth surfacing as a persistent line under the Enrich button so a failed click stays visible
 * after a page refresh, not just as a one-shot toast.
 *
 * Deliberately excludes "Enrichment skipped: ..." messages: that prefix also covers the benign
 * recency skip runEnrich logs when a business was enriched too recently to recheck (expected,
 * not a problem — the button already says "Re-enrich" in that state) and the disabled-provider
 * skip, which would otherwise duplicate the existing monthly-credit-cap line for the common case.
 */
export function isEnrichIssueMessage(message: string): boolean {
  return /^Enrichment (unavailable|paused)/.test(message);
}

/**
 * Returns the most recent `enriched`-kind activity row, but only when it represents an
 * unavailable/paused issue — i.e. a later successful "Enriched via Apollo: ..." run (or any
 * other non-issue enriched row) clears the line, even if an older failure is still further down
 * the activity log. `activity` must be ordered most-recent-first, matching what
 * `getBusinessDetail` returns.
 */
export function latestEnrichIssue<T extends ActivityLike>(activity: T[]): T | null {
  const latest = activity.find((a) => a.kind === "enriched");
  return latest && isEnrichIssueMessage(latest.message) ? latest : null;
}
