/**
 * Price freshness evaluation — deterministic age bucketing with configurable
 * thresholds. Missing timestamps yield UNKNOWN (never invented).
 */
import type { FreshnessEvaluation, ReferenceFreshness } from "@olyr/types";

export interface FreshnessThresholds {
  freshSeconds: number;
  agingSeconds: number;
  staleSeconds: number;
}

export function evaluateFreshness(
  timestampIso: string | null | undefined,
  now: Date,
  thresholds: FreshnessThresholds,
): FreshnessEvaluation {
  if (!timestampIso) {
    return {
      category: "UNKNOWN",
      ageSeconds: null,
      beyondStalenessLimit: false,
      warningCode: "timestamp-missing",
    };
  }
  const timestampMs = Date.parse(timestampIso);
  if (Number.isNaN(timestampMs)) {
    return {
      category: "UNKNOWN",
      ageSeconds: null,
      beyondStalenessLimit: false,
      warningCode: "timestamp-missing",
    };
  }
  const ageSeconds = Math.max(0, Math.round((now.getTime() - timestampMs) / 1000));
  let category: ReferenceFreshness;
  if (ageSeconds <= thresholds.freshSeconds) {
    category = "FRESH";
  } else if (ageSeconds <= thresholds.agingSeconds) {
    category = "AGING";
  } else {
    category = "STALE";
  }
  const beyondStalenessLimit = ageSeconds > thresholds.staleSeconds;
  return {
    category,
    ageSeconds,
    beyondStalenessLimit,
    warningCode: beyondStalenessLimit ? "beyond-staleness-limit" : null,
  };
}
