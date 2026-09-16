import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { scannerPauseCheck } from "@/lib/jobs/shared";

const OWNER = "local-user";

beforeEach(async () => {
  await prisma.scannerState.deleteMany();
  await prisma.scanSchedule.deleteMany();
});

describe("scannerPauseCheck", () => {
  it("is false when neither pauseRequested nor the window apply", async () => {
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: false } });
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    expect(await scannerPauseCheck(OWNER)()).toBe(false);
  });

  it("is true when pauseRequested is set", async () => {
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: true } });
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true } });
    expect(await scannerPauseCheck(OWNER)()).toBe(true);
  });

  it("is true once the schedule's window has closed out from under an in-flight job (M1)", async () => {
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: false } });
    // windowEnd already in the past relative to the real clock, deterministically regardless
    // of when this test runs — reproduces a job that started inside the window and is still
    // running once windowEnd arrives.
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true, windowEnd: new Date(Date.now() - 60_000) } });
    expect(await scannerPauseCheck(OWNER)()).toBe(true);
  });

  it("is true when windowStart is still in the future (job started before the window opened)", async () => {
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: false } });
    await prisma.scanSchedule.create({ data: { ownerId: OWNER, enabled: true, windowStart: new Date(Date.now() + 3_600_000) } });
    expect(await scannerPauseCheck(OWNER)()).toBe(true);
  });

  it("is false when the ScanSchedule row doesn't exist yet", async () => {
    await prisma.scannerState.create({ data: { ownerId: OWNER, pauseRequested: false } });
    expect(await scannerPauseCheck(OWNER)()).toBe(false);
  });
});
