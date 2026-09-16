import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { readScanner } from "@/lib/scanner/state";
import { applyScheduleUpdate } from "@/lib/scanner/schedule";

// TEST_DATABASE_URL is required and wired to DATABASE_URL by tests/db/setup.ts (a global
// setupFile for this suite), which throws before any test runs if it's missing.
const OWNER_D1 = "test-scanner-deferrals-d1-owner";
const OWNER_D2 = "test-scanner-deferrals-d2-owner";
const HOUR = 3_600_000;

async function cleanup() {
  await prisma.scanSchedule.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
  await prisma.scannerState.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
  await prisma.scanTarget.deleteMany({ where: { ownerId: { in: [OWNER_D1, OWNER_D2] } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("D1: readScanner first-poll race", () => {
  it("three concurrent calls on a fresh owner resolve without throwing and leave one row each", async () => {
    const results = await Promise.all([readScanner(OWNER_D1), readScanner(OWNER_D1), readScanner(OWNER_D1)]);
    for (const r of results) {
      expect(r.schedule.ownerId).toBe(OWNER_D1);
      expect(r.state.ownerId).toBe(OWNER_D1);
    }
    const schedules = await prisma.scanSchedule.findMany({ where: { ownerId: OWNER_D1 } });
    const states = await prisma.scannerState.findMany({ where: { ownerId: OWNER_D1 } });
    expect(schedules).toHaveLength(1);
    expect(states).toHaveLength(1);
  });
});

describe("D2: applyScheduleUpdate atomicity", () => {
  it("never persists windowEnd < windowStart under concurrent conflicting updates", async () => {
    const T = new Date("2026-09-16T10:00:00.000Z");
    await applyScheduleUpdate(OWNER_D2, { windowStart: T, windowEnd: new Date(T.getTime() + 20 * HOUR) });

    const results = await Promise.allSettled([
      applyScheduleUpdate(OWNER_D2, { windowStart: new Date(T.getTime() + 10 * HOUR) }),
      applyScheduleUpdate(OWNER_D2, { windowEnd: new Date(T.getTime() + 5 * HOUR) }),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // At least one of the two conflicting updates must have been rejected (either immediately,
    // because it read the other's already-committed change, or after a P2034 retry saw it).
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ApiError);
      expect((r.reason as ApiError).status).toBe(400);
    }

    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER_D2 } });
    if (row.windowStart && row.windowEnd) {
      expect(row.windowEnd.getTime()).toBeGreaterThanOrEqual(row.windowStart.getTime());
    }
  });
});
