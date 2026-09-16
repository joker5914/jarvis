import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runScannerTick, type TickDeps } from "@/lib/scanner/tick";
import { readScanner } from "@/lib/scanner/state";
import { writeSync, SYNC_KEYS } from "@/lib/jobs/syncStatus";

const OWNER = "local-user";
const now = new Date("2026-09-16T15:00:00Z"); // Wednesday 10:00 Central
const DAY = 86_400_000;

function spies() {
  const calls = { zip: [] as { searchId: string; opts: unknown }[], tdlr: 0, tdlrOpts: [] as unknown[], recheck: [] as string[][] };
  const enqueue: NonNullable<TickDeps["enqueue"]> = {
    zipSearch: async (searchId, opts) => { calls.zip.push({ searchId, opts }); return true; },
    tdlrSync: async (opts) => { calls.tdlr++; calls.tdlrOpts.push(opts); return true; },
    websiteRecheck: async (ids) => { calls.recheck.push(ids); return true; },
  };
  return { calls, enqueue };
}

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.searchBusiness.deleteMany();
  await prisma.search.deleteMany();
  await prisma.business.deleteMany();
  await prisma.project.deleteMany();
  await prisma.scanTarget.deleteMany();
  await prisma.scanSchedule.deleteMany();
  await prisma.scannerState.deleteMany();
  await prisma.syncState.deleteMany();
  await prisma.providerConfig.deleteMany();
  await writeSync(SYNC_KEYS.tdlr, { status: "idle" }, new Date(now.getTime() - 3_600_000)); // synced 1 h ago: not due
});

describe("runScannerTick", () => {
  it("is disabled until the schedule is enabled", async () => {
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("disabled");
    expect(calls.zip).toHaveLength(0);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.lastTickAt).not.toBeNull();
  });

  it("stays disabled and leaves pauseRequested alone when a scanner search failed while off", async () => {
    // The disabled gate runs before failure accounting/auto-pause, so a schedule the user
    // switched off is never nudged into pauseRequested by a search that failed while it was off.
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77001", origin: "scanner", status: "failed", error: "boom" } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("disabled");
    expect(calls.zip).toHaveLength(0);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.pauseRequested).toBe(false);
  });

  it("baselines a freshly created ScannerState row's lastTickAt at now", async () => {
    const { state } = await readScanner(OWNER);
    expect(state.lastTickAt).not.toBeNull();
    expect(Date.now() - state.lastTickAt!.getTime()).toBeLessThan(60_000);
  });

  it("reports outside_window when the daily hours exclude now, with a future nextPlanned.at", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true, dailyStartTime: "18:00", dailyEndTime: "22:00" } });
    const r = await runScannerTick({ now: () => now, enqueue: spies().enqueue });
    expect(r.status).toBe("outside_window");
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    const at = (state.nextPlanned as { at: string | null }).at;
    expect(at).not.toBeNull();
    expect(Date.parse(at!)).toBeGreaterThan(now.getTime());
    // 18:00 today, later than the 10:00 "now".
    expect(at).toBe(new Date("2026-09-16T23:00:00Z").toISOString());
  });

  it("starts the highest-priority due zip search with scanner origin and records it on the target", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.createMany({ data: [{ ownerId: OWNER, zip: "77001", priority: 1 }, { ownerId: OWNER, zip: "77084", priority: 5 }] });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toMatchObject({ kind: "zip_search", zip: "77084" });
    expect(calls.zip).toHaveLength(1);
    expect(calls.zip[0].opts).toEqual({ priority: 1, origin: "scanner" });
    const search = await prisma.search.findUniqueOrThrow({ where: { id: calls.zip[0].searchId } });
    expect(search.origin).toBe("scanner");
    const target = await prisma.scanTarget.findUniqueOrThrow({ where: { ownerId_zip: { ownerId: OWNER, zip: "77084" } } });
    expect(target.lastSearchId).toBe(search.id);
    expect(target.lastSearchedAt?.toISOString()).toBe(now.toISOString());
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentActivity).toBe("Zip search 77084");
    expect(await prisma.activityLog.count({ where: { kind: "scanner" } })).toBe(1);
  });

  it("is busy while a scanner search is running and idle when nothing is due", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77084", lastSearchedAt: new Date(now.getTime() - 2 * DAY) } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "running", progress: { step: "scrape", current: 3, total: 10, doneSteps: [] } } });
    const { calls, enqueue } = spies();
    let r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toEqual({ kind: "busy" });
    expect((await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } })).currentActivity).toBe("Zip search 77084: scrape 3/10");
    await prisma.search.updateMany({ data: { status: "complete" } });
    r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("idle");
    expect(calls.zip).toHaveLength(0);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    // TDLR synced 1 h ago with a 6 h interval → due in 5 h, sooner than the zip (due in 5 d).
    expect((state.nextPlanned as { at: string }).at).toBe(new Date(now.getTime() + 5 * 3_600_000).toISOString());
  });

  it("is busy when the TDLR sync is running, regardless of a stale currentJobId", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } }); // due immediately
    // currentJobId points at something unrelated; runningScannerJobs must not depend on it.
    await prisma.scannerState.create({ data: { ownerId: OWNER, currentJobId: "some-unrelated-id" } });
    // updatedAt is set explicitly (rather than via writeSync's real-clock stamp) so the cursor
    // reads as fresh relative to the fake `now` used throughout this suite.
    await prisma.syncState.upsert({
      where: { key: SYNC_KEYS.tdlr },
      update: { cursor: { status: "running", updatedAt: new Date(now.getTime() - 60_000).toISOString() } },
      create: { key: SYNC_KEYS.tdlr, cursor: { status: "running", updatedAt: new Date(now.getTime() - 60_000).toISOString() } },
    });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "busy" });
    expect(calls.zip).toHaveLength(0);
    expect(calls.tdlr).toBe(0);
    expect(calls.recheck).toHaveLength(0);
  });

  it("respects pauseRequested and resumes a paused search first", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    const paused = await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "paused" } });
    const { calls, enqueue } = spies();
    expect((await runScannerTick({ now: () => now, enqueue })).status).toBe("paused");
    await prisma.scannerState.update({ where: { ownerId: OWNER }, data: { pauseRequested: false } });
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "resume_search", searchId: paused.id, zip: "77084" });
    expect(calls.zip[0].searchId).toBe(paused.id);
    expect((await prisma.search.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe("queued");
  });

  it("runs a due TDLR sync ahead of zip searches and auto-adds hot zips", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await writeSync(SYNC_KEYS.tdlr, { status: "idle" }, new Date(now.getTime() - 7 * 3_600_000));
    await prisma.project.create({ data: { ownerId: OWNER, projectNumber: "TABS1", projectName: "Hot Nails", zip: "77005", smbFitScore: 80, timingWindow: "opening_soon" } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "tdlr_sync" });
    expect(calls.tdlr).toBe(1);
    expect(calls.tdlrOpts).toEqual([{ origin: "scanner" }]);
    const hot = await prisma.scanTarget.findUniqueOrThrow({ where: { ownerId_zip: { ownerId: OWNER, zip: "77005" } } });
    expect(hot.addedBy).toBe("auto_tdlr");
    expect(hot.priority).toBe(100);
  });

  it("stops on budget exhaustion", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 1, usedToday: 1, usageDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) } });
    const { calls, enqueue } = spies();
    expect((await runScannerTick({ now: () => now, enqueue })).status).toBe("budget_exhausted");
    expect(calls.zip).toHaveLength(0);
  });

  it("reports busy rather than budget_exhausted when a scanner job is already running (spec order: busy before budget)", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77084", origin: "scanner", status: "running" } });
    await prisma.providerConfig.create({ data: { provider: "google", dailyBudget: 1, usedToday: 1, usageDate: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toEqual({ kind: "busy" });
    expect(calls.zip).toHaveLength(0);
  });

  it("skips a failed zip for 6 hours and pauses after three consecutive failures", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.createMany({ data: [{ ownerId: OWNER, zip: "77001", priority: 5 }, { ownerId: OWNER, zip: "77002", priority: 1 }] });
    await prisma.scannerState.create({ data: { ownerId: OWNER, lastTickAt: new Date(now.getTime() - 300_000) } });
    // updatedAt is set explicitly so the failure lands inside the fake clock's "since last tick" window.
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77001", origin: "scanner", status: "failed", error: "boom", updatedAt: new Date(now.getTime() - 60_000) } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toMatchObject({ kind: "zip_search", zip: "77002" });
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.consecutiveFailures).toBe(1);
    expect(Object.keys(state.skipUntil as object)).toContain("zip:77001");

    await prisma.scannerState.update({ where: { ownerId: OWNER }, data: { consecutiveFailures: 2, lastTickAt: now } });
    await prisma.search.create({ data: { ownerId: OWNER, zip: "77002", origin: "scanner", status: "failed", error: "boom again", updatedAt: new Date(now.getTime() + 1000) } });
    const later = new Date(now.getTime() + 300_000);
    const r2 = await runScannerTick({ now: () => later, enqueue });
    expect(r2.status).toBe("paused");
    expect((await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } })).pauseRequested).toBe(true);
    expect(calls.zip).toHaveLength(1);
  });

  // D3: a zip's `skipUntil` entry doubles as the "already counted" marker for its 6 h skip
  // window, so a search that keeps getting observed as `failed` across ticks (e.g. retried by
  // pg-boss and failing again each time) only nudges `consecutiveFailures` once, not once per
  // observation.
  it("D3: counts a repeatedly-observed failure for the same zip once, not once per tick", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001", priority: 1 } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, lastTickAt: new Date(now.getTime() - 300_000) } });
    const search = await prisma.search.create({ data: { ownerId: OWNER, zip: "77001", origin: "scanner", status: "failed", error: "boom", updatedAt: new Date(now.getTime() - 60_000) } });
    const { enqueue } = spies();

    const t1 = now;
    await runScannerTick({ now: () => t1, enqueue });
    let state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.consecutiveFailures).toBe(1);
    expect(state.status).not.toBe("paused");

    // Retry #2: the same search row is observed `failed` again since the last tick.
    const t2 = new Date(t1.getTime() + 300_000);
    await prisma.search.update({ where: { id: search.id }, data: { updatedAt: new Date(t1.getTime() + 60_000) } });
    await runScannerTick({ now: () => t2, enqueue });
    state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.consecutiveFailures).toBe(1);
    expect(state.status).not.toBe("paused");

    // Retry #3.
    const t3 = new Date(t2.getTime() + 300_000);
    await prisma.search.update({ where: { id: search.id }, data: { updatedAt: new Date(t2.getTime() + 60_000) } });
    await runScannerTick({ now: () => t3, enqueue });
    state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.consecutiveFailures).toBe(1);
    expect(state.status).not.toBe("paused");
  });

  it("D3: three distinct failed zips observed in one tick still auto-pause", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, lastTickAt: new Date(now.getTime() - 300_000) } });
    await prisma.search.createMany({
      data: [
        { ownerId: OWNER, zip: "77001", origin: "scanner", status: "failed", error: "a", updatedAt: new Date(now.getTime() - 60_000) },
        { ownerId: OWNER, zip: "77002", origin: "scanner", status: "failed", error: "b", updatedAt: new Date(now.getTime() - 50_000) },
        { ownerId: OWNER, zip: "77003", origin: "scanner", status: "failed", error: "c", updatedAt: new Date(now.getTime() - 40_000) },
      ],
    });
    const { enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("paused");
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.pauseRequested).toBe(true);
    expect(state.consecutiveFailures).toBe(0); // reset to 0 on the pausing tick, same as the existing single-tick path
  });

  // D4: a fresh `website_recheck:<ISO>` marker on ScannerState.currentJobId counts toward
  // maxConcurrentJobs the same as a running Search row does; a stale one (older than the
  // website-recheck queue's expireInSeconds) is ignored.
  it("D4: a fresh website_recheck marker makes the tick busy; a stale one is ignored", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true, maxConcurrentJobs: 1 } });
    await prisma.scanTarget.create({ data: { ownerId: OWNER, zip: "77001" } });
    await prisma.scannerState.create({ data: { ownerId: OWNER, currentJobId: `website_recheck:${new Date(now.getTime() - 5 * 60_000).toISOString()}` } });
    const { calls, enqueue } = spies();

    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.status).toBe("running");
    expect(r.work).toEqual({ kind: "busy" });
    expect(calls.zip).toHaveLength(0);
    expect(calls.recheck).toHaveLength(0);

    // A 2 h old marker is well past QUEUE_OPTIONS["website-recheck"].expireInSeconds (1 h) and
    // must be ignored, letting the tick proceed to enqueue the due zip search instead.
    await prisma.scannerState.update({ where: { ownerId: OWNER }, data: { currentJobId: `website_recheck:${new Date(now.getTime() - 2 * 60 * 60_000).toISOString()}` } });
    const r2 = await runScannerTick({ now: () => now, enqueue });
    expect(r2.work).not.toEqual({ kind: "busy" });
    expect(calls.zip).toHaveLength(1);
  });

  it("D4: enqueuing a website recheck stamps currentJobId with an ISO-timestamped marker", async () => {
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    const b = await prisma.business.create({ data: { name: "Stale Site", websiteUrl: "https://stale.fake.test/", websiteCheckedAt: new Date(now.getTime() - 60 * DAY) } });
    const { calls, enqueue } = spies();
    const r = await runScannerTick({ now: () => now, enqueue });
    expect(r.work).toEqual({ kind: "website_recheck", businessIds: [b.id] });
    expect(calls.recheck).toEqual([[b.id]]);
    const state = await prisma.scannerState.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(state.currentJobId).toBe(`website_recheck:${now.toISOString()}`);
  });
});
