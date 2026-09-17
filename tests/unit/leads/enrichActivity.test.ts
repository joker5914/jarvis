import { describe, it, expect } from "vitest";
import { isEnrichIssueMessage, latestEnrichIssue } from "@/lib/leads/enrichActivity";

describe("isEnrichIssueMessage", () => {
  it("matches unavailable and paused prefixes", () => {
    expect(isEnrichIssueMessage("Enrichment unavailable: Your Apollo plan does not include the people search and enrichment API. (API_INACCESSIBLE)")).toBe(true);
    expect(isEnrichIssueMessage("Enrichment paused: Apollo daily budget exhausted")).toBe(true);
  });

  // M3: runEnrich's generic catch-all now logs "Enrichment failed: <message>" for anything not
  // already a typed provider error (429s, 5xxs, network errors); LeadDetail must surface it too.
  it("matches the failed prefix", () => {
    expect(isEnrichIssueMessage("Enrichment failed: Apollo /x HTTP 503")).toBe(true);
  });

  it("does not match skipped messages (the benign recency skip, or the disabled-provider skip)", () => {
    expect(isEnrichIssueMessage("Enrichment skipped: enriched 2 day(s) ago (use Re-enrich to refresh)")).toBe(false);
    expect(isEnrichIssueMessage("Enrichment skipped: Apollo is disabled in Settings")).toBe(false);
    expect(isEnrichIssueMessage("Enrichment skipped: Apollo API key is not configured")).toBe(false);
  });

  it("does not match a successful enrichment or unrelated activity", () => {
    expect(isEnrichIssueMessage("Enriched via Apollo: 1 person with a verified email out of 2 found; 2 new contacts, 0 updated")).toBe(false);
    expect(isEnrichIssueMessage("Status set to contacted")).toBe(false);
  });
});

describe("latestEnrichIssue", () => {
  const OLD = { id: "a1", kind: "enriched", message: "Enrichment unavailable: Your Apollo plan does not include the people search and enrichment API. (API_INACCESSIBLE)" };
  const SUCCESS = { id: "a2", kind: "enriched", message: "Enriched via Apollo: 1 person with a verified email out of 2 found; 2 new contacts, 0 updated" };
  const STATUS = { id: "a3", kind: "status_changed", message: "Status set to contacted" };
  const RECENT_SKIP = { id: "a4", kind: "enriched", message: "Enrichment skipped: enriched 1 day(s) ago (use Re-enrich to refresh)" };
  const PAUSED = { id: "a5", kind: "enriched", message: "Enrichment paused: Apollo daily budget exhausted" };

  it("returns the newest enriched row when it is itself an issue", () => {
    // Most-recent-first, matching getBusinessDetail's ordering.
    expect(latestEnrichIssue([PAUSED, OLD])).toBe(PAUSED);
  });

  it("returns null once a later successful run supersedes an older failure, even though the failure is still in the log", () => {
    expect(latestEnrichIssue([SUCCESS, OLD])).toBeNull();
  });

  it("returns null when the newest enriched row is the benign recency skip", () => {
    expect(latestEnrichIssue([RECENT_SKIP, OLD])).toBeNull();
  });

  it("skips over non-enriched activity kinds to find the newest enriched row", () => {
    expect(latestEnrichIssue([STATUS, OLD])).toBe(OLD);
  });

  it("returns null for an empty or all-non-enriched activity list", () => {
    expect(latestEnrichIssue([])).toBeNull();
    expect(latestEnrichIssue([STATUS])).toBeNull();
  });
});

describe("isEnrichIssueMessage: org-mismatch skip", () => {
  it("surfaces the 'matched a different company' skip (lastEnrichedAt is set, People list is empty, so the line explains why)", () => {
    expect(isEnrichIssueMessage("Enrichment skipped: Apollo matched a different company (Booksy)")).toBe(true);
  });
  it("still hides the benign recency skip", () => {
    expect(isEnrichIssueMessage("Enrichment skipped: enriched 3 day(s) ago (use Re-enrich to refresh)")).toBe(false);
  });
});

describe("isEnrichIssueMessage: chain-headcount skip (Plan 9 Task 3)", () => {
  it("surfaces the chain-headcount skip so LeadDetail explains why the People list is empty", () => {
    expect(isEnrichIssueMessage("Enrichment skipped: 6579 people at hrblock.com in Apollo — not an SMB (marked as chain)")).toBe(true);
  });
});
