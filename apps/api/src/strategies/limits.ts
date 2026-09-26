/**
 * Platform strategy limits from environment (see .env.example).
 * Enforced by BOTH the Python agent pipeline and this TypeScript-side
 * persistence guard. The LLM can never override them.
 */

export interface StrategyLimits {
  maxStrategyTradeUsd: number;
  maxStrategyDailyUsd: number;
  maxSpreadThresholdPercent: number;
  allowedActions: string[];
  allowedAssets: string[];
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${key} must be a number, got ${String(raw)}`);
  }
  return value;
}

function envList(key: string): string[] {
  return (process.env[key] ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);
}

export function loadStrategyLimits(): StrategyLimits {
  return {
    maxStrategyTradeUsd: envNumber("OLYR_MAX_STRATEGY_TRADE_USD", 25),
    maxStrategyDailyUsd: envNumber("OLYR_MAX_STRATEGY_DAILY_USD", 100),
    maxSpreadThresholdPercent: envNumber("OLYR_MAX_SPREAD_THRESHOLD", 10),
    allowedActions: envList("OLYR_ALLOWED_ACTIONS"),
    allowedAssets: envList("OLYR_ALLOWED_ASSETS"),
  };
}
