import { describe, it, expect } from "vitest";
import { isWithinWindow, localParts, nextWindowStart } from "@/lib/scanner/window";

const base = { enabled: true, windowStart: null, windowEnd: null, dailyStartTime: null, dailyEndTime: null, daysOfWeek: [] as number[], timezone: "America/Chicago" };
// 2026-09-16 is a Wednesday. 15:00 UTC = 10:00 CDT.
const wedMorning = new Date("2026-09-16T15:00:00Z");

describe("localParts", () => {
  it("converts to the schedule's timezone", () => {
    expect(localParts(wedMorning, "America/Chicago")).toEqual({ weekday: 3, minutes: 600 });
    expect(localParts(new Date("2026-09-17T04:30:00Z"), "America/Chicago")).toEqual({ weekday: 3, minutes: 23 * 60 + 30 });
  });
});

describe("isWithinWindow", () => {
  it("is off when disabled", () => {
    expect(isWithinWindow({ ...base, enabled: false }, wedMorning)).toEqual({ ok: false, reason: "disabled" });
  });
  it("honors absolute start and end", () => {
    expect(isWithinWindow({ ...base, windowStart: new Date("2026-09-17T00:00:00Z") }, wedMorning)).toEqual({ ok: false, reason: "before_start" });
    expect(isWithinWindow({ ...base, windowEnd: new Date("2026-09-16T00:00:00Z") }, wedMorning)).toEqual({ ok: false, reason: "after_end" });
    expect(isWithinWindow({ ...base, windowStart: new Date("2026-09-01T00:00:00Z"), windowEnd: new Date("2026-12-31T00:00:00Z") }, wedMorning).ok).toBe(true);
  });
  it("honors days of week in local time", () => {
    expect(isWithinWindow({ ...base, daysOfWeek: [1, 2, 4, 5] }, wedMorning)).toEqual({ ok: false, reason: "day_off" });
    expect(isWithinWindow({ ...base, daysOfWeek: [3] }, wedMorning).ok).toBe(true);
  });
  it("honors daily hours in local time, including an overnight range", () => {
    expect(isWithinWindow({ ...base, dailyStartTime: "06:00", dailyEndTime: "22:00" }, wedMorning).ok).toBe(true);
    expect(isWithinWindow({ ...base, dailyStartTime: "11:00", dailyEndTime: "22:00" }, wedMorning)).toEqual({ ok: false, reason: "outside_daily" });
    // 22:00–06:00 overnight: 10:00 is outside, 23:30 is inside
    expect(isWithinWindow({ ...base, dailyStartTime: "22:00", dailyEndTime: "06:00" }, wedMorning).ok).toBe(false);
    expect(isWithinWindow({ ...base, dailyStartTime: "22:00", dailyEndTime: "06:00" }, new Date("2026-09-17T04:30:00Z")).ok).toBe(true);
  });
  it("is open with no constraints", () => {
    expect(isWithinWindow(base, wedMorning)).toEqual({ ok: true });
  });
});

describe("nextWindowStart", () => {
  const tz = "America/Chicago";
  it("is later today when today's start time hasn't passed yet", () => {
    // wedMorning is 10:00 local; 14:00 hasn't happened yet.
    const at = nextWindowStart({ dailyStartTime: "14:00", daysOfWeek: [], timezone: tz }, wedMorning);
    expect(at.toISOString()).toBe(new Date("2026-09-16T19:00:00Z").toISOString());
  });
  it("is tomorrow when today's start time already passed and any day is allowed", () => {
    // 06:00 local already passed (now is 10:00 local).
    const at = nextWindowStart({ dailyStartTime: "06:00", daysOfWeek: [], timezone: tz }, wedMorning);
    expect(at.toISOString()).toBe(new Date("2026-09-17T11:00:00Z").toISOString());
  });
  it("skips to the next allowed weekday", () => {
    // Wednesday now; only Friday (5) is allowed.
    const at = nextWindowStart({ dailyStartTime: "08:00", daysOfWeek: [5], timezone: tz }, wedMorning);
    expect(at.toISOString()).toBe(new Date("2026-09-18T13:00:00Z").toISOString());
  });
  it("wraps to next week when only today's weekday is allowed and its start time already passed", () => {
    // Wednesday (3) is the only allowed day; 06:00 local already passed.
    const at = nextWindowStart({ dailyStartTime: "06:00", daysOfWeek: [3], timezone: tz }, wedMorning);
    expect(at.toISOString()).toBe(new Date("2026-09-23T11:00:00Z").toISOString());
  });
  it("uses 00:00 when dailyStartTime is unset", () => {
    const at = nextWindowStart({ dailyStartTime: null, daysOfWeek: [5], timezone: tz }, wedMorning);
    expect(at.toISOString()).toBe(new Date("2026-09-18T05:00:00Z").toISOString());
  });
});
