"use client";

/**
 * Market terminal: searchable tokenized-asset table with market state,
 * prices, spread, freshness, and signal status. Click a row for detail.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { formatPercent, formatUsd, timeAgo } from "../../lib/format";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toneForStatus,
} from "../../components/ui";
import type { RwaAssetWithMarket } from "@olyr/types";

interface AssetsResponse {
  chainId: string;
  assets: RwaAssetWithMarket[];
  retrievedAt: string;
}

export default function MarketsPage() {
  const [search, setSearch] = useState("");
  const assetsQuery = useQuery({
    queryKey: ["rwa-assets"],
    queryFn: () => apiGet<AssetsResponse>("/api/rwa/assets"),
    refetchInterval: 30_000,
  });

  const assets = assetsQuery.data?.assets ?? [];
  const summary = useMemo(() => {
    const platforms = new Set(assets.map((e) => e.asset.platformId));
    return {
      monitored: assets.length,
      withSpread: assets.filter((e) => e.spread.percent !== null).length,
      unknownState: assets.filter((e) => !e.marketStatus).length,
      platforms: platforms.size,
    };
  }, [assets]);
  const topDivergences = useMemo(() => {
    return [...assets]
      .filter((e) => e.spread.percent !== null && Number.isFinite(Number(e.spread.percent)))
      .sort((a, b) => Math.abs(Number(b.spread.percent)) - Math.abs(Number(a.spread.percent)))
      .slice(0, 5);
  }, [assets]);
  const filtered = useMemo(() => {
    const query = search.trim().toUpperCase();
    if (!query) return assets;
    return assets.filter(
      (entry) =>
        entry.asset.underlyingTicker.toUpperCase().includes(query) ||
        entry.asset.underlyingName.toUpperCase().includes(query) ||
        entry.asset.tokenSymbol.toUpperCase().includes(query),
    );
  }, [assets, search]);

  return (
    <main className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="OLYR · Market Terminal"
        title="Tokenized Markets"
        meta={
          assetsQuery.data
            ? `${assets.length} assets · chain ${assetsQuery.data.chainId} · updated ${timeAgo(assetsQuery.data.retrievedAt)}`
            : undefined
        }
      />
      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-zinc-500">
        Live Binance Web3 data. OLYR compares tokenized-equity prices on BSC with their
        reference markets and evaluates divergence under deterministic rules — below are the
        raw listings; ranked divergences follow.
      </p>

      {assetsQuery.data && (
        <div
          aria-label="Market summary"
          className="mt-4 flex flex-col divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/40 sm:flex-row sm:divide-x sm:divide-y-0"
        >
          {[
            { label: "Assets monitored", value: String(summary.monitored) },
            { label: "With spread data", value: String(summary.withSpread) },
            { label: "Unknown market state", value: String(summary.unknownState) },
            { label: "Platforms", value: String(summary.platforms) },
          ].map((s) => (
            <div key={s.label} className="min-w-0 flex-1 px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                {s.label}
              </p>
              <p className="mt-0.5 font-mono text-base font-medium text-zinc-100">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {topDivergences.length > 0 && (
        <section aria-label="Top live divergences" className="mt-6">
          <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400">
            Top live divergences
          </h2>
          <ul className="mt-3 divide-y divide-zinc-800/60 rounded-lg border border-zinc-800 bg-zinc-900/40">
            {topDivergences.map(({ asset, spread, marketStatus }) => (
              <li key={`top-${asset.chainId}:${asset.tokenContractAddress}`}>
                <Link
                  href={`/markets/${encodeURIComponent(asset.underlyingTicker)}`}
                  aria-label={`${asset.underlyingTicker}, spread ${formatPercent(spread.percent)}. Open asset intelligence.`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                >
                  <span className="w-16 shrink-0 font-mono text-base font-semibold text-zinc-50">
                    {asset.underlyingTicker || "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-lg font-medium tabular-nums text-zinc-100">
                      {formatPercent(spread.percent)}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">
                      {asset.underlyingName} · {asset.platformId} ·{" "}
                      {marketStatus?.marketStatus ?? "UNKNOWN"}
                    </span>
                  </span>
                  <StatusBadge
                    tone={toneForStatus(marketStatus?.marketStatus ?? "UNKNOWN")}
                    label={marketStatus?.marketStatus ?? "UNKNOWN"}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker, name, symbol…"
          aria-label="Search tokenized assets"
          className="w-64 rounded border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none"
        />
      </div>

      <div className="mt-4">
        {assetsQuery.isPending ? (
          <Card className="p-5">
            <Skeleton lines={6} />
          </Card>
        ) : assetsQuery.isError ? (
          <ErrorState
            message={
              assetsQuery.error instanceof Error &&
              assetsQuery.error.message.includes("not configured")
                ? "Binance Web3 API credentials are not configured (BINANCE_API_KEY / BINANCE_API_SECRET). Set them in the API environment and restart to load tokenized market data."
                : assetsQuery.error instanceof Error
                  ? assetsQuery.error.message
                  : "Market data unavailable."
            }
            onRetry={() => void assetsQuery.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No tokenized assets match"
            detail={
              assets.length === 0
                ? "The API returned no assets for the configured chain. Without Binance credentials the asset list is empty — this is not simulated."
                : "Try a different search."
            }
          />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 font-mono text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-3">Ticker</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Platform</th>
                  <th className="px-4 py-3 text-right">Reference</th>
                  <th className="px-4 py-3 text-right">On-chain</th>
                  <th className="px-4 py-3 text-right">Spread</th>
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filtered.map(({ asset, quote, spread, marketStatus }) => {
                  const signal =
                    spread.percent !== null && Math.abs(Number(spread.percent)) >= 0.5
                      ? "WATCH"
                      : "NO_SIGNAL";
                  return (
                    <tr
                      key={`${asset.chainId}:${asset.tokenContractAddress}`}
                      className="hover:bg-zinc-800/30"
                    >
                      <td className="px-4 py-2.5 font-mono">
                        <Link
                          href={`/markets/${encodeURIComponent(asset.underlyingTicker)}`}
                          className="text-amber-400 hover:underline"
                        >
                          {asset.underlyingTicker || "—"}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-zinc-100">{asset.underlyingName || "Unavailable"}</p>
                        <p className="text-xs text-zinc-500">{asset.tokenSymbol}</p>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                        {asset.platformId}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {formatUsd(quote.referencePrice?.value)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {formatUsd(quote.onChainPrice?.value)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono ${
                          spread.percent !== null
                            ? Number(spread.percent) >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                            : "text-zinc-500"
                        }`}
                      >
                        {formatPercent(spread.percent)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge
                          tone={toneForStatus(marketStatus?.marketStatus ?? "UNKNOWN")}
                          label={marketStatus?.marketStatus ?? "UNKNOWN"}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge tone={toneForStatus(signal)} label={signal} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </main>
  );
}
