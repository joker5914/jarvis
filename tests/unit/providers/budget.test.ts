import { describe, it, expect } from "vitest";
import { todayKey } from "@/lib/providers/budget";

describe("todayKey", () => {
  it("formats YYYY-MM-DD in the given timezone", () => {
    expect(todayKey("America/Chicago")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
