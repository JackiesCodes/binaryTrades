/**
 * A bot's trading hours: when it may open new trades. Outside them it still manages and closes the
 * trades it has. Times are in the user's own time zone, so "08:00–20:00" means what they see on
 * their clock (summer time included).
 */

export interface TradingHours {
  /** Hour of day it may start opening trades (0–23). */
  from: number;
  /** Hour of day it stops (0–24). Earlier than `from` runs past midnight (22 → 6). Equal to `from` means all day. */
  to: number;
  /** Days it may trade, 0 = Sunday … 6 = Saturday (the day at that moment, in `tz`). */
  days: number[];
  /** IANA time zone, e.g. "Africa/Johannesburg". */
  tz: string;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Local weekday (0 = Sunday) and hour + minutes as a fraction, at `at` in `tz` (UTC if the zone is unknown). */
export function localClock(at: Date, tz: string): { day: number; hour: number } {
  const parts = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  let p: Intl.DateTimeFormatPart[];
  try {
    p = parts(tz);
  } catch {
    p = parts("UTC");
  }
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { day: WEEKDAYS.indexOf(get("weekday") as (typeof WEEKDAYS)[number]), hour: Number(get("hour")) + Number(get("minute")) / 60 };
}

/** Whether a bot with these hours may open a trade now. No hours set: always. */
export function inTradingHours(hours: TradingHours | null | undefined, at = new Date()): boolean {
  if (!hours) return true;
  const { day, hour } = localClock(at, hours.tz);
  if (!hours.days.includes(day)) return false;
  if (hours.from === hours.to) return true;
  return hours.from < hours.to ? hour >= hours.from && hour < hours.to : hour >= hours.from || hour < hours.to;
}

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** "Mon–Fri 08:00–20:00", "every day 22:00–06:00", "Mon, Wed all day". */
export function hoursLabel(hours: TradingHours): string {
  const d = [...hours.days].sort();
  const run = d.length > 1 && d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const days = d.length === 7 ? "every day" : run ? `${WEEKDAYS[d[0]!]}–${WEEKDAYS[d.at(-1)!]}` : d.map((x) => WEEKDAYS[x]).join(", ");
  return `${days} ${hours.from === hours.to ? "all day" : `${hh(hours.from)}–${hh(hours.to)}`}`;
}

/** Repaired hours from untrusted input, or null when unusable. */
export function sanitizeHours(value: unknown): TradingHours | null {
  const v = value as Partial<TradingHours> | null;
  if (!v || typeof v !== "object") return null;
  const from = Number(v.from);
  const to = Number(v.to);
  if (!Number.isInteger(from) || from < 0 || from > 23 || !Number.isInteger(to) || to < 0 || to > 24) return null;
  const days = [...new Set((Array.isArray(v.days) ? v.days : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  if (!days.length || typeof v.tz !== "string" || v.tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v.tz });
  } catch {
    return null;
  }
  return { from, to: to === 24 ? 0 : to, days, tz: v.tz };
}
