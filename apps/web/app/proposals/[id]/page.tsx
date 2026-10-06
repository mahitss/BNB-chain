"use client";

/** Proposal detail: strategy → risk → quote → simulation → authorization
 * chain, with actions that reflect the actual state machine. */
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
  StatusBadge,
  toneForStatus,
} from "../../../components/ui";
import type { RiskDecision, TradeProposal } from "@olyr/types";

interface ProposalDetail extends TradeProposal {
  evaluations: Array<Record<string, unknown>>;
}

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useQuery({
    queryKey: ["proposal", id],
    queryFn: () => apiGet<ProposalDetail>(`/api/proposals/${encodeURIComponent(id)}`),
    refetchInterval: 15_000,
  });

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-3xl">
        <PageHeader eyebrow="OLYR · Proposal" title="Detail" />
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
        <PageHeader eyebrow="OLYR · Proposal" title="Detail" />
        <div className="mt-6">
          <ErrorState
            message={query.error instanceof Error ? query.error.message : "Proposal unavailable."}
            onRetry={() => void query.refetch()}
          />
        </div>
      </main>
    );
  }

  const p = query.data;
  const decision: RiskDecision | null = p.riskDecision;

  return (
    <main className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="OLYR · Proposal"
        title={`${p.asset} — ${p.action.replace(/_/g, " ")}`}
        meta={
          <Link href="/proposals" className="text-amber-400 hover:underline">
            ← proposals
          </Link>
        }
      />

      <Card className="mt-6">
        <CardHeader title="Proposal" meta={`created ${timeAgo(p.createdAt)}`} />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <Stat label="Requested" value={formatUsd(p.requestedAmountUsd)} />
          <Stat label="Estimated price" value={formatUsd(p.estimatedPrice)} />
          <Stat label="Reference" value={formatUsd(p.referencePrice)} />
          <Stat label="Divergence" value={formatPercent(p.spreadPercent)} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 px-5 py-3">
          <StatusBadge tone={toneForStatus(p.status)} label={p.status} />
          <span className="text-xs text-zinc-500">
            Expires {new Date(p.expiresAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
          {p.strategyName && (
            <span className="text-xs text-zinc-500">
              From strategy: <span className="text-zinc-300">{p.strategyName}</span>
            </span>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Risk evaluation" />
        <div className="p-5">
          {decision ? (
            <>
              <StatusBadge tone={toneForStatus(decision.decision)} label={decision.decision} />
              <ul className="mt-3 space-y-1 text-xs">
                {decision.rulesPassed.map((rule) => (
                  <li key={rule} className="font-mono text-emerald-400">
                    ✓ {rule} · PASS
                  </li>
                ))}
                {decision.requiresReview.map((rule) => (
                  <li key={rule} className="font-mono text-amber-400">
                    ! {rule} · REVIEW — human review required before any further step
                  </li>
                ))}
                {decision.rulesFailed.map((rule) => (
                  <li key={rule.rule} className="font-mono text-red-400">
                    × {rule.rule} · FAIL
                    {rule.reason && (
                      <span className="block pl-4 font-sans text-red-300/80">{rule.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-zinc-500">
                {p.evaluations.length} evaluation(s) recorded; history is immutable.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              Risk evaluation pending. POST /api/proposals/{id}/evaluate-risk runs the Rust engine
              on the stored inputs.
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Chain of custody" />
        <div className="p-5 text-sm text-zinc-300">
          <ul className="space-y-1 font-mono text-xs">
            <li>proposal: {p.id}</li>
            <li>strategy: {p.strategyId ?? "—"}</li>
            <li>evaluations: {p.evaluations.length}</li>
          </ul>
        </div>
      </Card>
    </main>
  );
}
