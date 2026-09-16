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

/** Calendar date (`{ y, m, d }`, 1-indexed month) in the given IANA timezone. */
function localDateParts(now: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Converts a local wall-clock date/time in `tz` to the UTC instant it represents, correcting
 * for `tz`'s offset with a two-pass lookup: the first pass guesses the instant assuming UTC
 * equals local time, reads that guess's actual offset, and corrects for it; the second pass
 * repeats the correction using the first pass's result, which lands exactly for any offset
 * (including one that changed between the two guesses, e.g. a guess landing on the far side of
 * a DST transition from the true answer). `(y, m, d)` may be out of the normal calendar range
 * (e.g. `d` past the end of `m`) — `Date.UTC` normalizes that the same way a plain "+N days"
 * walk would, so callers can pass `d + dayOffset` directly.
 */
export function utcForLocal(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(
      new Date(t),
    );
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

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
 *
 * Walks by local *calendar date* (year/month/day), not by adding 24h multiples: a fixed-24h
 * walk drifts by an hour across a DST transition (e.g. lands at 08:00 or 10:00 local instead of
 * 09:00). Each candidate day's local date/time is converted to its UTC instant individually via
 * `utcForLocal`, so the result is always the correct wall-clock time in `tz` regardless of any
 * DST shift between `now` and that day.
 */
export function nextWindowStart(s: Pick<WindowInput, "dailyStartTime" | "daysOfWeek" | "timezone">, now: Date): Date {
  const tz = s.timezone || "UTC";
  const { weekday: todayWeekday, minutes: currentMinutes } = localParts(now, tz);
  const { y, m, d } = localDateParts(now, tz);
  const targetMinutes = s.dailyStartTime ? (toMinutes(s.dailyStartTime) ?? 0) : 0;
  const hh = Math.floor(targetMinutes / 60);
  const mm = targetMinutes % 60;
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const weekday = (todayWeekday + dayOffset) % 7;
    if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(weekday)) continue;
    if (dayOffset === 0 && targetMinutes <= currentMinutes) continue; // today's start time already passed
    return utcForLocal(y, m, d + dayOffset, hh, mm, tz);
  }
  // Unreachable: `daysOfWeek` empty always matches by d=1, and a non-empty list always
  // recurs by d=7. Kept as a defensive fallback rather than a non-null assertion.
  return utcForLocal(y, m, d + 1, hh, mm, tz);
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
