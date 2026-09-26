"use client";

/**
 * OLYR market-intelligence page (Phase 3): market-state banner, deterministic
 * opportunity cards with full explainability, and warnings — all from OLYR's
 * API. No fake data: without a configured scanner this page shows an explicit
 * setup/empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, get as apiGet } from "../../lib/api";
import type { GlobalMarketState, MarketOpportunity } from "@olyr/types";

interface OpportunitiesResponse {
  timestamp: string;
  dataSource: string;
  lastScanAt: string | null;
  opportunities: MarketOpportunity[];
}

const MARKET_STATE_LABELS: Record<string, string> = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
  PRE_MARKET: "PRE-MARKET",
  AFTER_HOURS: "AFTER HOURS",
  WEEKEND: "WEEKEND",
  HOLIDAY: "HOLIDAY",
  UNKNOWN: "UNKNOWN",
};

const STATUS_STYLES: Record<string, string> = {
  OPPORTUNITY: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  WATCH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  BLOCKED: "bg-red-500/15 text-red-400 border-red-500/30",
  NO_SIGNAL: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  DATA_UNAVAILABLE: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
};

function MarketStateBadge({ label, value }: { label: string; value: string | undefined }) {
  const state = value ?? "UNKNOWN";
  const open = state === "OPEN" || state === "ACTIVE";
  const closed = state === "CLOSED" || state === "WEEKEND" || state === "HOLIDAY";
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">{label}</p>
      <p
        className={`font-mono text-2xl font-semibold ${
          open ? "text-emerald-400" : closed ? "text-zinc-400" : "text-amber-400"
        }`}
      >
        {MARKET_STATE_LABELS[state] ?? state}
      </p>
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: MarketOpportunity }) {
  const statusStyle = STATUS_STYLES[opportunity.status] ?? STATUS_STYLES["NO_SIGNAL"];
  const showDetail = opportunity.status !== "NO_SIGNAL";
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-lg font-semibold text-zinc-50">{opportunity.ticker}</h3>
        <span className={`rounded border px-2 py-0.5 font-mono text-xs ${statusStyle}`}>
          {opportunity.status}
          {opportunity.confidence ? ` · ${opportunity.confidence}` : ""}
        </span>
      </header>

      {opportunity.spreadPercent !== null ? (
        <p
          className={`mt-2 font-mono text-3xl font-semibold ${
            opportunity.direction === "PREMIUM"
              ? "text-emerald-400"
              : opportunity.direction === "DISCOUNT"
                ? "text-red-400"
                : "text-zinc-300"
          }`}
        >
          {Number(opportunity.spreadPercent) >= 0 ? "+" : ""}
          {Number(opportunity.spreadPercent).toFixed(2)}% divergence
        </p>
      ) : (
        <p className="mt-2 font-mono text-3xl text-zinc-600">—</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Reference</dt>
          <dd className="font-mono text-zinc-200">
            {opportunity.referencePrice
              ? `$${Number(opportunity.referencePrice).toLocaleString("en-US", { maximumFractionDigits: 4 })}`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">On-chain</dt>
          <dd className="font-mono text-zinc-200">
            {opportunity.onChainPrice
              ? `$${Number(opportunity.onChainPrice).toLocaleString("en-US", { maximumFractionDigits: 4 })}`
              : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Market</dt>
          <dd className="font-mono text-zinc-200">
            {MARKET_STATE_LABELS[opportunity.marketState] ?? opportunity.marketState}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Reference</dt>
          <dd className="font-mono text-zinc-200">{opportunity.referenceFreshness}</dd>
        </div>
      </dl>

      {showDetail && (
        <div className="mt-4 space-y-2 border-t border-zinc-800 pt-3">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
            Why am I seeing this?
          </p>
          <ul className="space-y-1 text-sm leading-relaxed text-zinc-300">
            {opportunity.reasons.map((reason, index) => (
              <li key={index}>• {reason.message}</li>
            ))}
          </ul>
          {opportunity.warnings.length > 0 && (
            <>
              <p className="pt-1 font-mono text-xs uppercase tracking-widest text-amber-500">
                Warnings
              </p>
              <ul className="space-y-1 text-sm leading-relaxed text-amber-300/90">
                {opportunity.warnings.map((warning, index) => (
                  <li key={index}>• {warning.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export default function MarketsPage() {
  const globalState = useQuery({
    queryKey: ["market-state"],
    queryFn: () => apiGet<GlobalMarketState>("/api/market/state"),
    refetchInterval: 60_000,
  });
  const opportunities = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => apiGet<OpportunitiesResponse>("/api/opportunities"),
    refetchInterval: 30_000,
  });

  const notConfigured =
    (opportunities.isError &&
      opportunities.error instanceof ApiRequestError &&
      opportunities.error.body?.category === "not-configured") ||
    (globalState.isError &&
      globalState.error instanceof ApiRequestError &&
      globalState.error.body?.category === "not-configured");

  if (notConfigured) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-50">Markets</h1>
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          <p className="font-semibold">Binance Web3 API credentials are not configured.</p>
          <p className="mt-2 text-amber-200/80">
            The opportunity scanner needs <code className="font-mono">BINANCE_API_KEY</code> and{" "}
            <code className="font-mono">BINANCE_API_SECRET</code> in the API environment (see{" "}
            <code className="font-mono">.env.example</code>). OLYR deliberately shows no market data
            or signals until real data is configured — no simulated results are ever displayed.
          </p>
        </div>
      </main>
    );
  }

  const banner = globalState.data;
  const results = opportunities.data;
  const interesting = results?.opportunities.filter(
    (o) => o.status === "OPPORTUNITY" || o.status === "WATCH" || o.status === "BLOCKED",
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">
            OLYR · Market Intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Markets</h1>
        </div>
        {results?.lastScanAt && (
          <p className="font-mono text-xs text-zinc-500">
            last scan {new Date(results.lastScanAt).toLocaleTimeString("en-US", { hour12: false })}
          </p>
        )}
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 sm:max-w-md">
        <MarketStateBadge label="US equities" value={banner?.usEquities} />
        <MarketStateBadge label="On-chain market" value={banner?.onChainMarket} />
      </section>
      {banner && (
        <p className="mt-2 max-w-xl text-xs text-zinc-500">{banner.onChainMarketDetail}</p>
      )}

      <section className="mt-10">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Divergence signals
        </h2>
        {opportunities.isPending || globalState.isPending ? (
          <p className="mt-4 font-mono text-sm text-zinc-400">Loading market intelligence…</p>
        ) : interesting && interesting.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {interesting.map((opportunity, index) => (
              <OpportunityCard
                key={`${opportunity.ticker}-${opportunity.tokenContractAddress ?? index}`}
                opportunity={opportunity}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-zinc-800 px-4 py-6 text-sm leading-relaxed text-zinc-400">
            No divergence signals yet. Either all evaluated assets are within configured thresholds,
            or the scanner has not completed a scan. Auto-refresh is active.
          </p>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-zinc-800 px-4 py-4">
        <p className="text-xs leading-relaxed text-zinc-500">
          All signals are produced by OLYR&apos;s deterministic rule engine (thresholds, freshness,
          liquidity, market state) — never by an LLM. Historical divergence visualization:
          unavailable — OLYR does not yet retain enough scan history to plot divergence over time,
          and charts are never fabricated.
        </p>
      </section>
    </main>
  );
}
