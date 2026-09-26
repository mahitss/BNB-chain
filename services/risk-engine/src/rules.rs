//! Deterministic risk rules. Each rule is an independently testable component
//! implementing the `RiskRule` trait: `evaluate(&self, ctx) -> RuleResult`.
//! Rules never call the network and never mutate state.

use crate::config::RiskConfig;
use crate::models::{RiskRequest, RuleOutcome};

pub trait RiskRule: Send + Sync {
    fn name(&self) -> &'static str;
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult;
}

pub struct RuleResult {
    pub outcome: RuleOutcome,
    pub reason: Option<String>,
    pub warning: Option<String>,
}

impl RuleResult {
    pub fn pass() -> RuleResult {
        RuleResult {
            outcome: RuleOutcome::Passed,
            reason: None,
            warning: None,
        }
    }
    pub fn fail(reason: String) -> RuleResult {
        RuleResult {
            outcome: RuleOutcome::Failed,
            reason: Some(reason),
            warning: None,
        }
    }
    pub fn review(reason: String) -> RuleResult {
        RuleResult {
            outcome: RuleOutcome::Review,
            reason: Some(reason),
            warning: None,
        }
    }
    pub fn pass_with_warning(warning: String) -> RuleResult {
        RuleResult {
            outcome: RuleOutcome::Passed,
            reason: None,
            warning: Some(warning),
        }
    }
}

fn fmt_usd(amount: f64) -> String {
    format!("${amount:.2}")
}

/// A: Maximum trade size.
pub struct MaxTradeSize;

impl RiskRule for MaxTradeSize {
    fn name(&self) -> &'static str {
        "MAX_TRADE_SIZE"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        if request.requested_amount_usd > config.max_trade_usd {
            RuleResult::fail(format!(
                "Requested {} exceeds configured {} maximum.",
                fmt_usd(request.requested_amount_usd),
                fmt_usd(config.max_trade_usd)
            ))
        } else {
            RuleResult::pass()
        }
    }
}

/// B: Maximum daily exposure (already-traded/proposed today + this request).
pub struct MaxDailyExposure;

impl RiskRule for MaxDailyExposure {
    fn name(&self) -> &'static str {
        "DAILY_EXPOSURE"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        let used = request.daily_traded_usd.unwrap_or(0.0);
        if used + request.requested_amount_usd > config.max_daily_trade_usd {
            RuleResult::fail(format!(
                "Daily exposure {} + requested {} would exceed the configured {} daily maximum.",
                fmt_usd(used),
                fmt_usd(request.requested_amount_usd),
                fmt_usd(config.max_daily_trade_usd)
            ))
        } else {
            RuleResult::pass()
        }
    }
}

/// D: Allowed assets (empty allowlist = any well-formed asset).
pub struct AllowedAsset;

impl RiskRule for AllowedAsset {
    fn name(&self) -> &'static str {
        "ALLOWED_ASSET"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        if config.allowed_assets.is_empty()
            || config
                .allowed_assets
                .iter()
                .any(|a| a.eq_ignore_ascii_case(&request.asset))
        {
            RuleResult::pass()
        } else {
            RuleResult::fail(format!(
                "Asset {} is outside the configured allowed universe.",
                request.asset
            ))
        }
    }
}

/// E: Allowed actions — the engine's vocabulary is spot-only by construction.
pub struct AllowedAction;

impl RiskRule for AllowedAction {
    fn name(&self) -> &'static str {
        "ALLOWED_ACTION"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        // Empty configured list = the default spot action set (same as from_env).
        let allowed = if config.allowed_actions.is_empty() {
            crate::config::DEFAULT_ALLOWED_ACTIONS
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<String>>()
        } else {
            config.allowed_actions.clone()
        };
        if allowed
            .iter()
            .any(|a| a.eq_ignore_ascii_case(&request.action))
        {
            RuleResult::pass()
        } else {
            RuleResult::fail(format!(
                "Action {} is not an allowed spot action. Derivatives, leverage, and borrowing are not supported.",
                request.action
            ))
        }
    }
}

/// C: Maximum slippage. Missing estimate → pass with a warning (never invented).
pub struct MaxSlippage;

impl RiskRule for MaxSlippage {
    fn name(&self) -> &'static str {
        "MAX_SLIPPAGE"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        match request.estimated_slippage_percent {
            None => RuleResult::pass_with_warning(
                "Estimated slippage is unavailable; it has not been validated.".to_string(),
            ),
            Some(slippage) if !slippage.is_finite() || slippage < 0.0 => RuleResult::fail(
                "Estimated slippage is not a valid non-negative number.".to_string(),
            ),
            Some(slippage) if slippage > config.max_slippage_percent => RuleResult::fail(format!(
                "Estimated slippage {slippage}% exceeds the configured {}% maximum.",
                config.max_slippage_percent
            )),
            Some(_) => RuleResult::pass(),
        }
    }
}

/// F: Market-data freshness — required price/reference data must not be stale.
///     STALE-but-within-limit → REQUIRES_REVIEW; missing → REQUIRES_REVIEW.
pub struct MarketDataFreshness;

impl RiskRule for MarketDataFreshness {
    fn name(&self) -> &'static str {
        "MARKET_DATA_FRESHNESS"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        let age = request.reference_age_seconds;
        let freshness = request.reference_freshness.as_deref();
        match (age, freshness) {
            (Some(age), _) if !age.is_finite() || age < 0.0 => {
                RuleResult::fail("Reference age is not a valid non-negative number.".to_string())
            }
            (Some(age), _) if age > config.max_reference_age_seconds => RuleResult::fail(format!(
                "Reference price is {age}s old, beyond the configured {}s maximum.",
                config.max_reference_age_seconds
            )),
            (_, Some("STALE")) => RuleResult::review(
                "Reference price is flagged STALE by market intelligence.".to_string(),
            ),
            (_, Some("UNKNOWN")) => {
                RuleResult::review("Reference price freshness is unknown.".to_string())
            }
            (_, None) => {
                RuleResult::review("Reference price freshness was not provided.".to_string())
            }
            _ => RuleResult::pass(),
        }
    }
}

/// G: Liquidity — unknown liquidity is never assumed safe (REQUIRES_REVIEW
/// unless policy explicitly allows proceeding without liquidity data).
pub struct Liquidity;

impl RiskRule for Liquidity {
    fn name(&self) -> &'static str {
        "LIQUIDITY"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        match request.liquidity_status.as_deref() {
            Some("SUFFICIENT") => RuleResult::pass(),
            Some("INSUFFICIENT") => {
                RuleResult::fail("On-chain liquidity is insufficient for the proposal.".to_string())
            }
            Some("UNKNOWN") | None => {
                if config.require_liquidity_data {
                    RuleResult::review(
                        "Execution liquidity has not been validated; policy requires review."
                            .to_string(),
                    )
                } else {
                    RuleResult::pass_with_warning(
                        "Liquidity data is unavailable; policy allows proceeding without it."
                            .to_string(),
                    )
                }
            }
            Some(other) => RuleResult::fail(format!("Unknown liquidity status {other:?}.")),
        }
    }
}

/// H: Position limits. BUY cannot push exposure past the cap; reductions
/// cannot exceed the held position. Unknown position → REQUIRES_REVIEW.
pub struct PositionLimit;

impl RiskRule for PositionLimit {
    fn name(&self) -> &'static str {
        "POSITION_LIMIT"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        let action = request.action.to_uppercase();
        let is_buy = matches!(action.as_str(), "BUY" | "REBALANCE");
        match request.current_position_usd {
            None => RuleResult::review(
                "Current position is unknown; the position limit cannot be evaluated.".to_string(),
            ),
            Some(position) if !position.is_finite() || position < 0.0 => {
                RuleResult::fail("Current position is not a valid non-negative number.".to_string())
            }
            Some(position) => {
                if is_buy {
                    if position + request.requested_amount_usd > config.max_position_usd {
                        RuleResult::fail(format!(
                            "Proposed BUY would push exposure to {} beyond the configured {} position maximum.",
                            fmt_usd(position + request.requested_amount_usd),
                            fmt_usd(config.max_position_usd)
                        ))
                    } else {
                        RuleResult::pass()
                    }
                } else if request.requested_amount_usd > position {
                    RuleResult::fail(format!(
                        "Requested reduction {} exceeds the held position {}.",
                        fmt_usd(request.requested_amount_usd),
                        fmt_usd(position)
                    ))
                } else {
                    RuleResult::pass()
                }
            }
        }
    }
}

/// I: Price sanity — zero/negative/non-finite/missing prices are rejected.
pub struct PriceSanity;

impl RiskRule for PriceSanity {
    fn name(&self) -> &'static str {
        "PRICE_SANITY"
    }
    fn evaluate(&self, request: &RiskRequest, config: &RiskConfig) -> RuleResult {
        let _ = config;
        let action = request.action.to_uppercase();
        let price_required = matches!(
            action.as_str(),
            "BUY" | "SELL" | "REDUCE_POSITION" | "REBALANCE"
        );
        for (label, price) in [
            ("estimatedPrice", request.estimated_price),
            ("referencePrice", request.reference_price),
        ] {
            match price {
                None if price_required => {
                    return RuleResult::fail(format!(
                        "{label} is required for this action but was missing."
                    ))
                }
                None => return RuleResult::pass_with_warning(format!("{label} was not provided.")),
                Some(value) if !value.is_finite() => {
                    return RuleResult::fail(format!("{label} is not a finite number."))
                }
                Some(value) if value <= 0.0 => {
                    return RuleResult::fail(format!("{label} must be positive, got {value}."))
                }
                Some(_) => {}
            }
        }
        RuleResult::pass()
    }
}

/// J: Spread sanity — a malformed spread must never look like an opportunity.
pub struct SpreadSanity;

impl RiskRule for SpreadSanity {
    fn name(&self) -> &'static str {
        "SPREAD_SANITY"
    }
    fn evaluate(&self, request: &RiskRequest, _config: &RiskConfig) -> RuleResult {
        match request.spread_percent {
            None => RuleResult::pass_with_warning("Spread percent was not provided.".to_string()),
            Some(spread) if !spread.is_finite() => {
                RuleResult::fail("Spread percent is not a finite number.".to_string())
            }
            Some(spread) if spread < -100.0 || spread > 100.0 => RuleResult::fail(format!(
                "Spread percent {spread} is outside the plausible range [-100, 100]."
            )),
            Some(_) => RuleResult::pass(),
        }
    }
}

/// The full rule set, evaluated in documented order.
pub fn all_rules() -> Vec<Box<dyn RiskRule>> {
    vec![
        Box::new(PriceSanity),
        Box::new(SpreadSanity),
        Box::new(MaxTradeSize),
        Box::new(MaxDailyExposure),
        Box::new(AllowedAsset),
        Box::new(AllowedAction),
        Box::new(MaxSlippage),
        Box::new(MarketDataFreshness),
        Box::new(Liquidity),
        Box::new(PositionLimit),
    ]
}
