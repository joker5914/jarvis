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

const DAY_MS = 86_400_000;

/**
 * The next real-time moment the daily/weekly window opens: `dailyStartTime` (or 00:00 if
 * unset) on the next day allowed by `daysOfWeek` (any day if empty), computed in the
 * schedule's timezone. Used for `nextPlanned.at` on a `day_off`/`outside_daily` tick so the UI
 * shows a real future time rather than a stale `windowStart` from the past.
 *
 * Walks up to 7 days ahead (today plus a full week) so it terminates even when only today's
 * weekday is allowed and today's start time has already passed — that case wraps to the same
 * weekday next week. Today only counts if the target time hasn't passed yet; every later day
 * in the walk counts as soon as its weekday is allowed, since the whole day is still ahead.
 */
export function nextWindowStart(s: Pick<WindowInput, "dailyStartTime" | "daysOfWeek" | "timezone">, now: Date): Date {
  const tz = s.timezone || "UTC";
  const { weekday: todayWeekday, minutes: currentMinutes } = localParts(now, tz);
  const targetMinutes = s.dailyStartTime ? (toMinutes(s.dailyStartTime) ?? 0) : 0;
  // The start of "today" in local time, expressed as an absolute instant. Adding whole days
  // and a target minute-of-day to this anchor lands on that local wall-clock time (modulo a
  // DST shift landing exactly inside the walked span, which this schedule's tests don't hit).
  const localMidnight = now.getTime() - currentMinutes * 60_000;
  for (let d = 0; d <= 7; d++) {
    const weekday = (todayWeekday + d) % 7;
    if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(weekday)) continue;
    if (d === 0 && targetMinutes <= currentMinutes) continue; // today's start time already passed
    return new Date(localMidnight + d * DAY_MS + targetMinutes * 60_000);
  }
  // Unreachable: `daysOfWeek` empty always matches by d=1, and a non-empty list always
  // recurs by d=7. Kept as a defensive fallback rather than a non-null assertion.
  return new Date(localMidnight + DAY_MS + targetMinutes * 60_000);
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
