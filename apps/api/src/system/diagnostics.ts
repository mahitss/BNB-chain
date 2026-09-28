/**
 * Safe diagnostics (Phase 9/10.2): reports ONLY whether Binance credentials
 * are CONFIGURED / NOT_CONFIGURED — never values. The live probe categorizes
 * failures as AUTHENTICATION_FAILED / NETWORK_ERROR / RATE_LIMITED /
 * UPSTREAM_ERROR / INVALID_RESPONSE — never conflating a missing credential
 * with an invalid one. Also exposes the single source of truth for agent
 * state.
 */
import type { FastifyInstance } from "fastify";
import { envOptionalString } from "@olyr/config";
import type { BinanceTradingClient } from "@olyr/binance";
import { BinanceError } from "@olyr/binance";

export type BinanceDiagnosticResult =
  | "OK"
  | "NOT_CONFIGURED"
  | "AUTHENTICATION_FAILED"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE";

export interface AgentStateInfo {
  state: "DISABLED" | "STANDBY" | "SCANNING" | "ERROR";
  /** Human explanation of why the state is what it is. */
  detail: string;
  scanEnabled: boolean;
  binanceConfigured: boolean;
  lastScanAt: string | null;
}

/** Maps a caught error to a safe diagnostic category (no values leaked). */
export function categorizeProbeError(error: unknown): {
  result: BinanceDiagnosticResult;
  detail: string;
} {
  if (error instanceof BinanceError) {
    switch (error.category) {
      case "authentication":
        return {
          result: "AUTHENTICATION_FAILED",
          detail: "Binance rejected the configured credentials (authentication failed).",
        };
      case "rate-limit":
        return { result: "RATE_LIMITED", detail: "Binance rate limit exceeded on the probe call." };
      case "network":
      case "timeout":
        return {
          result: "NETWORK_ERROR",
          detail: "Binance gateway unreachable (network/timeout).",
        };
      case "malformed-response":
        return {
          result: "INVALID_RESPONSE",
          detail: "Binance returned a response that could not be parsed.",
        };
      case "invalid-request":
        return {
          result: "UPSTREAM_ERROR",
          detail: "Binance rejected the probe request parameters.",
        };
      default:
        return { result: "UPSTREAM_ERROR", detail: error.message.slice(0, 200) };
    }
  }
  return { result: "NETWORK_ERROR", detail: "Probe failed before reaching Binance." };
}

export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  deps: {
    scanEnabled: boolean;
    binanceConfigured: boolean;
    lastScanAt: string | null;
    tradingClient: BinanceTradingClient | null;
  },
): void {
  /** Credential presence — CONFIGURED/NOT_CONFIGURED only, no values. */
  app.get("/api/diagnostics/binance", async () => {
    return {
      credentials: deps.binanceConfigured ? "CONFIGURED" : "NOT_CONFIGURED",
      note: deps.binanceConfigured
        ? "Binance credentials detected in the environment."
        : "Set BINANCE_API_KEY and BINANCE_API_SECRET in the repository .env (see .env.example), then restart the API.",
      checkedAt: new Date().toISOString(),
    };
  });

  /**
   * Read-only live probe: makes one real signed request to the Binance
   * gateway and categorizes the outcome. Distinguishes NOT_CONFIGURED (no
   * request made) from AUTHENTICATION_FAILED / NETWORK_ERROR / RATE_LIMITED /
   * UPSTREAM_ERROR / INVALID_RESPONSE. Never returns credential values.
   */
  app.get("/api/diagnostics/binance/probe", async () => {
    if (!deps.binanceConfigured || !deps.tradingClient) {
      return {
        result: "NOT_CONFIGURED" as BinanceDiagnosticResult,
        detail: "Credentials are absent; no request was made to Binance.",
      };
    }
    try {
      await deps.tradingClient.getAllTokenBalances(
        "56",
        envOptionalString("OLYR_EXECUTOR_ADDRESS") ?? "0x0000000000000000000000000000000000000000",
      );
      return {
        result: "OK" as BinanceDiagnosticResult,
        detail: "Binance accepted the signed request.",
      };
    } catch (error) {
      const { result, detail } = categorizeProbeError(error);
      return { result, detail };
    }
  });

  /** Single source of truth for agent state (UI must derive from this). */
  app.get("/api/agent/state", async () => {
    let state: AgentStateInfo["state"];
    let detail: string;
    if (!deps.scanEnabled) {
      state = "DISABLED";
      detail = "Scanner disabled (OLYR_SCAN_ENABLED=false).";
    } else if (!deps.binanceConfigured) {
      state = "STANDBY";
      detail =
        "Scan enabled but Binance credentials are not configured — the loop cannot evaluate market data.";
    } else {
      state = "SCANNING";
      detail = deps.lastScanAt
        ? `Loop active; last scan ${deps.lastScanAt}.`
        : "Loop active; the first scan has not completed yet.";
    }
    return {
      state,
      detail,
      scanEnabled: deps.scanEnabled,
      binanceConfigured: deps.binanceConfigured,
      lastScanAt: deps.lastScanAt,
    } satisfies AgentStateInfo;
  });
}
