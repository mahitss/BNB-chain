"use client";

/**
 * RWA Data page — real tokenized-equity data served by OLYR's API
 * (which proxies the official Binance Web3 RWA endpoints).
 *
 * Rules of this page:
 * - Every value comes from the API response; missing fields render
 *   "Unavailable" and are never fabricated.
 * - A 503 "not-configured" response shows setup instructions, not fake data.
 * - The reference price is Binance's derived per-share conversion and is
 *   labeled as such (per the official field documentation).
 */
import { useQuery } from "@tanstack/react-query";
import { fetchRwaAssets, ApiRequestError } from "../../lib/api";
import { RWA_ASSET_TYPE_LABELS } from "@olyr/types";

function formatUsd(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Unavailable";
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "Unavailable";
  }
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function formatSpread(spread: { percent: string | null; invalidReason: string | null }): string {
  if (spread.percent !== null) {
    const num = Number(spread.percent);
    const sign = num > 0 ? "+" : "";
    return `${sign}${num.toFixed(2)}%`;
  }
  if (spread.invalidReason === "zero-reference-price") {
    return "Unavailable (zero reference price)";
  }
  return "Unavailable";
}

const MARKET_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  regular: {
    label: "Market open",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  premarket: {
    label: "Pre-market",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  postmarket: {
    label: "Post-market",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  overnight: { label: "Overnight", className: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  closed: { label: "Closed", className: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" },
  pause: { label: "Halted", className: "bg-red-500/15 text-red-400 border-red-500/30" },
};

function MarketStatusBadge({
  status,
}: {
  status: import("@olyr/types").RwaMarketStatusInfo | null;
}) {
  if (!status) {
    return <span className="text-xs text-zinc-500">Unavailable</span>;
  }
  const known = MARKET_STATUS_LABELS[status.marketStatus];
  const label = known ? known.label : status.marketStatus;
  const className = known ? known.className : MARKET_STATUS_LABELS["closed"]!.className;
  const title = status.reasonMsg ?? status.reasonCode ?? undefined;
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-xs ${className}`} title={title}>
      {label}
    </span>
  );
}

export default function RwaPage() {
  const assetsQuery = useQuery({
    queryKey: ["rwa-assets"],
    queryFn: () => fetchRwaAssets(),
  });

  if (assetsQuery.isPending) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <p className="font-mono text-sm text-zinc-400">Loading RWA data…</p>
      </main>
    );
  }

  if (assetsQuery.isError) {
    const notConfigured =
      assetsQuery.error instanceof ApiRequestError &&
      assetsQuery.error.body?.category === "not-configured";
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-50">RWA Data</h1>
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          {notConfigured ? (
            <>
              <p className="font-semibold">Binance Web3 API credentials are not configured.</p>
              <p className="mt-2 text-amber-200/80">
                To display live tokenized-stock data, create an API key at the Binance Web3
                developer portal and set <code className="font-mono">BINANCE_API_KEY</code> and{" "}
                <code className="font-mono">BINANCE_API_SECRET</code> in the API service environment
                (see <code className="font-mono">.env.example</code>), then restart the API. OLYR
                deliberately shows no market data until real credentials are configured.
              </p>
            </>
          ) : (
            <p>
              Failed to load RWA data:{" "}
              {assetsQuery.error instanceof Error ? assetsQuery.error.message : "unknown error"}
            </p>
          )}
        </div>
      </main>
    );
  }

  const { assets, chainId, retrievedAt } = assetsQuery.data;

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">
            Binance Web3 · RWA Data
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Tokenized Stocks</h1>
        </div>
        <p className="font-mono text-xs text-zinc-500">
          chain {chainId} · updated{" "}
          {new Date(retrievedAt).toLocaleTimeString("en-US", { hour12: false })}
        </p>
      </header>

      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-zinc-500">
        On-chain prices and reference prices come from the Binance Web3 Market API. The reference
        price is a per-share conversion derived from the on-chain token price — not an official
        quote from the traditional stock market. Market status is reported by Binance, not inferred.
      </p>

      {assets.length === 0 ? (
        <p className="mt-10 rounded-lg border border-zinc-800 px-4 py-6 text-sm text-zinc-400">
          The API returned no RWA assets for this chain. This can happen when the Binance token list
          is empty for the configured chain (BINANCE_CHAIN_ID).
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 font-mono text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Ticker</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3 text-right">On-chain price</th>
                <th className="px-4 py-3 text-right">Reference price</th>
                <th className="px-4 py-3 text-right">Spread</th>
                <th className="px-4 py-3">Market</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {assets.map(({ asset, quote, spread, marketStatus }) => (
                <tr
                  key={`${asset.chainId}:${asset.tokenContractAddress}`}
                  className="text-zinc-200"
                >
                  <td className="px-4 py-3 font-mono">{asset.underlyingTicker || "—"}</td>
                  <td className="px-4 py-3">
                    <p className="text-zinc-100">{asset.underlyingName || "Unavailable"}</p>
                    <p className="text-xs text-zinc-500">
                      {asset.tokenSymbol} ·{" "}
                      {RWA_ASSET_TYPE_LABELS[asset.assetType] ?? "Unavailable"}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                    {asset.platformId || "Unavailable"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatUsd(quote.onChainPrice?.value)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatUsd(quote.referencePrice?.value)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      spread.percent !== null
                        ? Number(spread.percent) >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                        : "text-zinc-500"
                    }`}
                  >
                    {formatSpread(spread)}
                  </td>
                  <td className="px-4 py-3">
                    <MarketStatusBadge status={marketStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
