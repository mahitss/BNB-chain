//! HTTP API (axum): GET /health, POST /evaluate.
//!
//! Business rules live in `rules.rs`/`engine.rs`; this module is transport
//! only. Malformed requests are rejected with 422 — never partially
//! evaluated, never executed. The engine is read-only and deterministic.

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::config::RiskConfig;
use crate::engine::RiskEngine;
use crate::models::RiskRequest;

pub fn build_router(config: RiskConfig) -> Router {
    let engine = std::sync::Arc::new(RiskEngine::new(config));
    Router::new()
        .route("/health", get(health))
        .route("/readiness", get(readiness))
        .route(
            "/evaluate",
            post(move |Json(request): Json<RiskRequest>| async move {
                // serde already rejected unknown/missing/mistyped fields; a
                // request that reaches here is schema-valid. The engine is
                // pure: nothing executes, nothing mutates.
                let timestamp =
                    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let decision = engine.evaluate(&request, timestamp);
                Json(decision)
            }),
        )
        .with_state(())
}

/// Readiness = the full rule set is loaded (10 rules). Cheap, no I/O.
async fn readiness() -> Json<serde_json::Value> {
    let rule_count = crate::rules::all_rules().len();
    Json(json!({
        "service": "risk-engine",
        "ready": rule_count >= 10,
        "rules_loaded": rule_count,
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    }))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "service": "risk-engine",
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
