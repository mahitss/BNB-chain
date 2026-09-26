//! Rule-matrix, boundary, and invariant tests. Deterministic — no network.

use risk_engine::config::RiskConfig;
use risk_engine::engine::RiskEngine;
use risk_engine::models::{Decision, RiskRequest};

fn base_request() -> RiskRequest {
    RiskRequest {
        asset: "NVDA".to_string(),
        action: "REDUCE_POSITION".to_string(),
        requested_amount_usd: 20.0,
        estimated_price: Some(142.75),
        reference_price: Some(140.20),
        spread_percent: Some(1.82),
        estimated_slippage_percent: Some(0.25),
        market_state: Some("CLOSED".to_string()),
        reference_freshness: Some("AGING".to_string()),
        liquidity_status: Some("SUFFICIENT".to_string()),
        current_position_usd: Some(100.0),
        daily_traded_usd: Some(0.0),
        daily_volume_usd: Some(1000.0),
        reference_age_seconds: Some(120.0),
    }
}

fn config() -> RiskConfig {
    RiskConfig {
        max_trade_usd: 25.0,
        max_daily_trade_usd: 100.0,
        max_position_usd: 500.0,
        max_slippage_percent: 1.0,
        max_reference_age_seconds: 3600.0,
        require_liquidity_data: true,
        allowed_assets: Vec::new(),
        allowed_actions: Vec::new(),
    }
}

fn evaluate(request: &RiskRequest) -> Decision {
    RiskEngine::new(config())
        .evaluate(&request, "2026-01-01T00:00:00Z".to_string())
        .decision
}

fn failed_rules(request: &RiskRequest) -> Vec<String> {
    let decision = RiskEngine::new(config()).evaluate(&request, "t".to_string());
    decision
        .rules_failed
        .iter()
        .map(|r| r.rule.clone())
        .collect()
}

#[test]
fn base_request_is_approved() {
    assert_eq!(evaluate(&base_request()), Decision::Approved);
}

#[test]
fn trade_size_boundaries() {
    let mut request = base_request();
    request.requested_amount_usd = 25.0;
    assert_eq!(
        evaluate(&request),
        Decision::Approved,
        "exactly at limit passes"
    );

    request.requested_amount_usd = 25.01;
    assert_eq!(
        evaluate(&request),
        Decision::Rejected,
        "just above limit rejects"
    );
    assert!(failed_rules(&request).contains(&"MAX_TRADE_SIZE".to_string()));
}

#[test]
fn daily_exposure_boundaries() {
    let mut request = base_request();
    request.daily_traded_usd = Some(80.0); // 80 + 20 = 100 = limit
    assert_eq!(
        evaluate(&request),
        Decision::Approved,
        "at daily limit passes"
    );

    request.daily_traded_usd = Some(80.01);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"DAILY_EXPOSURE".to_string()));
}

#[test]
fn asset_allowlist() {
    let mut config = config();
    config.allowed_assets = vec!["TSLA".to_string(), "SPY".to_string()];
    let decision = RiskEngine::new(config.clone()).evaluate(&base_request(), "t".to_string());
    assert_eq!(decision.decision, Decision::Rejected);
    assert!(decision
        .rules_failed
        .iter()
        .any(|r| r.rule == "ALLOWED_ASSET"));

    let mut request = base_request();
    request.asset = "TSLA".to_string();
    let mut allowlist = config;
    allowlist.allowed_assets = vec!["TSLA".to_string()];
    let decision = RiskEngine::new(allowlist).evaluate(&request, "t".to_string());
    assert_eq!(decision.decision, Decision::Approved);
}

#[test]
fn action_allowlist_spot_only() {
    let mut request = base_request();
    request.action = "OPEN_PERPETUAL".to_string();
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"ALLOWED_ACTION".to_string()));

    let mut request = base_request();
    request.action = "OBSERVE".to_string();
    // OBSERVE is not in the default spot set — rejected as a trade proposal.
    assert_eq!(evaluate(&request), Decision::Rejected);
}

#[test]
fn slippage_boundaries() {
    let mut request = base_request();
    request.estimated_slippage_percent = Some(1.0);
    assert_eq!(
        evaluate(&request),
        Decision::Approved,
        "slippage at limit passes"
    );

    request.estimated_slippage_percent = Some(1.01);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"MAX_SLIPPAGE".to_string()));

    request.estimated_slippage_percent = None;
    let decision = RiskEngine::new(config()).evaluate(&request, "t".to_string());
    assert_eq!(decision.decision, Decision::Approved);
    assert!(decision
        .warnings
        .iter()
        .any(|w| w.contains("slippage is unavailable")));
}

#[test]
fn reference_freshness_boundaries() {
    let mut request = base_request();
    request.reference_age_seconds = Some(3600.0);
    assert_eq!(
        evaluate(&request),
        Decision::Approved,
        "age at limit passes"
    );

    request.reference_age_seconds = Some(3601.0);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"MARKET_DATA_FRESHNESS".to_string()));

    request.reference_age_seconds = None;
    request.reference_freshness = Some("STALE".to_string());
    assert_eq!(evaluate(&request), Decision::RequiresReview);

    request.reference_freshness = Some("UNKNOWN".to_string());
    assert_eq!(evaluate(&request), Decision::RequiresReview);
}

#[test]
fn missing_freshness_requires_review() {
    let mut request = base_request();
    request.reference_freshness = None;
    request.reference_age_seconds = None;
    assert_eq!(evaluate(&request), Decision::RequiresReview);
}

#[test]
fn liquidity_unknown_requires_review_not_approval() {
    let mut request = base_request();
    request.liquidity_status = Some("UNKNOWN".to_string());
    assert_eq!(evaluate(&request), Decision::RequiresReview);

    request.liquidity_status = Some("INSUFFICIENT".to_string());
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"LIQUIDITY".to_string()));
}

#[test]
fn position_limit_boundaries() {
    let mut request = base_request();
    request.action = "BUY".to_string();
    request.current_position_usd = Some(480.0); // 480 + 20 = 500 = limit
    assert_eq!(evaluate(&request), Decision::Approved);

    request.current_position_usd = Some(480.01);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"POSITION_LIMIT".to_string()));

    // REDUCE more than held fails.
    let mut request = base_request();
    request.current_position_usd = Some(10.0);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"POSITION_LIMIT".to_string()));
}

#[test]
fn invalid_prices_never_approved() {
    for (label, price) in [
        ("zero", 0.0),
        ("negative", -5.0),
        ("infinite", f64::INFINITY),
        ("nan", f64::NAN),
    ] {
        let mut request = base_request();
        request.estimated_price = Some(price);
        assert_eq!(
            evaluate(&request),
            Decision::Rejected,
            "{label} price must reject"
        );
        assert!(failed_rules(&request).contains(&"PRICE_SANITY".to_string()));
    }

    let mut request = base_request();
    request.estimated_price = None;
    assert_eq!(
        evaluate(&request),
        Decision::Rejected,
        "missing price for REDUCE rejects"
    );
}

#[test]
fn spread_sanity() {
    let mut request = base_request();
    request.spread_percent = Some(150.0);
    assert_eq!(evaluate(&request), Decision::Rejected);
    assert!(failed_rules(&request).contains(&"SPREAD_SANITY".to_string()));

    request.spread_percent = Some(f64::NAN);
    assert_eq!(evaluate(&request), Decision::Rejected);

    let mut request = base_request();
    request.spread_percent = None;
    let decision = RiskEngine::new(config()).evaluate(&request, "t".to_string());
    assert_eq!(
        decision.decision,
        Decision::Approved,
        "missing spread warns but does not fail"
    );
    assert!(!decision.warnings.is_empty());
}

#[test]
fn unknown_position_requires_review_for_buy() {
    let mut request = base_request();
    request.action = "BUY".to_string();
    request.current_position_usd = None;
    assert_eq!(evaluate(&request), Decision::RequiresReview);
}

#[test]
fn decision_includes_full_audit() {
    let decision =
        RiskEngine::new(config()).evaluate(&base_request(), "2026-01-01T00:00:00Z".to_string());
    assert_eq!(decision.rules_evaluated.len(), 10);
    assert_eq!(decision.rules_failed.len(), 0);
    assert_eq!(decision.timestamp, "2026-01-01T00:00:00Z");
    // Documented set: every configured rule appears exactly once.
    let mut names = decision.rules_evaluated.clone();
    names.sort();
    names.dedup();
    assert_eq!(names.len(), decision.rules_evaluated.len());
}

// ---- Invariant tests (deterministic pseudo-random sweep) ----------------

/// Simple deterministic LCG — no external dependency, reproducible sequence.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 11
    }
    fn below(&mut self, max: f64) -> f64 {
        (self.next() % 10_000) as f64 / 10_000.0 * max
    }
    fn above(&mut self, min: f64, span: f64) -> f64 {
        min + (self.next() % 10_000) as f64 / 10_000.0 * span
    }
}

#[test]
fn invariant_over_limit_trade_never_approved() {
    let mut rng = Lcg(42);
    for _ in 0..200 {
        let mut request = base_request();
        request.requested_amount_usd = rng.above(25.01, 10_000.0);
        assert_eq!(evaluate(&request), Decision::Rejected);
    }
}

#[test]
fn invariant_invalid_price_never_approved() {
    let mut rng = Lcg(7);
    for _ in 0..200 {
        let mut request = base_request();
        request.estimated_price = Some(-(rng.below(1000.0) + 0.01));
        assert_eq!(evaluate(&request), Decision::Rejected);
    }
}

#[test]
fn invariant_disallowed_asset_never_approved() {
    let mut rng = Lcg(99);
    let mut config = config();
    config.allowed_assets = vec!["TSLA".to_string()];
    for _ in 0..100 {
        let mut request = base_request();
        request.asset = format!("DISALLOWED{}", rng.next() % 1000);
        let decision = RiskEngine::new(config.clone()).evaluate(&request, "t".to_string());
        assert_eq!(decision.decision, Decision::Rejected);
    }
}

#[test]
fn invariant_missing_mandatory_data_never_approved() {
    let mut rng = Lcg(1234);
    for _ in 0..100 {
        let mut request = base_request();
        // Randomly remove a mandatory piece: price, reference, or freshness.
        match rng.next() % 3 {
            0 => request.estimated_price = None,
            1 => {
                request.reference_freshness = None;
                request.reference_age_seconds = None;
            }
            _ => request.liquidity_status = Some("UNKNOWN".to_string()),
        }
        let decision = RiskEngine::new(config()).evaluate(&request, "t".to_string());
        assert_ne!(decision.decision, Decision::Approved);
    }
}

#[test]
fn invariant_determinism() {
    // Same input + config ⇒ identical decision, always.
    let request = base_request();
    let first = RiskEngine::new(config()).evaluate(&request, "t".to_string());
    for _ in 0..50 {
        let again = RiskEngine::new(config()).evaluate(&request, "t".to_string());
        assert_eq!(first.decision, again.decision);
        assert_eq!(first.rules_passed, again.rules_passed);
        assert_eq!(first.rules_failed.len(), again.rules_failed.len());
    }
}
