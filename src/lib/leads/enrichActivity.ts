export type ActivityLike = { kind: string; message: string };

/**
 * True when an enrich-related activity message represents an unavailable, paused, or failed
 * attempt — worth surfacing as a persistent line under the Enrich button so a failed click stays
 * visible after a page refresh, not just as a one-shot toast.
 *
 * Deliberately excludes "Enrichment skipped: ..." messages: that prefix also covers the benign
 * recency skip runEnrich logs when a business was enriched too recently to recheck (expected,
 * not a problem — the button already says "Re-enrich" in that state) and the disabled-provider
 * skip, which would otherwise duplicate the existing monthly-credit-cap line for the common case.
 *
 * "failed" (whole-branch review, M3) covers runEnrich's generic catch-all — 429s, 5xxs, network
 * errors, anything not already one of the typed provider errors above — which previously left no
 * activity row at all, so LeadDetail had no way to show that a click had failed.
 */
export function isEnrichIssueMessage(message: string): boolean {
  // Two "skipped" messages that *are* worth showing even though "skipped" usually means benign:
  //  - the search matched a different company, so nothing was enriched even though
  //    lastEnrichedAt is now set (button reads "Re-enrich", People list is empty);
  //  - the chain-headcount guard (Plan 9 Task 3) excluded the business instead of enriching it,
  //    so the People list is empty for a reason that isn't the ordinary recency/disabled skips.
  //    Fix round (review N1/N9): the guard's message counts title/seniority-filtered
  //    decision-makers, not a raw headcount — wording (and this regex) updated to match; the
  //    persisted `chain:apollo_headcount:<n>` reason string itself is unchanged (see enrich.ts).
  return (
    /^Enrichment (unavailable|paused|failed)/.test(message) ||
    /^Enrichment skipped: Apollo matched a different company/.test(message) ||
    /^Enrichment skipped: \d+ decision-makers at .+ in Apollo — not an SMB/.test(message)
  );
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
