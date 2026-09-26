//! OLYR risk engine service.
//!
//! Phase 1 exposes a single health endpoint. Deterministic risk validation —
//! independent from the LLM — arrives in a later phase behind this service.

use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::net::SocketAddr;

const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Mirrors the shared HealthCheck contract from @olyr/types.
#[derive(Serialize)]
struct HealthCheck {
    service: &'static str,
    status: &'static str,
    timestamp: String,
    version: &'static str,
}

async fn health() -> Json<HealthCheck> {
    Json(HealthCheck {
        service: "risk-engine",
        status: "ok",
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        version: SERVICE_VERSION,
    })
}

fn port_from_env() -> u16 {
    std::env::var("RISK_ENGINE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8002)
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

#[tokio::main]
async fn main() {
    let addr = SocketAddr::from(([0, 0, 0, 0], port_from_env()));
    let app = Router::new().route("/health", get(health));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|error| panic!("failed to bind {addr}: {error}"));

    println!("starting risk engine service on {addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("risk engine server failed");
}
