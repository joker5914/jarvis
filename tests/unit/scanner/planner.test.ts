import { describe, it, expect } from "vitest";
import { pickNextWork, workKey, type PlannerInput } from "@/lib/scanner/planner";

const now = new Date("2026-09-16T15:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const d = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base: PlannerInput = {
  now,
  schedule: { tdlrSyncHours: 6, zipRefreshDays: 7, websiteRecheckDays: 30, maxConcurrentJobs: 1 },
  tdlrLastSuccessfulAt: h(1),
  tdlrRunning: false,
  runningScannerJobs: 0,
  pausedSearch: null,
  targets: [],
  staleBusinessIds: [],
  skipUntil: {},
};

describe("pickNextWork", () => {
  it("is busy when the concurrency cap is reached", () => {
    expect(pickNextWork({ ...base, runningScannerJobs: 1 })).toEqual({ kind: "busy" });
  });
  it("prefers a due TDLR sync", () => {
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: h(7), targets: [{ id: "t", zip: "77084", priority: 0, paused: false, lastSearchedAt: null }] })).toEqual({ kind: "tdlr_sync" });
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: null }).kind).toBe("tdlr_sync");
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: h(7), tdlrRunning: true }).kind).toBe("idle");
  });
  it("resumes a paused scanner search before starting new ones", () => {
    expect(pickNextWork({ ...base, pausedSearch: { id: "s1", zip: "77084" }, targets: [{ id: "t", zip: "77005", priority: 9, paused: false, lastSearchedAt: null }] })).toEqual({ kind: "resume_search", searchId: "s1", zip: "77084" });
  });
  it("picks the highest-priority due target, oldest search first on ties, skipping paused", () => {
    const targets = [
      { id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: d(10) },
      { id: "b", zip: "77002", priority: 5, paused: true, lastSearchedAt: null },
      { id: "c", zip: "77003", priority: 5, paused: false, lastSearchedAt: d(8) },
      { id: "d", zip: "77004", priority: 5, paused: false, lastSearchedAt: d(9) },
      { id: "e", zip: "77005", priority: 9, paused: false, lastSearchedAt: d(2) },
    ];
    expect(pickNextWork({ ...base, targets })).toEqual({ kind: "zip_search", targetId: "d", zip: "77004" });
  });
  it("honors per-item skips", () => {
    const targets = [{ id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: null }];
    const skipUntil = { "zip:77001": new Date(now.getTime() + 3_600_000).toISOString() };
    expect(pickNextWork({ ...base, targets, skipUntil }).kind).toBe("idle");
    expect(pickNextWork({ ...base, tdlrLastSuccessfulAt: null, skipUntil: { tdlr: new Date(now.getTime() + 60_000).toISOString() } }).kind).toBe("idle");
  });
  it("falls back to a website re-check batch", () => {
    expect(pickNextWork({ ...base, staleBusinessIds: ["b1", "b2"] })).toEqual({ kind: "website_recheck", businessIds: ["b1", "b2"] });
  });
  it("reports the next due time when idle", () => {
    const w = pickNextWork({ ...base, tdlrLastSuccessfulAt: h(1), targets: [{ id: "a", zip: "77001", priority: 0, paused: false, lastSearchedAt: d(3) }] });
    expect(w.kind).toBe("idle");
    if (w.kind === "idle") {
      // tdlr due in 5 h, zip due in 4 d → next is the tdlr sync
      expect(w.nextDueAt?.toISOString()).toBe(new Date(now.getTime() + 5 * 3_600_000).toISOString());
    }
  });
  it("derives stable keys", () => {
    expect(workKey({ kind: "tdlr_sync" })).toBe("tdlr");
    expect(workKey({ kind: "zip_search", targetId: "a", zip: "77001" })).toBe("zip:77001");
    expect(workKey({ kind: "resume_search", searchId: "s", zip: "77001" })).toBe("zip:77001");
    expect(workKey({ kind: "website_recheck", businessIds: [] })).toBe("website_recheck");
    expect(workKey({ kind: "idle", nextDueAt: null, reason: "" })).toBeNull();
  });
});
