"use client";

/** Asset detail: identity, prices, spread, market state, liquidity, and the
 * opportunity status. Historical charts require real history — none exists,
 * so the section says so instead of fabricating points. */
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../../lib/api";
import { formatPercent, formatUsd, timeAgo } from "../../../lib/format";
import {
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  toneForStatus,
} from "../../../components/ui";
import type { MarketSnapshot } from "@olyr/types";

export default function AssetDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const snapshotQuery = useQuery({
    queryKey: ["snapshot", ticker],
    queryFn: () => apiGet<MarketSnapshot>(`/api/market/${encodeURIComponent(ticker)}/snapshot`),
    refetchInterval: 30_000,
  });

  if (snapshotQuery.isPending) {
    return (
      <main className="mx-auto max-w-4xl">
        <PageHeader eyebrow="OLYR · Market" title={ticker} />
        <div className="mt-6">
          <Card className="p-5">
            <Skeleton lines={6} />
          </Card>
        </div>
      </main>
    );
  }

  if (snapshotQuery.isError) {
    return (
      <main className="mx-auto max-w-4xl">
        <PageHeader eyebrow="OLYR · Market" title={ticker} />
        <div className="mt-6">
          <ErrorState
            message={
              snapshotQuery.error instanceof Error
                ? snapshotQuery.error.message
                : "Snapshot unavailable."
            }
            onRetry={() => void snapshotQuery.refetch()}
          />
        </div>
      </main>
    );
  }

  const s = snapshotQuery.data;
  return (
    <main className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="OLYR · Market"
        title={s.ticker}
        meta={
          <Link href="/markets" className="text-amber-400 hover:underline">
            ← markets
          </Link>
        }
      />

      <Card className="mt-6">
        <CardHeader
          title={`${s.tokenName} · ${s.platformId}`}
          meta={`source ${s.source} · updated ${timeAgo(s.timestamp)}`}
        />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
          <Stat label="On-chain price" value={formatUsd(s.onChainPrice)} />
          <Stat label="Reference price" value={formatUsd(s.referencePrice)} />
          <Stat
            label="Spread"
            value={formatPercent(s.divergence.spreadPercent)}
            tone={
              s.divergence.direction === "PREMIUM"
                ? "pass"
                : s.divergence.direction === "DISCOUNT"
                  ? "fail"
                  : "neutral"
            }
          />
          <Stat label="Market state" value={s.marketState} tone={toneForStatus(s.marketState)} />
          <Stat
            label="Reference freshness"
            value={s.referenceFreshness}
            tone={toneForStatus(s.referenceFreshness)}
          />
          <Stat
            label="Liquidity"
            value={s.liquidity.status}
            tone={toneForStatus(s.liquidity.status === "AVAILABLE" ? "FRESH" : s.liquidity.status)}
            hint={
              s.liquidity.totalLiquidityUsd ? `${s.liquidity.poolCount ?? "?"} pools` : undefined
            }
          />
        </div>
        {s.warnings.length > 0 && (
          <div className="border-t border-zinc-800 px-5 py-3">
            <ul className="space-y-1 text-xs text-amber-300/90">
              {s.warnings.map((w, i) => (
                <li key={i}>
                  <span aria-hidden>! </span>
                  {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Price history" />
        <div className="p-5">
          <p className="text-sm text-zinc-400">
            Historical data unavailable. OLYR retains snapshots from scan history only; charts are
            never fabricated from synthetic points.
          </p>
        </div>
      </Card>
    </main>
  );
}
