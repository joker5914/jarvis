import { describe, it, expect } from "vitest";
import { timingWindowFor } from "@/lib/scoring/timingWindow";

const now = new Date("2026-09-16T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("timingWindowFor", () => {
  it("opening_soon when completion is within 45 days", () => {
    expect(timingWindowFor({ startDate: d(-30), completionDate: d(30), statusCode: 3008 }, now)).toBe("opening_soon");
    expect(timingWindowFor({ startDate: null, completionDate: d(45), statusCode: 3008 }, now)).toBe("opening_soon");
  });
  it("under_construction when started and completion is farther out", () => {
    expect(timingWindowFor({ startDate: d(-10), completionDate: d(200), statusCode: 3008 }, now)).toBe("under_construction");
    expect(timingWindowFor({ startDate: null, completionDate: d(200), statusCode: 3008 }, now)).toBe("under_construction");
  });
  it("planned when the start date is in the future", () => {
    expect(timingWindowFor({ startDate: d(10), completionDate: d(120), statusCode: 3008 }, now)).toBe("planned");
    expect(timingWindowFor({ startDate: d(10), completionDate: null, statusCode: 3008 }, now)).toBe("planned");
  });
  it("just_completed within 60 days after completion, then stale", () => {
    expect(timingWindowFor({ startDate: d(-100), completionDate: d(-10), statusCode: 3008 }, now)).toBe("just_completed");
    expect(timingWindowFor({ startDate: d(-100), completionDate: d(-60), statusCode: 3008 }, now)).toBe("just_completed");
    expect(timingWindowFor({ startDate: d(-300), completionDate: d(-120), statusCode: 3008 }, now)).toBe("stale");
  });
  it("closed status is always stale", () => {
    expect(timingWindowFor({ startDate: d(-30), completionDate: d(30), statusCode: 3007 }, now)).toBe("stale");
  });
  it("null when no dates at all", () => {
    expect(timingWindowFor({ startDate: null, completionDate: null, statusCode: 3008 }, now)).toBeNull();
    expect(timingWindowFor({ startDate: d(-5), completionDate: null, statusCode: 3008 }, now)).toBe("under_construction");
  });
});
