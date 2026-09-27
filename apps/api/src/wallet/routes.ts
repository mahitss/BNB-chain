/**
 * Wallet + agent-status routes (Phase 7). Public information only — no
 * secrets. The capability registry and execution policy are server-side
 * state; the LLM can never modify them.
 */
import type { FastifyInstance } from "fastify";
import type { ExecutionPolicyMode } from "@olyr/types";
import type { AgentCapabilities } from "./capabilities.js";
import {
  DOCUMENTED_WALLET_SKILLS,
  WalletNotConfiguredError,
  type WalletIdentity,
} from "./providers.js";
import { type AgenticWalletProvider } from "./providers.js";

export interface WalletDeps {
  provider: AgenticWalletProvider;
  policyMode: ExecutionPolicyMode;
  limits: {
    maxStrategyTradeUsd: number;
    maxStrategyDailyUsd: number;
    maxSlippagePercent: number;
    allowedAssets: string[];
    allowedActions: string[];
  };
  binanceConfigured: boolean;
}

export function registerWalletRoutes(app: FastifyInstance, deps: WalletDeps): void {
  const capabilities = (): AgentCapabilities => {
    const walletConfigured = false; // baw CLI not provisioned in this environment
    return {
      canReadMarketData: deps.binanceConfigured,
      canReadWallet: walletConfigured,
      canReadPortfolio: walletConfigured,
      canRequestQuotes: deps.binanceConfigured && deps.policyMode !== "DISABLED",
      canSimulateTransactions: deps.binanceConfigured && deps.policyMode !== "DISABLED",
      canExecuteTrades: walletConfigured && deps.policyMode !== "DISABLED",
      walletConfigured,
      policyMode: deps.policyMode,
    };
  };

  app.get("/api/wallet", async () => {
    let identity: WalletIdentity;
    try {
      identity = await deps.provider.getWalletIdentity();
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        identity = {
          provider: "binance-agentic-wallet",
          status: "NOT_CONFIGURED",
          address: null,
          network: null,
          versions: { cli: null, skill: null },
          capabilities: [],
        };
      } else {
        throw error;
      }
    }
    return {
      wallet: identity,
      executionMode: deps.policyMode,
      limits: {
        maxTradeUsd: deps.limits.maxStrategyTradeUsd,
        maxDailyUsd: deps.limits.maxStrategyDailyUsd,
        maxSlippagePercent: deps.limits.maxSlippagePercent,
        allowedAssets: deps.limits.allowedAssets,
        allowedActions: deps.limits.allowedActions,
      },
      capabilities: capabilities(),
      skills: DOCUMENTED_WALLET_SKILLS,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/wallet/capabilities", async () => {
    return { capabilities: capabilities(), timestamp: new Date().toISOString() };
  });

  app.get("/api/wallet/balances", async (_request, reply) => {
    try {
      const balances = await deps.provider.getBalances();
      return { balances, timestamp: new Date().toISOString() };
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        return reply.code(503).send({
          error: {
            category: "wallet-not-configured",
            message: error.message,
          },
        });
      }
      throw error;
    }
  });
}
