/**
 * Wallet + agent-status routes (Phase 7). Public information only — no
 * secrets. The capability registry and execution policy are server-side
 * state; the LLM can never modify them.
 */
import type { FastifyInstance } from "fastify";
import type { ExecutionPolicyMode } from "@olyr/types";
import type { AgentCapabilities } from "./capabilities.js";
import { computeCapabilities } from "./capabilities.js";
import {
  DOCUMENTED_WALLET_SKILLS,
  WalletNotConfiguredError,
  WalletReadError,
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
  const capabilities = (identity: WalletIdentity | null): AgentCapabilities => {
    return computeCapabilities({
      walletIdentity: identity,
      policyMode: deps.policyMode,
      binanceConfigured: deps.binanceConfigured,
    });
  };

  const safeIdentity = async (): Promise<WalletIdentity> => {
    try {
      return await deps.provider.getWalletIdentity();
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        return {
          provider: "binance-agentic-wallet",
          status: "NOT_CONFIGURED",
          address: null,
          network: null,
          versions: { cli: null, skill: null },
          capabilities: [],
          detail:
            error.message.slice(0, 200) ||
            "No wallet address is configured and the CLI is not provisioned.",
        };
      }
      throw error;
    }
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
          detail:
            error.message.slice(0, 200) ||
            "No wallet address is configured and the CLI is not provisioned.",
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
      capabilities: capabilities(identity),
      skills: DOCUMENTED_WALLET_SKILLS,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/wallet/capabilities", async () => {
    return { capabilities: capabilities(await safeIdentity()), timestamp: new Date().toISOString() };
  });

  app.get("/api/wallet/balances", async (_request, reply) => {
    try {
      const balances = await deps.provider.getBalances();
      return {
        balances,
        source: "binance-web3",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof WalletNotConfiguredError) {
        return reply.code(503).send({
          error: {
            category: "wallet-not-configured",
            message: error.message,
          },
        });
      }
      if (error instanceof WalletReadError) {
        return reply.code(502).send({
          error: {
            category: "wallet-read-failed",
            message: error.message,
          },
        });
      }
      throw error;
    }
  });
}
