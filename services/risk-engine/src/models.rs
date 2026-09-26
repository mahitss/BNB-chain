//! Strict risk-request and decision models.
//!
//! Unavailable market/portfolio values are `Option`/null — the engine never
//! invents missing financial information. serde `deny_unknown_fields` rejects
//! malformed or overreaching requests.

use serde::{Deserialize, Serialize};

/// Spot-only actions. Derivatives, perpetuals, leverage, and borrowing are
/// not part of the vocabulary and therefore cannot be evaluated (or executed).
pub const KNOWN_ACTIONS: &[&str] = &[
    "BUY",
    "SELL",
    "REDUCE_POSITION",
    "REBALANCE",
    "OBSERVE",
    "ALERT",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RiskRequest {
    pub asset: String,
    pub action: String,
    pub requested_amount_usd: f64,
    /// Estimated execution price. Required for BUY/SELL/REDUCE/REBALANCE.
    #[serde(default)]
    pub estimated_price: Option<f64>,
    #[serde(default)]
    pub reference_price: Option<f64>,
    #[serde(default)]
    pub spread_percent: Option<f64>,
    #[serde(default)]
    pub estimated_slippage_percent: Option<f64>,
    #[serde(default)]
    pub market_state: Option<String>,
    /// "FRESH" | "AGING" | "STALE" | "UNKNOWN" as reported by market intelligence.
    #[serde(default)]
    pub reference_freshness: Option<String>,
    /// "SUFFICIENT" | "INSUFFICIENT" | "UNKNOWN".
    #[serde(default)]
    pub liquidity_status: Option<String>,
    #[serde(default)]
    pub current_position_usd: Option<f64>,
    /// Total already-proposed/executed trade volume today (USD).
    #[serde(default)]
    pub daily_traded_usd: Option<f64>,
    #[serde(default)]
    pub daily_volume_usd: Option<f64>,
    /// Reference price age in seconds, when known.
    #[serde(default)]
    pub reference_age_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuleOutcome {
    Passed,
    Failed,
    Review,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskRuleResult {
    pub rule: String,
    pub outcome: RuleOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Decision {
    Approved,
    Rejected,
    RequiresReview,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskDecision {
    pub decision: Decision,
    pub rules_evaluated: Vec<String>,
    pub rules_passed: Vec<String>,
    pub rules_failed: Vec<RiskRuleResult>,
    pub warnings: Vec<String>,
    pub requires_review: Vec<String>,
    pub timestamp: String,
}

impl RiskDecision {
    /// Aggregate rule results: any Failed → REJECTED; else any Review →
    /// REQUIRES_REVIEW; else APPROVED. Deterministic.
    pub fn aggregate(mut results: Vec<RiskRuleResult>, timestamp: String) -> RiskDecision {
        let rules_evaluated: Vec<String> = results.iter().map(|r| r.rule.clone()).collect();
        let mut rules_passed = Vec::new();
        let mut rules_failed = Vec::new();
        let mut warnings = Vec::new();
        let mut requires_review = Vec::new();
        for result in &results {
            match result.outcome {
                RuleOutcome::Passed => rules_passed.push(result.rule.clone()),
                RuleOutcome::Failed => rules_failed.push(result.clone()),
                RuleOutcome::Review => {
                    requires_review.push(result.rule.clone());
                    if let Some(reason) = &result.reason {
                        warnings.push(reason.clone());
                    }
                }
            }
            if let Some(warning) = &result.warning {
                warnings.push(warning.clone());
            }
        }
        // Keep the consumed results for failed details; passed names only.
        results.retain(|r| r.outcome != RuleOutcome::Passed);
        let decision = if results.iter().any(|r| r.outcome == RuleOutcome::Failed) {
            Decision::Rejected
        } else if !requires_review.is_empty() {
            Decision::RequiresReview
        } else {
            Decision::Approved
        };
        RiskDecision {
            decision,
            rules_evaluated,
            rules_passed,
            rules_failed,
            warnings,
            requires_review,
            timestamp,
        }
    }
}
