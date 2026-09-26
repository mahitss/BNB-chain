/**
 * Live opportunity scanner.
 *
 * Evaluates a configured universe of tokenized assets on a bounded polling
 * interval: RWA listings → liquidity → snapshot → market state → freshness →
 * spread → opportunity engine → store. Deterministic only.
 *
 * Safety properties:
 * - No uncontrolled loop: a single setInterval with a configurable interval;
 *   scans never self-schedule recursively.
 * - Overlap prevention: a local in-process lock, plus a Redis SET-NX lease
 *   when REDIS_URL is configured (multi-instance safe).
 * - Graceful shutdown: stop() clears the timer and awaits the running scan.
 * - Bounded work: OLYR_SCAN_MAX_ASSETS caps assets per scan to respect the
 *   documented per-endpoint rate limit (5 RPS default).
 */
import type { BinanceRwaClient, Logger } from "@olyr/binance";
import type { IntelligenceConfig } from "@olyr/config";
import type { MarketOpportunity, MarketSnapshot } from "@olyr/types";
import { buildSnapshot } from "../intelligence/snapshot.js";
import { evaluateOpportunity } from "../intelligence/opportunity.js";
import type { ScanStore } from "./store.js";

export interface ScannerOptions {
  client: BinanceRwaClient;
  store: ScanStore;
  config: IntelligenceConfig;
  chainId: string;
  logger: Logger;
  /** Optional distributed lock (Redis-backed) for multi-instance deployments. */
  distributedLock?: {
    acquireLease: (key: string, ttlMs: number) => Promise<boolean>;
    releaseLease: (key: string) => Promise<void>;
  };
}

const LOCK_KEY = "olyr:scan:lease";

export class OpportunityScanner {
  private readonly client: BinanceRwaClient;
  private readonly store: ScanStore;
  private readonly config: IntelligenceConfig;
  private readonly chainId: string;
  private readonly logger: Logger;
  private readonly distributedLock?: ScannerOptions["distributedLock"];

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private currentScan: Promise<void> = Promise.resolve();

  constructor(options: ScannerOptions) {
    this.client = options.client;
    this.store = options.store;
    this.config = options.config;
    this.chainId = options.chainId;
    this.logger = options.logger;
    this.distributedLock = options.distributedLock;
  }

  start(): void {
    if (this.timer || this.stopped) {
      return;
    }
    const intervalMs = Math.max(10, this.config.scan.intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.scanOnce("scheduled");
    }, intervalMs);
    this.timer.unref?.();
    this.logger.info("scan.started", { intervalSeconds: this.config.scan.intervalSeconds });
  }

  /** Clears the timer and waits for the in-flight scan to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.currentScan;
    this.logger.info("scan.stopped", {});
  }

  /**
   * Runs one scan. Returns true when this call performed the scan; false when
   * a scan was already in progress (overlap prevented) or the distributed
   * lease was held elsewhere.
   */
  async scanOnce(trigger: "scheduled" | "manual"): Promise<boolean> {
    if (this.running || this.stopped) {
      this.logger.warn("scan.skipped_overlap", { trigger });
      return false;
    }
    this.running = true;
    const previous = this.currentScan;
    const scan = (async () => {
      await previous.catch(() => {});
      try {
        await this.runScan(trigger);
      } catch (error) {
        this.logger.error("scan.error", {
          trigger,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.running = false;
      }
    })();
    this.currentScan = scan;
    await scan;
    return true;
  }

  private async runScan(trigger: string): Promise<void> {
    const leaseKey = `${LOCK_KEY}:${this.chainId}`;
    if (this.distributedLock) {
      const leaseMs = Math.max(10, this.config.scan.intervalSeconds) * 1000;
      const acquired = await this.distributedLock.acquireLease(leaseKey, leaseMs);
      if (!acquired) {
        this.logger.warn("scan.skipped_lease", { trigger });
        return;
      }
    }
    const startedAt = Date.now();
    this.logger.info("scan.started_run", { trigger, chainId: this.chainId });
    try {
      const listings = await this.client.listTokens({ chainId: this.chainId });
      let universe = listings;
      if (this.config.scan.assetsFilter.length > 0) {
        universe = listings.filter((l) =>
          this.config.scan.assetsFilter.includes(l.asset.underlyingTicker.toUpperCase()),
        );
      }
      universe = universe.slice(0, this.config.scan.maxAssets);

      const snapshots: MarketSnapshot[] = [];
      const opportunities: MarketOpportunity[] = [];
      for (const listing of universe) {
        try {
          const evaluatedAt = new Date();
          const liquidity = await this.fetchLiquidity(
            listing.asset.chainId,
            listing.asset.tokenContractAddress,
          );
          const snapshot = buildSnapshot({
            listing,
            liquidity,
            thresholds: {
              freshSeconds: this.config.referenceFreshSeconds,
              agingSeconds: this.config.referenceAgingSeconds,
              staleSeconds: this.config.referenceStaleSeconds,
            },
            now: evaluatedAt,
            source: "binance-web3",
          });
          snapshots.push(snapshot);
          opportunities.push(evaluateOpportunity(snapshot, this.config));
          this.logger.info("scan.asset_evaluated", {
            ticker: snapshot.ticker,
            status: opportunities[opportunities.length - 1]!.status,
            spreadPercent: snapshot.divergence.spreadPercent,
          });
        } catch (error) {
          this.logger.warn("scan.asset_data_unavailable", {
            ticker: listing.asset.underlyingTicker,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const completedAt = new Date().toISOString();
      this.store.save({ opportunities, snapshots, completedAt });
      this.logger.info("scan.completed", {
        trigger,
        assets: snapshots.length,
        opportunities: opportunities.filter((o) => o.status === "OPPORTUNITY").length,
        watch: opportunities.filter((o) => o.status === "WATCH").length,
        blocked: opportunities.filter((o) => o.status === "BLOCKED").length,
        latencyMs: Date.now() - startedAt,
      });
    } finally {
      if (this.distributedLock) {
        await this.distributedLock.releaseLease(leaseKey).catch(() => {});
      }
    }
  }

  private async fetchLiquidity(chainId: string, contract: string) {
    try {
      const pools = await this.client.getTokenLiquidity(chainId, contract);
      if (pools.length === 0) {
        return {
          status: "NONE" as const,
          totalLiquidityUsd: null,
          poolCount: 0,
          checkedAt: new Date().toISOString(),
          warnings: [] as string[],
        };
      }
      // Sum documented pool liquidity with decimal-safe arithmetic.
      let total = 0n;
      let scale = 0;
      const parsed = pools
        .map((p) => ({ value: p.liquidityUsd, parsed: parseSafe(p.liquidityUsd) }))
        .filter(
          (p): p is { value: string; parsed: { value: bigint; scale: number } } =>
            p.parsed !== null,
        );
      for (const p of parsed) {
        scale = Math.max(scale, p.parsed.scale);
      }
      for (const p of parsed) {
        total += p.parsed.value * 10n ** BigInt(scale - p.parsed.scale);
      }
      const unscaled = total.toString().padStart(scale + 1, "0");
      const totalLiquidityUsd =
        scale > 0 ? `${unscaled.slice(0, -scale)}.${unscaled.slice(-scale)}` : unscaled;
      return {
        status: "AVAILABLE" as const,
        totalLiquidityUsd,
        poolCount: pools.length,
        checkedAt: new Date().toISOString(),
        warnings: [] as string[],
      };
    } catch {
      // Liquidity could not be determined — never assume it is sufficient.
      return {
        status: "UNKNOWN" as const,
        totalLiquidityUsd: null,
        poolCount: null,
        checkedAt: new Date().toISOString(),
        warnings: ["liquidity-unavailable"],
      };
    }
  }
}

function parseSafe(value: string | null): { value: bigint; scale: number } | null {
  if (value === null || !/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return null;
  }
  const [intPart, fracPart = ""] = value.trim().split(".");
  return { value: BigInt(intPart + fracPart), scale: fracPart.length };
}
