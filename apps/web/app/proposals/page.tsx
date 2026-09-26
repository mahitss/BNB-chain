"use client";

/**
 * Trade-proposal review interface (Phase 5). Risk decisions come from the
 * deterministic Rust engine; explanations are generated from structured rule
 * results. There is deliberately NO execute button: OLYR cannot broadcast
 * transactions yet, and the UI says so.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError, get as apiGet } from "../../lib/api";
import type { RiskDecision, TradeProposal } from "@olyr/types";

interface ProposalsResponse {
  proposals: TradeProposal[];
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
  REQUIRES_REVIEW: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  PENDING_RISK: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  EXPIRED: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30",
};

function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function RiskChecks({ decision }: { decision: RiskDecision | null }) {
  if (!decision) {
    return (
      <p className="text-xs text-zinc-500">
        Risk evaluation pending — run it from the API (POST /api/proposals/:id/evaluate-risk).
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-1">
      <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Risk checks</p>
      <ul className="space-y-0.5 text-sm">
        {decision.rulesPassed.map((rule) => (
          <li key={rule} className="text-emerald-400 font-mono text-xs">
            ✓ {rule}
          </li>
        ))}
        {decision.rulesFailed.map((rule) => (
          <li key={rule.rule} className="text-red-400 font-mono text-xs">
            ✗ {rule.rule}
            {rule.reason && (
              <span className="block pl-4 font-sans text-xs text-red-300/80">{rule.reason}</span>
            )}
          </li>
        ))}
      </ul>
      {decision.warnings.length > 0 && (
        <ul className="space-y-0.5 pt-1 text-xs text-amber-300/90">
          {decision.warnings.map((warning, index) => (
            <li key={index}>⚠ {warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: TradeProposal }) {
  const statusStyle = STATUS_STYLES[proposal.status] ?? STATUS_STYLES["PENDING_RISK"];
  return (
    <article className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-mono text-lg font-semibold text-zinc-50">{proposal.asset}</h3>
          <p className="text-xs text-zinc-500">{proposal.action.replace(/_/g, " ")}</p>
        </div>
        <span className={`rounded border px-2 py-0.5 font-mono text-xs ${statusStyle}`}>
          {proposal.status}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Requested</dt>
          <dd className="font-mono text-zinc-200">{usd(proposal.requestedAmountUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Estimated price</dt>
          <dd className="font-mono text-zinc-200">{usd(proposal.estimatedPrice)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Reference</dt>
          <dd className="font-mono text-zinc-200">{usd(proposal.referencePrice)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-zinc-500">Divergence</dt>
          <dd className="font-mono text-zinc-200">
            {proposal.spreadPercent !== null ? `${proposal.spreadPercent}%` : "Unavailable"}
          </dd>
        </div>
      </dl>

      <RiskChecks decision={proposal.riskDecision} />

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <span
          className="cursor-not-allowed rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-500"
          title="Trading arrives in a later phase"
        >
          EXECUTION NOT ENABLED
        </span>
      </div>
    </article>
  );
}

export default function ProposalsPage() {
  const proposalsQuery = useQuery({
    queryKey: ["proposals"],
    queryFn: () => apiGet<ProposalsResponse>("/api/proposals"),
    refetchInterval: 30_000,
  });

  if (proposalsQuery.isPending) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="font-mono text-sm text-zinc-400">Loading proposals…</p>
      </main>
    );
  }

  if (proposalsQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-50">Trade Proposals</h1>
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          {proposalsQuery.error instanceof ApiRequestError &&
          proposalsQuery.error.body?.category === "not-configured" ? (
            <p>
              The proposal pipeline requires PostgreSQL (DATABASE_URL). See .env.example and
              docker-compose.yml.
            </p>
          ) : (
            <p>
              Failed to load proposals:{" "}
              {proposalsQuery.error instanceof Error ? proposalsQuery.error.message : "unknown"}
            </p>
          )}
        </div>
      </main>
    );
  }

  const proposals = proposalsQuery.data.proposals;

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">
          OLYR · Trade Proposals
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Proposal review</h1>
      </header>

      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-zinc-500">
        Every proposal is evaluated by OLYR&apos;s deterministic Rust risk engine against platform
        hard limits. Nothing is ever executed automatically — and OLYR cannot execute trades at all
        in this phase.
      </p>

      {proposals.length === 0 ? (
        <p className="mt-8 rounded-lg border border-zinc-800 px-4 py-6 text-sm leading-relaxed text-zinc-400">
          No proposals yet. Proposals are created from saved strategies (POST /api/proposals with a
          strategyId) when market intelligence detects the configured conditions.
        </p>
      ) : (
        <div className="mt-8 grid gap-4">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </main>
  );
}
