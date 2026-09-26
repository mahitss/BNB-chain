/**
 * US equity market calendar — the ONLY place wall-clock market-hours logic
 * lives, isolated per the Phase 3 spec because the Binance RWA API reports
 * per-asset status but OLYR also needs an overall "US equities" banner state.
 *
 * Rules implemented (documented sources):
 * - Regular session: 09:30–16:00 America/New_York, Monday–Friday.
 * - Weekends (Sat/Sun in New York) → WEEKEND.
 * - NYSE published holiday calendar → HOLIDAY. The list below covers
 *   2025–2027 and includes New Year's Day, MLK Day, Presidents' Day,
 *   Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day,
 *   Thanksgiving, and Christmas (with the documented observed-day shifts
 *   when a holiday falls on a weekend). Update `HOLIDAYS` as years roll over.
 * - Sessions before 09:30 / after 16:00 on a trading day are reported as
 *   CLOSED here; whether they are "pre-market" or "after hours" is refined
 *   by the caller (see market-state.ts) using extended-hours boundaries.
 *
 * Timezone handling: all conversions use Intl.DateTimeFormat with an explicit
 * IANA time zone — the machine's local timezone is never consulted.
 */
import type { MarketState } from "@olyr/types";

export const US_EQUITY_TIMEZONE = "America/New_York";

/** Regular session boundaries in New York local wall time. */
export const REGULAR_OPEN = { hour: 9, minute: 30 };
export const REGULAR_CLOSE = { hour: 16, minute: 0 };

/** Extended-hours boundaries used to label CLOSED sessions (documented rule). */
export const PRE_MARKET_START = { hour: 4, minute: 0 };
export const AFTER_HOURS_END = { hour: 20, minute: 0 };

/**
 * NYSE holidays (YYYY-MM-DD in America/New_York). Sources: nyse.com
 * "2025/2026/2027 NYSE Group Holidays and Observed Days". Good Friday dates
 * are from the same published calendars.
 */
export const NYSE_HOLIDAYS: readonly string[] = [
  // 2025
  "2025-01-01",
  "2025-01-09", // Jan 9 = National Day of Mourning (Jimmy Carter)
  "2025-01-20",
  "2025-02-17",
  "2025-04-18",
  "2025-05-26",
  "2025-06-19",
  "2025-07-04",
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  // 2026
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03", // Jul 4 falls on Saturday → observed Friday Jul 3
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18", // Jun 19 falls on Saturday → observed Friday Jun 18
  "2027-07-05", // Jul 4 falls on Sunday → observed Monday Jul 5
  "2027-09-06",
  "2027-11-25",
  "2027-12-24", // Dec 25 falls on Saturday → observed Friday Dec 24
];

/** New York local wall-clock parts for a UTC instant, via Intl (no Date UTC drift). */
export function newYorkParts(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0=Sunday … 6=Saturday
  minutesSinceMidnight: number;
  dateKey: string; // YYYY-MM-DD
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: US_EQUITY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts["hour"] === "24" ? "0" : parts["hour"]);
  const minute = Number(parts["minute"]);
  const weekdayKey = parts["weekday"] ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayKey);
  const dateKey = `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    weekday,
    minutesSinceMidnight: hour * 60 + minute,
    dateKey,
  };
}

function minutesOf(t: { hour: number; minute: number }): number {
  return t.hour * 60 + t.minute;
}

/** True when the given instant falls on a published NYSE holiday. */
export function isNyseHoliday(at: Date): boolean {
  return NYSE_HOLIDAYS.includes(newYorkParts(at).dateKey);
}

/**
 * US equity market state from pure calendar rules at an instant.
 * PRE_MARKET / AFTER_HOURS label trading-day sessions outside the regular
 * window (documented extended-hours boundaries); weekends/holidays are
 * WEEKEND/HOLIDAY for the whole day.
 */
export function getUsEquityCalendarState(at: Date): MarketState {
  const parts = newYorkParts(at);
  if (parts.weekday === 0 || parts.weekday === 6) {
    return "WEEKEND";
  }
  if (NYSE_HOLIDAYS.includes(parts.dateKey)) {
    return "HOLIDAY";
  }
  const now = parts.minutesSinceMidnight;
  if (now >= minutesOf(REGULAR_OPEN) && now < minutesOf(REGULAR_CLOSE)) {
    return "OPEN";
  }
  if (now >= minutesOf(PRE_MARKET_START) && now < minutesOf(REGULAR_OPEN)) {
    return "PRE_MARKET";
  }
  if (now >= minutesOf(REGULAR_CLOSE) && now < minutesOf(AFTER_HOURS_END)) {
    return "AFTER_HOURS";
  }
  return "CLOSED";
}
