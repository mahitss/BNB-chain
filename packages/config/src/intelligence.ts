/**
 * Market-intelligence configuration (Phase 3). All thresholds come from the
 * environment; nothing business-critical is hardcoded across the codebase.
 */
import { EnvError, envInt } from "./index.js";

export interface IntelligenceConfig {
  /** |spread| percent ≥ this (and < opportunity threshold) → WATCH. */
  spreadWatchPercent: number;
  /** |spread| percent ≥ this → candidate for OPPORTUNITY (gates apply). */
  spreadOpportunityPercent: number;
  /** Reference/on-chain price age ≤ this → FRESH. */
  referenceFreshSeconds: number;
  /** Age ≤ this → AGING; above → STALE. */
  referenceAgingSeconds: number;
  /** Age beyond this is unusable for signals → BLOCKED/WATCH downgrades. */
  referenceStaleSeconds: number;
  /** Minimum documented on-chain liquidity (USD) for OPPORTUNITY status. */
  minLiquidityUsd: number;
  scan: {
    /** Master switch; scanner runs only when Binance is configured too. */
    enabled: boolean;
    /** Polling interval in seconds (bounded, never an uncontrolled loop). */
    intervalSeconds: number;
    /** Maximum assets evaluated per scan (protects the per-endpoint RPS limit). */
    maxAssets: number;
    /** Optional comma-separated ticker filter; empty = all assets on chain. */
    assetsFilter: string[];
  };
}

export function loadIntelligenceConfig(): IntelligenceConfig {
  const watch = envInt("OLYR_SPREAD_WATCH_THRESHOLD", 50); // basis points
  const opportunity = envInt("OLYR_SPREAD_OPPORTUNITY_THRESHOLD", 150); // basis points
  if (opportunity < watch) {
    throw new EnvError("OLYR_SPREAD_OPPORTUNITY_THRESHOLD must be ≥ OLYR_SPREAD_WATCH_THRESHOLD");
  }
  return {
    // Thresholds are configured in basis points to stay integer-safe.
    spreadWatchPercent: watch / 100,
    spreadOpportunityPercent: opportunity / 100,
    referenceFreshSeconds: envInt("OLYR_REFERENCE_FRESH_SECONDS", 60),
    referenceAgingSeconds: envInt("OLYR_REFERENCE_AGING_SECONDS", 900),
    referenceStaleSeconds: envInt("OLYR_REFERENCE_STALE_SECONDS", 3600),
    minLiquidityUsd: envInt("OLYR_MIN_LIQUIDITY", 0),
    scan: {
      enabled: process.env["OLYR_SCAN_ENABLED"] !== "false",
      intervalSeconds: envInt("OLYR_SCAN_INTERVAL_SECONDS", 60),
      maxAssets: envInt("OLYR_SCAN_MAX_ASSETS", 10),
      assetsFilter: (process.env["OLYR_SCAN_ASSETS"] ?? "")
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0),
    },
  };
}
