"use client";

/** Opportunity detail: WHY detected + WHAT prevents execution, generated
 * from structured rule results (never LLM text, never profit language). */
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../../lib/api";
import { formatPercent, formatUsd } from "../../../lib/format";
import {
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toneForStatus,
} from "../../../components/ui";
import type { MarketOpportunity } from "@olyr/types";

export default function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useQuery({
    queryKey: ["opportunity", id],
    queryFn: () => apiGet<MarketOpportunity>(`/api/opportunities/id/${encodeURIComponent(id)}`),
  });

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-3xl">
        <PageHeader eyebrow="OLYR · Opportunity" title="Detail" />
        <div className="mt-6">
          <Card className="p-5">
            <Skeleton lines={6} />
          </Card>
        </div>
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="mx-auto max-w-3xl">
        <PageHeader eyebrow="OLYR · Opportunity" title="Detail" />
        <div className="mt-6">
          <ErrorState
            message={
              query.error instanceof Error ? query.error.message : "Opportunity unavailable."
            }
            onRetry={() => void query.refetch()}
          />
        </div>
      </main>
    );
  }

  const o = query.data;
  return (
    <main className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="OLYR · Opportunity"
        title={`${o.ticker} — ${o.status}`}
        meta={
          <Link href="/opportunities" className="text-amber-400 hover:underline">
            ← opportunities
          </Link>
        }
      />

      <Card className="mt-6">
        <CardHeader title="Signal" meta={`evaluated ${o.timestamp}`} />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Divergence</p>
            <p className="mt-0.5 font-mono text-xl text-zinc-100">
              {formatPercent(o.spreadPercent)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Direction</p>
            <p className="mt-0.5 font-mono text-xl text-zinc-100">{o.direction}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Market state</p>
            <p className="mt-0.5 font-mono text-xl text-zinc-100">{o.marketState}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">On-chain</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-200">{formatUsd(o.onChainPrice)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Reference</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-200">{formatUsd(o.referencePrice)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">Reference freshness</p>
            <StatusBadge tone={toneForStatus(o.referenceFreshness)} label={o.referenceFreshness} />
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Why this was detected" />
        <ul className="space-y-1.5 p-5 text-sm text-zinc-300">
          {o.reasons.map((reason, i) => (
            <li key={i}>
              <span aria-hidden>• </span>
              {reason.message}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <CardHeader title="What prevents execution" />
        <div className="p-5">
          {o.warnings.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No warnings recorded. Execution still requires the full gate chain: quote, simulation,
              authorization, and policy checks.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm text-amber-300/90">
              {o.warnings.map((warning, i) => (
                <li key={i}>
                  <span aria-hidden>! </span>
                  {warning.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </main>
  );
}
