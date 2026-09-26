//! Risk engine — evaluates every rule against a request and aggregates the
//! results into one deterministic decision. Pure functions; no I/O.

use crate::config::RiskConfig;
use crate::models::{RiskDecision, RiskRequest, RiskRuleResult};
use crate::rules;

pub struct RiskEngine {
    pub rules: Vec<Box<dyn rules::RiskRule>>,
    pub config: RiskConfig,
}

impl RiskEngine {
    pub fn new(config: RiskConfig) -> RiskEngine {
        RiskEngine {
            rules: rules::all_rules(),
            config,
        }
    }

    /// Runs all rules in documented order and aggregates deterministically.
    pub fn evaluate(&self, request: &RiskRequest, timestamp: String) -> RiskDecision {
        let results: Vec<RiskRuleResult> = self
            .rules
            .iter()
            .map(|rule| {
                let outcome = rule.evaluate(request, &self.config);
                RiskRuleResult {
                    rule: rule.name().to_string(),
                    outcome: outcome.outcome,
                    reason: outcome.reason,
                    warning: outcome.warning,
                }
            })
            .collect();
        RiskDecision::aggregate(results, timestamp)
    }
}
