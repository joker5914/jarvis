import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { applyScheduleUpdate } from "@/lib/scanner/schedule";

// TEST_DATABASE_URL is required and wired to DATABASE_URL by tests/db/setup.ts (a global
// setupFile for this suite), which throws before any test runs if it's missing.
const OWNER = "test-scanner-schedule-owner";
const START = new Date("2026-09-16T10:00:00.000Z");
const END = new Date("2026-09-16T20:00:00.000Z");

async function cleanup() {
  await prisma.scanSchedule.deleteMany({ where: { ownerId: OWNER } });
}

beforeEach(cleanup);
afterAll(cleanup);

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("applyScheduleUpdate windowEnd-before-windowStart guard", () => {
  it("rejects when both are provided out of order, and persists nothing", async () => {
    const error = await captureError(() => applyScheduleUpdate(OWNER, { windowStart: END, windowEnd: START }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const row = await prisma.scanSchedule.findUnique({ where: { ownerId: OWNER } });
    expect(row).toBeNull();
  });

  it("rejects when only windowEnd is provided and precedes the already-persisted windowStart", async () => {
    await applyScheduleUpdate(OWNER, { windowStart: START, windowEnd: END });
    const before = new Date(START.getTime() - 5 * 3_600_000);
    const error = await captureError(() => applyScheduleUpdate(OWNER, { windowEnd: before }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(row.windowStart).toEqual(START);
    expect(row.windowEnd).toEqual(END);
  });

  it("rejects when only windowStart is provided and follows the already-persisted windowEnd", async () => {
    await applyScheduleUpdate(OWNER, { windowStart: START, windowEnd: END });
    const after = new Date(END.getTime() + 3_600_000);
    const error = await captureError(() => applyScheduleUpdate(OWNER, { windowStart: after }));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(row.windowStart).toEqual(START);
    expect(row.windowEnd).toEqual(END);
  });

  it("accepts clearing one side to null while the other remains set", async () => {
    await applyScheduleUpdate(OWNER, { windowStart: START, windowEnd: END });
    const updated = await applyScheduleUpdate(OWNER, { windowEnd: null });
    expect(updated.windowStart).toEqual(START);
    expect(updated.windowEnd).toBeNull();
    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(row.windowStart).toEqual(START);
    expect(row.windowEnd).toBeNull();
  });

  it("accepts and persists a valid ordered pair", async () => {
    const updated = await applyScheduleUpdate(OWNER, { windowStart: START, windowEnd: END });
    expect(updated.windowStart).toEqual(START);
    expect(updated.windowEnd).toEqual(END);
    const row = await prisma.scanSchedule.findUniqueOrThrow({ where: { ownerId: OWNER } });
    expect(row.windowStart).toEqual(START);
    expect(row.windowEnd).toEqual(END);
  });
});
