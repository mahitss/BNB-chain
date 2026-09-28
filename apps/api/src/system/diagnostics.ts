/**
 * Safe diagnostics (Phase 10.1): reports ONLY whether Binance credentials are
 * CONFIGURED / NOT_CONFIGURED — never values. Distinguishes missing
 * credentials from invalid ones (AUTHENTICATION_FAILED) without conflating
 * them, and exposes a single source of truth for agent state.
 */
import type { FastifyInstance } from "fastify";
import { isBinanceConfigured, envOptionalString } from "@olyr/config";
import { loadBinanceConfig } from "@olyr/config";
import type { BinanceTradingClient } from "@olyr/binance";

export interface AgentStateInfo {
  state: "DISABLED" | "STANDBY" | "SCANNING" | "ERROR";
  /** Human explanation of why the state is what it is. */
  detail: string;
  scanEnabled: boolean;
  binanceConfigured: boolean;
  lastScanAt: string | null;
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
   * Read-only live probe: distinguishes NOT_CONFIGURED from
   * AUTHENTICATION_FAILED (40101/40102/40103/40104) and other errors without
   * logging or returning credential values.
   */
  app.get("/api/diagnostics/binance/probe", async (_request, reply) => {
    if (!deps.binanceConfigured || !deps.tradingClient) {
      return {
        result: "NOT_CONFIGURED",
        detail: "Credentials are absent; no request was made to Binance.",
      };
    }
    try {
      const config = loadBinanceConfig();
      if (config) {
        // One cheap, read-only platform list call.
        await deps.tradingClient.getAllTokenBalances("56", envOptionalString("OLYR_EXECUTOR_ADDRESS") ?? "0x0000000000000000000000000000000000000000");
      }
      return { result: "OK", detail: "Binance accepted the request." };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      const authFailure =
        name === "BinanceAuthError" ||
        /\b(40101|40102|40103|40104)\b/.test(message) ||
        message.includes("Invalid API Key") ||
        message.includes("Signature error");
      return {
        result: authFailure ? "AUTHENTICATION_FAILED" : "ERROR",
        detail: authFailure
          ? "Binance rejected the configured credentials (authentication failed)."
          : message.slice(0, 200),
      };
    }
    void reply;
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
      detail = "Scan enabled but Binance credentials are not configured — the loop cannot evaluate market data.";
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
