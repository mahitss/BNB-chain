"use client";

/** Opportunities grouped by status, from the deterministic engine only. */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { formatPercent, timeAgo } from "../../lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toneForStatus,
} from "../../components/ui";
import type { MarketOpportunity } from "@olyr/types";

const GROUPS = ["OPPORTUNITY", "WATCH", "BLOCKED", "DATA_UNAVAILABLE"] as const;

interface OpportunitiesResponse {
  opportunities: MarketOpportunity[];
  lastScanAt: string | null;
  configurationStatus?: "CONFIGURED" | "NOT_CONFIGURED";
  configurationDetail?: string;
}

export default function OpportunitiesPage() {
  const query = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => apiGet<OpportunitiesResponse>("/api/opportunities"),
    refetchInterval: 30_000,
  });

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-4xl">
        <PageHeader eyebrow="OLYR · Opportunities" title="Divergence Signals" />
        <div className="mt-6">
          <Card className="p-5">
            <Skeleton lines={5} />
          </Card>
        </div>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="mx-auto max-w-4xl">
        <PageHeader eyebrow="OLYR · Opportunities" title="Divergence Signals" />
        <div className="mt-6">
          <ErrorState
            message={
              query.error instanceof Error ? query.error.message : "Opportunities unavailable."
            }
            onRetry={() => void query.refetch()}
          />
        </div>
      </main>
    );
  }

  const all = query.data.opportunities;

  return (
    <main className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="OLYR · Opportunities"
        title="Divergence Signals"
        meta={`scan ${timeAgo(query.data.lastScanAt)}`}
      />
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-zinc-500">
        Signals are produced by OLYR&apos;s deterministic rule engine. Terminology is deliberate:
        price divergence is an observation, never a profit claim.
      </p>

      {all.length === 0 ? (
        <div className="mt-6">
          {query.data.configurationStatus === "NOT_CONFIGURED" ? (
            <EmptyState
              title="Market data unavailable"
              detail={
                query.data.configurationDetail ??
                "Configure BINANCE_API_KEY and BINANCE_API_SECRET in the API environment to enable the scanner."
              }
            />
          ) : (
            <EmptyState
              title="No opportunities detected."
              detail="The scanner completed its last run and every evaluated asset is within configured thresholds."
            />
          )}
        </div>
      ) : (
        GROUPS.map((group) => {
          const groupItems = all.filter((o) => o.status === group);
          if (groupItems.length === 0) return null;
          return (
            <Card key={group} className="mt-6">
              <CardHeader title={group.replace("_", " ")} meta={String(groupItems.length)} />
              <ul className="divide-y divide-zinc-800">
                {groupItems.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/opportunities/${encodeURIComponent(o.id)}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-zinc-800/30"
                    >
                      <span className="font-mono text-sm text-zinc-100">{o.ticker}</span>
                      <span className="flex items-center gap-4">
                        <span className="font-mono text-sm text-zinc-300">
                          {formatPercent(o.spreadPercent)}
                        </span>
                        <span className="text-xs text-zinc-500">{o.marketState}</span>
                        <StatusBadge tone={toneForStatus(o.status)} label={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </main>
  );
}
