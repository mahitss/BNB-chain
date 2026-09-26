/**
 * US equity calendar tests — fixed UTC instants mapped to New York time.
 * Reference: 2026-09-29 is a Tuesday; DST active in September (UTC-4),
 * inactive in December (UTC-5).
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  getUsEquityCalendarState,
  isNyseHoliday,
  newYorkParts,
} from "../../src/intelligence/us-equity-calendar.js";

describe("US equity calendar (deterministic, timezone-aware)", () => {
  it("reports OPEN during a regular Tuesday session", () => {
    // 2026-09-29 14:30 UTC = 10:30 EDT (regular session)
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T14:30:00Z")), "OPEN");
  });

  it("reports OPEN at the 09:30 open boundary", () => {
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T13:30:00Z")), "OPEN");
  });

  it("reports CLOSED early morning on a trading day", () => {
    // 03:00 New York = 07:00 UTC (DST) — before pre-market start is CLOSED.
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T07:00:00Z")), "CLOSED");
  });

  it("reports PRE_MARKET during documented extended hours", () => {
    // 2026-09-29 12:00 UTC = 08:00 EDT (pre-market window)
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T12:00:00Z")), "PRE_MARKET");
  });

  it("reports AFTER_HOURS after the close", () => {
    // 2026-09-29 21:00 UTC = 17:00 EDT (after-hours window)
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T21:00:00Z")), "AFTER_HOURS");
  });

  it("reports WEEKEND all day Saturday and Sunday in New York", () => {
    // 2026-10-03 is a Saturday: 02:00 UTC = Fri 22:00 NY (still Fri date!) —
    // the NY date is Friday evening, so not yet WEEKEND; 15:00 UTC = Sat 11:00.
    assert.equal(getUsEquityCalendarState(new Date("2026-10-03T15:00:00Z")), "WEEKEND");
    assert.equal(getUsEquityCalendarState(new Date("2026-10-04T20:00:00Z")), "WEEKEND");
  });

  it("reports HOLIDAY on published NYSE holidays", () => {
    // 2026-12-25 is a Friday, Christmas, market closed all day.
    assert.equal(getUsEquityCalendarState(new Date("2026-12-25T15:00:00Z")), "HOLIDAY");
    assert.ok(isNyseHoliday(new Date("2026-12-25T15:00:00Z")));
  });

  it("reports HOLIDAY for observed days (July 4 2026 → observed Friday Jul 3)", () => {
    assert.ok(isNyseHoliday(new Date("2026-07-03T15:00:00Z")));
    assert.equal(getUsEquityCalendarState(new Date("2026-07-03T15:00:00Z")), "HOLIDAY");
  });

  it("converts UTC instants to New York wall time correctly across DST", () => {
    // September (EDT, UTC-4): 12:00Z → 08:00 local.
    const september = newYorkParts(new Date("2026-09-29T12:00:00Z"));
    assert.equal(september.minutesSinceMidnight, 8 * 60);
    // December (EST, UTC-5): 12:00Z → 07:00 local.
    const december = newYorkParts(new Date("2026-12-29T12:00:00Z"));
    assert.equal(december.minutesSinceMidnight, 7 * 60);
    // Weekday mapping: 2026-09-29 is a Tuesday.
    assert.equal(september.weekday, 2);
  });

  it("treats the pre-open/pre-market boundary correctly (04:00 NY)", () => {
    // 2026-09-29 08:00 UTC = 04:00 EDT → PRE_MARKET starts (boundary).
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T08:00:00Z")), "PRE_MARKET");
    // 07:59 NY-pre-market minus 1 minute → CLOSED.
    assert.equal(getUsEquityCalendarState(new Date("2026-09-29T07:59:00Z")), "CLOSED");
  });

  it("reports AFTER_HOURS end boundary (20:00 NY → CLOSED)", () => {
    assert.equal(getUsEquityCalendarState(new Date("2026-09-30T00:00:00Z")), "CLOSED");
  });
});
