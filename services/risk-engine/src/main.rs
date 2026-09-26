//! OLYR risk engine (Rust, axum).
//!
//! Phase 5: the deterministic financial safety layer. Receives structured
//! trade-proposal inputs, evaluates every configured risk rule, and returns
//! an explainable decision (APPROVED / REJECTED / REQUIRES_REVIEW).
//!
//! Hard boundaries:
//! - No LLM anywhere in this service.
//! - No network egress, no wallet access, no transaction construction.
//! - Purely deterministic: same input + config ⇒ same decision.

use std::net::SocketAddr;

use risk_engine::api;
use risk_engine::config;

#[tokio::main]
async fn main() {
    let config = config::RiskConfig::from_env();
    let port: u16 = std::env::var("RISK_ENGINE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8002);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let app = api::build_router(config);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|error| panic!("failed to bind {addr}: {error}"));

    println!("starting risk engine service on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("risk engine server failed");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
