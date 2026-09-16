import { describe, it, expect } from "vitest";
import { isSyncRunning, RUNNING_STALE_MS, type SyncCursor } from "@/lib/jobs/syncStatus";

describe("isSyncRunning", () => {
  const now = new Date("2026-09-16T12:00:00.000Z");

  it("running with startedAt 5 minutes ago is still running", () => {
    const cursor: SyncCursor = { status: "running", startedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString() };
    expect(isSyncRunning(cursor, now)).toBe(true);
  });

  it("running with startedAt 3 hours ago is treated as abandoned", () => {
    const cursor: SyncCursor = { status: "running", startedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString() };
    expect(isSyncRunning(cursor, now)).toBe(false);
  });

  it("running with no startedAt is still running", () => {
    const cursor: SyncCursor = { status: "running" };
    expect(isSyncRunning(cursor, now)).toBe(true);
  });

  it("idle, failed, and paused are never running", () => {
    expect(isSyncRunning({ status: "idle" }, now)).toBe(false);
    expect(isSyncRunning({ status: "failed" }, now)).toBe(false);
    expect(isSyncRunning({ status: "paused" }, now)).toBe(false);
  });

  it("exports the stale cutoff as 2 hours", () => {
    expect(RUNNING_STALE_MS).toBe(2 * 60 * 60 * 1000);
  });
});
