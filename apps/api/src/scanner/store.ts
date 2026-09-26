/**
 * Scan-result store. Phase 3 keeps results in memory (Prisma/PostgreSQL was
 * intentionally not initialized in Phase 1; persistence arrives with the
 * dedicated database phase). The interface is designed so a Prisma-backed
 * implementation can replace this without touching callers.
 */
import type { MarketOpportunity, MarketSnapshot } from "@olyr/types";

export interface ScanStore {
  /** Replace the results of the latest scan (atomic per scan). */
  save(results: {
    opportunities: MarketOpportunity[];
    snapshots: MarketSnapshot[];
    completedAt: string;
  }): void;
  latest(): {
    opportunities: MarketOpportunity[];
    snapshots: MarketSnapshot[];
    completedAt: string | null;
  };
  latestForTicker(ticker: string): MarketOpportunity | null;
  /** Global on-chain observability: did the last scan obtain quotes? */
  lastScanOutcome(): { ok: boolean; at: string | null; assetCount: number };
}

export class InMemoryScanStore implements ScanStore {
  private opportunities: MarketOpportunity[] = [];
  private snapshots: MarketSnapshot[] = [];
  private completedAt: string | null = null;
  private lastOk = false;
  private lastOkAt: string | null = null;
  private lastCount = 0;

  save(results: {
    opportunities: MarketOpportunity[];
    snapshots: MarketSnapshot[];
    completedAt: string;
  }): void {
    this.opportunities = results.opportunities;
    this.snapshots = results.snapshots;
    this.completedAt = results.completedAt;
    this.lastOk = true;
    this.lastOkAt = results.completedAt;
    this.lastCount = results.snapshots.length;
  }

  latest(): {
    opportunities: MarketOpportunity[];
    snapshots: MarketSnapshot[];
    completedAt: string | null;
  } {
    return {
      opportunities: this.opportunities,
      snapshots: this.snapshots,
      completedAt: this.completedAt,
    };
  }

  latestForTicker(ticker: string): MarketOpportunity | null {
    const target = ticker.toUpperCase();
    return this.opportunities.find((o) => o.ticker.toUpperCase() === target) ?? null;
  }

  lastScanOutcome(): { ok: boolean; at: string | null; assetCount: number } {
    return { ok: this.lastOk, at: this.lastOkAt, assetCount: this.lastCount };
  }
}
