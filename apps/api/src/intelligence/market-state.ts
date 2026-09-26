/**
 * Market-state derivation — deterministic mapping of official Binance data
 * to OLYR MarketState values, with the US equity calendar as refinement.
 *
 * Primary source: the Binance `statusInfo` object (documented fields:
 * openState, marketStatus ∈ premarket|regular|postmarket|overnight|closed|pause,
 * reasonCode, reasonMsg, nextOpenTime, nextCloseTime). The calendar is used
 * ONLY to refine a Binance "closed" into WEEKEND vs HOLIDAY vs CLOSED and to
 * provide a fallback state when an asset has no statusInfo at all.
 */
import type { MarketState, RwaMarketStatusInfo } from "@olyr/types";
import { getUsEquityCalendarState } from "./us-equity-calendar.js";

export interface MarketStateResult {
  state: MarketState;
  /** Where the state came from. */
  source: "binance" | "derived-calendar";
  /** Raw Binance phase, when available. */
  binancePhase: string | null;
  reasonCode: string | null;
  reasonMsg: string | null;
  nextOpenTime: number | null;
  nextCloseTime: number | null;
  warnings: string[];
}

function mapPhase(phase: string): MarketState | null {
  switch (phase) {
    case "regular":
      return "OPEN";
    case "premarket":
      return "PRE_MARKET";
    case "postmarket":
    case "overnight":
      return "AFTER_HOURS";
    case "closed":
    case "pause":
      return "CLOSED"; // refined below (WEEKEND / HOLIDAY); pause preserved in reasonCode
    default:
      return null;
  }
}

/**
 * Derive the market state for one asset at instant `at`.
 * - statusInfo present → Binance phase mapped; "closed"/"pause" refined via
 *   the calendar (WEEKEND/HOLIDAY) while keeping the original reason codes.
 * - statusInfo missing/unknown → the calendar state with a warning.
 */
export function deriveMarketState(
  statusInfo: RwaMarketStatusInfo | null | undefined,
  at: Date,
): MarketStateResult {
  const warnings: string[] = [];
  if (!statusInfo) {
    warnings.push("market-state-from-calendar");
    return {
      state: getUsEquityCalendarState(at),
      source: "derived-calendar",
      binancePhase: null,
      reasonCode: null,
      reasonMsg: null,
      nextOpenTime: null,
      nextCloseTime: null,
      warnings,
    };
  }
  const mapped = mapPhase(statusInfo.marketStatus);
  if (mapped === null) {
    warnings.push("unknown-binance-market-phase");
    return {
      state: "UNKNOWN",
      source: "binance",
      binancePhase: statusInfo.marketStatus,
      reasonCode: statusInfo.reasonCode,
      reasonMsg: statusInfo.reasonMsg,
      nextOpenTime: statusInfo.nextOpenTime,
      nextCloseTime: statusInfo.nextCloseTime,
      warnings,
    };
  }
  let state = mapped;
  // Refine CLOSED using the calendar: weekend, published holiday, or plain closed.
  if (mapped === "CLOSED" && statusInfo.openState === false) {
    const calendar = getUsEquityCalendarState(at);
    if (calendar === "WEEKEND" || calendar === "HOLIDAY") {
      state = calendar;
    }
  }
  return {
    state,
    source: "binance",
    binancePhase: statusInfo.marketStatus,
    reasonCode: statusInfo.reasonCode,
    reasonMsg: statusInfo.reasonMsg,
    nextOpenTime: statusInfo.nextOpenTime,
    nextCloseTime: statusInfo.nextCloseTime,
    warnings,
  };
}
