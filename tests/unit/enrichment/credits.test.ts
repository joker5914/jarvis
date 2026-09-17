import { describe, it, expect } from "vitest";
import { creditCycleStart, estimateCredits } from "@/lib/enrichment/credits";

const TZ = "America/Chicago";
describe("creditCycleStart", () => {
  it("defaults to the first of the current month in the schedule timezone", () => {
    expect(creditCycleStart(new Date("2026-09-17T05:00:00Z"), null, TZ).toISOString()).toBe("2026-09-01T05:00:00.000Z"); // 00:00 CDT
  });
  it("uses the renewal day-of-month: before the day → last month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-10T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-09-15T05:00:00.000Z");
  });
  it("on/after the renewal day → this month's occurrence", () => {
    expect(creditCycleStart(new Date("2026-10-20T12:00:00Z"), "2026-10-15", TZ).toISOString()).toBe("2026-10-15T05:00:00.000Z");
  });
  it("clamps day 31 to shorter months", () => {
    expect(creditCycleStart(new Date("2026-04-30T12:00:00Z"), "2026-01-31", TZ).toISOString()).toBe("2026-04-30T05:00:00.000Z");
  });
});
describe("estimateCredits", () => {
  it("is businesses × people", () => expect(estimateCredits(10, 1)).toBe(10));
});
