export type WindowInput = {
  enabled: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  daysOfWeek: number[];
  timezone: string;
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0 = Sunday) and minutes since local midnight in the given IANA timezone. */
export function localParts(now: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: WEEKDAYS[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isWithinWindow(
  s: WindowInput,
  now: Date = new Date(),
): { ok: boolean; reason?: "disabled" | "before_start" | "after_end" | "day_off" | "outside_daily" } {
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (s.windowStart && now < s.windowStart) return { ok: false, reason: "before_start" };
  if (s.windowEnd && now > s.windowEnd) return { ok: false, reason: "after_end" };
  const { weekday, minutes } = localParts(now, s.timezone || "UTC");
  if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(weekday)) return { ok: false, reason: "day_off" };
  const start = s.dailyStartTime ? toMinutes(s.dailyStartTime) : null;
  const end = s.dailyEndTime ? toMinutes(s.dailyEndTime) : null;
  if (start != null && end != null) {
    const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    if (!inside) return { ok: false, reason: "outside_daily" };
  } else if (start != null && minutes < start) {
    return { ok: false, reason: "outside_daily" };
  } else if (end != null && minutes >= end) {
    return { ok: false, reason: "outside_daily" };
  }
  return { ok: true };
}
