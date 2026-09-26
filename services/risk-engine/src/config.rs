//! Risk-engine configuration from environment variables.
//!
//! Every limit has a SAFE default (never unlimited). These are the platform's
//! hard financial constraints — the risk engine is their only enforcer and is
//! itself fully deterministic (no LLM anywhere).

use std::env;

#[derive(Debug, Clone)]
pub struct RiskConfig {
    /// OLYR_MAX_TRADE_USD — hard cap per proposed trade (USD).
    pub max_trade_usd: f64,
    /// OLYR_MAX_DAILY_TRADE_USD — hard cap on total proposed trades per day (USD).
    pub max_daily_trade_usd: f64,
    /// OLYR_MAX_POSITION_USD — hard cap on total exposure per asset (USD).
    pub max_position_usd: f64,
    /// OLYR_MAX_SLIPPAGE_PERCENT — maximum acceptable estimated slippage (%).
    pub max_slippage_percent: f64,
    /// OLYR_MAX_REFERENCE_AGE_SECONDS — reference price older than this fails.
    pub max_reference_age_seconds: f64,
    /// OLYR_REQUIRE_LIQUIDITY_DATA — when true, unknown liquidity → REQUIRES_REVIEW.
    pub require_liquidity_data: bool,
    /// OLYR_ALLOWED_ASSETS — comma-separated; empty = any well-formed asset.
    pub allowed_assets: Vec<String>,
    /// OLYR_ALLOWED_ACTIONS — spot actions only; empty = the default spot set.
    pub allowed_actions: Vec<String>,
}

/// The default spot action set. Derivatives/perpetuals/leverage/borrowing do
/// not exist in this engine — they are not in the vocabulary at all.
pub const DEFAULT_ALLOWED_ACTIONS: &[&str] = &["BUY", "SELL", "REDUCE_POSITION", "REBALANCE"];

impl RiskConfig {
    pub fn from_env() -> RiskConfig {
        RiskConfig {
            max_trade_usd: env_f64("OLYR_MAX_TRADE_USD", 25.0),
            max_daily_trade_usd: env_f64("OLYR_MAX_DAILY_TRADE_USD", 100.0),
            max_position_usd: env_f64("OLYR_MAX_POSITION_USD", 500.0),
            max_slippage_percent: env_f64("OLYR_MAX_SLIPPAGE_PERCENT", 1.0),
            max_reference_age_seconds: env_f64("OLYR_MAX_REFERENCE_AGE_SECONDS", 3600.0),
            require_liquidity_data: env_bool("OLYR_REQUIRE_LIQUIDITY_DATA", true),
            allowed_assets: env_list("OLYR_ALLOWED_ASSETS"),
            allowed_actions: {
                let list = env_list("OLYR_ALLOWED_ACTIONS");
                if list.is_empty() {
                    DEFAULT_ALLOWED_ACTIONS
                        .iter()
                        .map(|s| s.to_string())
                        .collect()
                } else {
                    list
                }
            },
        }
    }
}

fn env_f64(key: &str, default: f64) -> f64 {
    match env::var(key) {
        Ok(raw) if !raw.trim().is_empty() => raw
            .trim()
            .parse::<f64>()
            .unwrap_or_else(|_| panic!("environment variable {key} must be a number")),
        _ => default,
    }
}

fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(raw) if !raw.trim().is_empty() => {
            matches!(raw.trim().to_lowercase().as_str(), "1" | "true" | "yes")
        }
        _ => default,
    }
}

fn env_list(key: &str) -> Vec<String> {
    match env::var(key) {
        Ok(raw) if !raw.trim().is_empty() => raw
            .split(',')
            .map(|item| item.trim().to_uppercase())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}
