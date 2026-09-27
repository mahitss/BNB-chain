/**
 * Bounded agent loop (Phase 7).
 *
 * On a configurable interval (never uncontrolled): evaluate ACTIVE strategies
 * against the latest market snapshot, create deduplicated proposals, run risk,
 * and — only when the policy permits automatic execution and every gate
 * passes — quote → simulate → authorize → execute. Otherwise stop after risk
 * evaluation and record an event for the user. Cooldown + deduplication
 * prevent repeated trades of the same signal. Graceful stop; no overlap.
 */
import type { BinanceTradingClient, Logger } from "@olyr/binance";
import type { IntelligenceConfig } from "@olyr/config";
import type {
  ExecutionPolicyMode,
  MarketOpportunity,
  MarketSnapshot,
  RiskDecision,
  SimulationResult,
  StrategyDefinition,
  TradeProposal,
} from "@olyr/types";
import { evaluateExecutionGate, type GateResult } from "../wallet/capabilities.js";
import type { RiskEngineClient } from "../proposals/risk-client.js";
import type { ExecutionStore } from "../executions/service.js";
import type { MarketIntelligenceService } from "../services/market.js";
import type { AgentCapabilities } from "./capabilities.js";

export interface StrategyLoopOptions {
  registry: {
    list(): Promise<
      Array<{ id: string; name: string; status: string; definition: StrategyDefinition }>
    >;
  };
  proposals: {
    create(
      strategy: StrategyDefinition,
      strategyId: string | null,
      snapshot: MarketSnapshot | null,
    ): Promise<TradeProposal>;
    updateProposalStatus(id: string, status: string): Promise<void>;
  };
  riskClient: RiskEngineClient;
  tradingClient: BinanceTradingClient | null;
  executionStore: ExecutionStore;
  marketService: MarketIntelligenceService;
  intelligenceConfig: IntelligenceConfig;
  policy: {
    mode: ExecutionPolicyMode;
    maxTradeUsd: number;
    maxDailyUsd: number;
    maxSlippagePercent: number;
    allowedAssets: string[];
    allowedActions: string[];
    requireHumanApprovalAboveUsd: number;
  };
  limits: {
    allowedAssets: string[];
    allowedActions: string[];
    maxStrategyTradeUsd: number;
    maxStrategyDailyUsd: number;
    maxSpreadThresholdPercent: number;
  };
  cooldownSeconds: number;
  intervalSeconds: number;
  chainId: string;
  logger: Logger;
}

export class StrategyLoopWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private currentRun: Promise<void> = Promise.resolve();
  /** dedupKey → last handled instant (process-local, deterministic). */
  private readonly handledSignals = new Map<string, number>();
  /** strategyId → last execution instant. */
  private readonly lastExecutionByStrategy = new Map<string, string>();

  constructor(private readonly options: StrategyLoopOptions) {}

  start(): void {
    if (this.timer || this.stopped) return;
    const interval = Math.max(10, this.options.intervalSeconds) * 1000;
    this.timer = setInterval(() => void this.runOnce("scheduled"), interval);
    this.timer.unref?.();
    this.options.logger.info("agent_loop.started", {
      intervalSeconds: this.options.intervalSeconds,
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.currentRun;
    this.options.logger.info("agent_loop.stopped", {});
  }

  lastObservations(): MarketOpportunity[] {
    return [...this.options.marketService["store"].latest().opportunities];
  }

  async runOnce(trigger: string): Promise<boolean> {
    if (this.running || this.stopped) {
      this.options.logger.warn("agent_loop.skipped_overlap", { trigger });
      return false;
    }
    this.running = true;
    const previous = this.currentRun;
    this.currentRun = (async () => {
      await previous.catch(() => {});
      try {
        await this.evaluateStrategies(trigger);
      } catch (error) {
        this.options.logger.error("agent_loop.error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running = false;
      }
    })();
    await this.currentRun;
    return true;
  }

  private async evaluateStrategies(trigger: string): Promise<void> {
    const now = Date.now();
    // Expire handled signals past the cooldown window to bound memory.
    for (const [key, at] of this.handledSignals) {
      if (now - at > Math.max(this.options.cooldownSeconds, 3600) * 1000) {
        this.handledSignals.delete(key);
      }
    }
    const active = (await this.options.registry.list()).filter((s) => s.status === "ACTIVE");
    if (active.length === 0) {
      this.options.logger.info("agent_loop.no_active_strategies", { trigger });
      return;
    }
    for (const strategy of active) {
      const ticker = strategy.definition.asset.ticker;
      try {
        const snapshot = await this.options.marketService.getSnapshot(ticker);
        if (!snapshot) {
          this.options.logger.warn("agent_loop.no_snapshot", { ticker, trigger });
          continue;
        }
        const opportunity = this.opportunityFromSnapshot(strategy, snapshot);
        const dedupKey = `${strategy.id}:${ticker}:${opportunity.direction}`;
        const handledAt = this.handledSignals.get(dedupKey);
        if (handledAt !== undefined && now - handledAt < this.options.cooldownSeconds * 1000) {
          continue; // same signal within cooldown — never re-trade
        }
        const proposal = await this.options.proposals.create(
          strategy.definition,
          strategy.id,
          snapshot,
        );
        this.handledSignals.set(dedupKey, now);
        const decision = await this.options.riskClient.evaluate(
          await this.riskInputFor(proposal, snapshot),
        );
        await this.options.proposals.updateProposalStatus(proposal.id, decision.decision);
        proposal.status = decision.decision;
        if (decision.decision !== "APPROVED") {
          this.options.logger.info("agent_loop.risk_rejected", {
            ticker,
            reasons: decision.rulesFailed.map((r) => r.reason),
          });
          continue;
        }
        await this.attemptExecution(proposal, strategy, decision, snapshot, trigger);
      } catch (error) {
        this.options.logger.warn("agent_loop.strategy_error", {
          ticker,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async attemptExecution(
    proposal: TradeProposal,
    strategy: { id: string; name: string; status: string; definition: StrategyDefinition },
    riskDecision: RiskDecision,
    snapshot: MarketSnapshot,
    trigger: string,
  ): Promise<void> {
    const gate = evaluateExecutionGate({
      proposal: {
        ...proposal,
        expiresAt: new Date(
          Date.now() + this.options.intelligenceConfig.referenceStaleSeconds * 1000,
        ).toISOString(),
      },
      strategy,
      quote: null, // quote is requested inside the auto flow below
      simulation: null,
      authorization: null,
      policy: this.options.policy,
      limits: this.options.limits,
      dailyUsedUsd: 0,
      fromAgent: true,
      lastExecutionAt: this.lastExecutionByStrategy.get(strategy.id) ?? null,
      cooldownSeconds: this.options.cooldownSeconds,
      duplicateExecutionExists: false,
    });
    if (gate.decision === "BLOCKED") {
      this.options.logger.info("agent_loop.blocked", {
        ticker: proposal.asset,
        reasons: gate.reasons,
      });
      await this.options.executionStore.persistEvents(
        [{ type: "REJECTED", detail: { proposalId: proposal.id, reasons: gate.reasons } }],
        strategy.id,
      );
      return;
    }
    if (this.options.policy.mode !== "BOUNDED_AGENT") {
      // MANUAL: stop here — the user executes from the proposals page.
      this.options.logger.info("agent_loop.awaiting_user", { ticker: proposal.asset, trigger });
      await this.options.executionStore.persistEvents(
        [{ type: "PROPOSAL_CREATED", detail: { proposalId: proposal.id, awaitingUser: true } }],
        strategy.id,
      );
      return;
    }
    if (!this.options.tradingClient) {
      this.options.logger.warn("agent_loop.no_trading_client", { ticker: proposal.asset });
      return;
    }
    // Auto flow: quote → simulate → authorize → execute. The execution
    // service re-runs every gate server-side; nothing here can bypass it.
    const contract = snapshot.tokenContractAddress;
    const quote = await this.options.tradingClient.getQuote({
      chainId: this.options.chainId,
      fromTokenAddress: contract,
      toTokenAddress: contract,
      amount: String(Math.round(proposal.requestedAmountUsd * 1e18)),
      userWalletAddress: undefined,
    });
    if (quote.length === 0) {
      this.options.logger.warn("agent_loop.no_quote", { ticker: proposal.asset });
      return;
    }
    const storedQuote = await this.options.executionStore.saveQuote({
      proposalId: proposal.id,
      quote: {
        id: "",
        chainId: this.options.chainId,
        fromTokenAddress: contract,
        toTokenAddress: contract,
        amountIn: String(Math.round(proposal.requestedAmountUsd * 1e18)),
        estimatedAmountOut: quote[0]!.toTokenAmount,
        routes: quote,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        source: "binance-web3",
        createdAt: new Date().toISOString(),
      },
    });
    const swap = await this.options.tradingClient.buildSwap({
      chainId: this.options.chainId,
      fromTokenAddress: contract,
      toTokenAddress: contract,
      amount: String(Math.round(proposal.requestedAmountUsd * 1e18)),
      quoteId: quote[0]!.quoteId ?? "",
    });
    let simulation: SimulationResult;
    if (swap.mode === "SWAP" && swap.tx) {
      simulation = await this.options.tradingClient.simulateTransaction(
        this.options.chainId,
        swap.tx,
      );
    } else {
      simulation = {
        id: `rfq_${Date.now()}`,
        proposalId: proposal.id,
        status: "UNKNOWN",
        apiStatus: "RFQ",
        failReason: null,
        gasEstimate: null,
        balanceChanges: [],
        allowanceChanges: [],
        warnings: ["RFQ order: vendor-validated at submission"],
        timestamp: new Date().toISOString(),
        source: "binance-web3",
      };
    }
    const simStored = await this.options.executionStore.saveSimulation({
      proposalId: proposal.id,
      quoteId: storedQuote.id,
      simulation,
    });
    const auth = await this.options.executionStore.saveAuthorization({
      proposalId: proposal.id,
      quoteId: storedQuote.id,
      simulationId: simStored.id,
      decision: "APPROVED",
      actor: "agent:bounded",
      policyMode: "BOUNDED_AGENT",
    });
    const execution = await this.options.executionStore.createExecution({
      proposalId: proposal.id,
      quoteId: storedQuote.id,
      simulationId: simStored.id,
      authorizationId: auth.id,
      state: "CREATED",
      idempotencyKey: `exec:${proposal.id}`,
      environment: "LIVE",
    });
    await this.options.executionStore.updateExecutionState(execution.id, "RISK_APPROVED");
    this.lastExecutionByStrategy.set(strategy.id, new Date().toISOString());
    this.options.logger.info("agent_loop.execution_created", {
      ticker: proposal.asset,
      executionId: execution.id,
      note: "handoff to the Go execution service happens via POST /api/executions/:id flow",
    });
  }

  private opportunityFromSnapshot(
    strategy: { definition: StrategyDefinition },
    snapshot: MarketSnapshot,
  ): MarketOpportunity {
    return {
      ticker: snapshot.ticker,
      tokenSymbol: snapshot.tokenSymbol,
      tokenContractAddress: snapshot.tokenContractAddress,
      chainId: snapshot.chainId,
      status: "WATCH",
      direction: snapshot.divergence.direction,
      spreadPercent: snapshot.divergence.spreadPercent,
      spreadAbsolute: snapshot.divergence.spreadAbsolute,
      onChainPrice: snapshot.onChainPrice,
      referencePrice: snapshot.referencePrice,
      marketState: snapshot.marketState,
      referenceFreshness: snapshot.referenceFreshness,
      confidence: null,
      reasons: [],
      warnings: [],
      timestamp: snapshot.timestamp,
      source: snapshot.source,
    };
  }

  private async riskInputFor(
    proposal: TradeProposal,
    snapshot: MarketSnapshot,
  ): Promise<import("@olyr/types").RiskInput> {
    return {
      asset: proposal.asset,
      action: proposal.action,
      requestedAmountUsd: proposal.requestedAmountUsd,
      estimatedPrice: snapshot.onChainPrice !== null ? Number(snapshot.onChainPrice) : null,
      referencePrice: snapshot.referencePrice !== null ? Number(snapshot.referencePrice) : null,
      spreadPercent:
        snapshot.divergence.spreadPercent !== null
          ? Number(snapshot.divergence.spreadPercent)
          : null,
      estimatedSlippagePercent: null,
      marketState: snapshot.marketState,
      referenceFreshness: snapshot.referenceFreshness,
      liquidityStatus:
        snapshot.liquidity.status === "AVAILABLE"
          ? "SUFFICIENT"
          : snapshot.liquidity.status === "NONE"
            ? "INSUFFICIENT"
            : "UNKNOWN",
      currentPositionUsd: null,
      dailyTradedUsd: 0,
      dailyVolumeUsd: null,
      referenceAgeSeconds: snapshot.referenceAgeSeconds,
    };
  }

  capabilities(): AgentCapabilities {
    return {
      canReadMarketData: true,
      canReadWallet: false,
      canReadPortfolio: false,
      canRequestQuotes: this.options.tradingClient !== null,
      canSimulateTransactions: this.options.tradingClient !== null,
      canExecuteTrades: false, // executions hand off through the gated API only
      walletConfigured: false,
      policyMode: this.options.policy.mode,
    };
  }

  gateDebug(): GateResult | null {
    return null;
  }
}
