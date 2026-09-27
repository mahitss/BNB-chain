"use client";

/**
 * Trade-proposal review interface (Phase 5). Risk decisions come from the
 * deterministic Rust engine; explanations are generated from structured rule
 * results. There is deliberately NO execute button: OLYR cannot broadcast
 * transactions yet, and the UI says so.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiRequestError, get as apiGet } from "../../lib/api";
import {
  authorizeProposal,
  createExecution,
  estimateFromSimulation,
  simulateProposal,
  type SimulationResponse,
} from "../../lib/execution-api";
import type { ExecutionRecord, RiskDecision, TradeProposal } from "@olyr/types";

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

      <ExecutionFlow proposalId={proposal.id} status={proposal.status} />

      {proposal.txHash && (
        <p className="mt-3 font-mono text-xs text-zinc-400">
          Transaction: <span className="text-zinc-200">{proposal.txHash}</span>
        </p>
      )}
    </article>
  );
}

/**
 * Execution flow (Phase 6): SIMULATE → APPROVE & EXECUTE (explicit, MANUAL
 * policy) → execution status. Success states are rendered ONLY from API
 * responses — never fabricated. Without live Binance credentials the
 * simulation step fails honestly, and the UI says so.
 */
function ExecutionFlow({ proposalId, status }: { proposalId: string; status: string }) {
  const [simulation, setSimulation] = useState<SimulationResponse | null>(null);
  const [execution, setExecution] = useState<ExecutionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const approved = status === "APPROVED";

  const runSimulation = async () => {
    setError(null);
    setConfirming(true);
    try {
      setSimulation(await simulateProposal(proposalId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "simulation failed");
    } finally {
      setConfirming(false);
    }
  };

  const approveAndExecute = async () => {
    setError(null);
    setConfirming(true);
    try {
      await authorizeProposal(proposalId, "APPROVE");
      const record = await createExecution(proposalId);
      setExecution(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : "execution failed");
    } finally {
      setConfirming(false);
    }
  };

  const reject = async () => {
    setError(null);
    try {
      await authorizeProposal(proposalId, "REJECT");
      setError("Proposal rejected by the user. No transaction was created.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "rejection failed");
    }
  };

  if (!approved) {
    return (
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <span
          className="cursor-not-allowed rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-500"
          title="Execution requires an APPROVED risk decision"
        >
          EXECUTION NOT ENABLED
        </span>
      </div>
    );
  }

  const sim = simulation ? estimateFromSimulation(simulation) : null;

  return (
    <div className="mt-4 space-y-3 border-t border-zinc-800 pt-3">
      {!simulation && (
        <button
          type="button"
          onClick={runSimulation}
          disabled={confirming}
          className="rounded border border-amber-500/50 bg-amber-500/10 px-4 py-1.5 font-mono text-xs text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
        >
          {confirming ? "SIMULATING…" : "SIMULATE TRADE"}
        </button>
      )}

      {simulation && (
        <div
          className={`rounded border p-3 text-xs leading-relaxed ${
            simulation.status === "PASSED"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
              : simulation.status === "FAILED"
                ? "border-red-500/30 bg-red-500/5 text-red-300"
                : "border-amber-500/30 bg-amber-500/5 text-amber-300"
          }`}
        >
          <p className="font-mono font-semibold">SIMULATION {simulation.status}</p>
          {simulation.failReason && <p className="mt-1">Reason: {simulation.failReason}</p>}
          {sim && (
            <p className="mt-1 text-zinc-400">
              Expected output: {sim.expectedOutput} · Fees: {sim.fees} · Slippage: {sim.slippage}
            </p>
          )}
          <p className="mt-1 text-zinc-500">
            Simulated at{" "}
            {new Date(simulation.timestamp).toLocaleTimeString("en-US", { hour12: false })}
          </p>
        </div>
      )}

      {simulation?.status === "PASSED" && !execution && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={approveAndExecute}
            disabled={confirming}
            className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-1.5 font-mono text-xs text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {confirming ? "EXECUTING…" : "APPROVE & EXECUTE"}
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={confirming}
            className="rounded border border-zinc-700 px-4 py-1.5 font-mono text-xs text-zinc-400 transition-colors hover:border-red-500/40 hover:text-red-400 disabled:opacity-40"
          >
            REJECT
          </button>
        </div>
      )}

      {execution && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-300">
          <p className="font-mono font-semibold">EXECUTION {execution.state}</p>
          {execution.txHash && (
            <p className="mt-1 font-mono break-all">Transaction: {execution.txHash}</p>
          )}
          {execution.state === "CONFIRMED" && <p className="mt-1">Portfolio updated.</p>}
          {execution.failureReason && (
            <p className="mt-1 text-red-300">Reason: {execution.failureReason}</p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
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
            <div key={proposal.id} className="relative">
              <ProposalCard proposal={proposal} />
              <Link
                href={`/proposals/${encodeURIComponent(proposal.id)}`}
                className="absolute right-4 top-4 font-mono text-xs text-amber-400 hover:underline"
              >
                VIEW DETAILS →
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
