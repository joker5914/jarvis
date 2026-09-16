import { describe, it, expect } from "vitest";
import { todayKey } from "@/lib/providers/budget";
import { REGION } from "@/lib/config/region";

describe("todayKey", () => {
  it("formats YYYY-MM-DD in the given timezone", () => {
    expect(todayKey(REGION.timezone)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("defaults to the configured region's timezone", () => {
    expect(todayKey()).toBe(todayKey(REGION.timezone));
  });
});
