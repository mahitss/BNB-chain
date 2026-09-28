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
