import { describe, it, expect } from "vitest";
import { nextWindowStart, utcForLocal } from "@/lib/scanner/window";

const tz = "America/Chicago";

describe("utcForLocal", () => {
  it("converts a local wall-clock time to the correct UTC instant on both sides of DST", () => {
    // 2026-03-08 is CDT (spring forward already happened at 02:00 local); 09:00 CDT = 14:00Z.
    expect(utcForLocal(2026, 3, 8, 9, 0, tz).toISOString()).toBe("2026-03-08T14:00:00.000Z");
    // 2026-11-01 is CST (fall back already happened at 02:00 local); 09:00 CST = 15:00Z.
    expect(utcForLocal(2026, 11, 1, 9, 0, tz).toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });
});

describe("nextWindowStart (DST-safe local-date walk)", () => {
  it("lands on the correct UTC instant across the US spring-forward transition", () => {
    // Day before spring-forward: 2026-03-07 20:00 CST (-06:00) = 2026-03-08T02:00:00Z.
    const now = new Date("2026-03-07T20:00:00-06:00");
    const at = nextWindowStart({ dailyStartTime: "09:00", daysOfWeek: [], timezone: tz }, now);
    // Next 09:00 local is 2026-03-08, already CDT (-05:00) -> 14:00Z.
    expect(at.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("lands on the correct UTC instant across the US fall-back transition", () => {
    // Day before fall-back: 2026-10-31 20:00 CDT (-05:00) = 2026-11-01T01:00:00Z.
    const now = new Date("2026-10-31T20:00:00-05:00");
    const at = nextWindowStart({ dailyStartTime: "09:00", daysOfWeek: [], timezone: tz }, now);
    // Next 09:00 local is 2026-11-01, already CST (-06:00) -> 15:00Z.
    expect(at.toISOString()).toBe("2026-11-01T15:00:00.000Z");
  });

  it("skips a day off (Saturday) to the next allowed weekday (Monday)", () => {
    // 2026-09-19 is a Saturday, 10:00 America/Chicago (CDT, -05:00) = 15:00Z.
    const now = new Date("2026-09-19T15:00:00Z");
    const at = nextWindowStart({ dailyStartTime: "09:00", daysOfWeek: [1], timezone: tz }, now);
    // Next Monday is 2026-09-21, 09:00 CDT (-05:00) -> 14:00Z.
    expect(at.toISOString()).toBe("2026-09-21T14:00:00.000Z");
  });
});
