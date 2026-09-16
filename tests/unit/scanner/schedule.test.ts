import { describe, it, expect } from "vitest";
import { scheduleUpdateSchema } from "@/lib/scanner/schedule";

describe("scheduleUpdateSchema", () => {
  it("accepts a full update and coerces dates", () => {
    const u = scheduleUpdateSchema.parse({
      enabled: true, windowStart: "2026-09-16T13:00:00.000Z", windowEnd: null, dailyStartTime: "06:00", dailyEndTime: "22:00",
      daysOfWeek: [1, 2, 3, 4, 5], timezone: "America/Chicago", zipRefreshDays: 7, tdlrSyncHours: 6, websiteRecheckDays: 30, autoAddHotZips: true, maxConcurrentJobs: 1,
    });
    expect(u.windowStart).toBeInstanceOf(Date);
    expect(u.windowEnd).toBeNull();
    expect(u.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });
  it("rejects bad times, days, timezones, and ranges", () => {
    expect(() => scheduleUpdateSchema.parse({ dailyStartTime: "6am" })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ daysOfWeek: [7] })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ timezone: "Mars/Olympus" })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ zipRefreshDays: 0 })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ maxConcurrentJobs: 3 })).toThrow();
    expect(() => scheduleUpdateSchema.parse({ windowStart: "not a date" })).toThrow();
  });
  it("allows partial updates", () => {
    expect(scheduleUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});
