"use client";

/** Agent activity timeline from persisted AgentEvent records. Every entry
 * comes from real backend state — nothing is fabricated. */
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { formatClock } from "../../lib/format";
import { EmptyState } from "../../components/ui";

interface AgentEventRecord {
  id: string;
  type: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

const FRIENDLY: Record<string, string> = {
  STRATEGY_REQUESTED: "Strategy parse requested",
  STRATEGY_PARSED: "Strategy parsed",
  VALIDATION_STARTED: "Validation started",
  VALIDATION_PASSED: "Validation passed",
  VALIDATION_FAILED: "Validation failed",
  CLARIFICATION_REQUIRED: "Clarification required",
  STRATEGY_SAVED: "Strategy saved",
  STRATEGY_ACTIVATED: "Strategy activated",
  STRATEGY_PAUSED: "Strategy paused",
  STRATEGY_EVALUATED: "Strategy evaluated",
  OPPORTUNITY_MATCHED: "Opportunity matched",
  PROPOSAL_CREATED: "Trade proposal created",
  RISK_EVALUATION_COMPLETED: "Risk evaluation completed",
  QUOTE_REQUESTED: "Quote requested",
  QUOTE_RECEIVED: "Quote received",
  SIMULATION_REQUESTED: "Simulation requested",
  SIMULATION_PASSED: "Simulation passed",
  SIMULATION_FAILED: "Simulation failed",
  AUTHORIZATION_REQUESTED: "Authorization requested",
  AUTHORIZED: "Authorized",
  REJECTED: "Rejected",
  BROADCAST_REQUESTED: "Broadcast requested",
  BROADCASTED: "Transaction submitted",
  CONFIRMED: "Transaction confirmed",
  EXECUTION_FAILED: "Execution failed",
};

export default function Timeline() {
  const query = useQuery({
    queryKey: ["agent-events"],
    queryFn: () => apiGet<{ events: AgentEventRecord[] }>("/api/agent/events?limit=30"),
    refetchInterval: 20_000,
  });

  if (query.isPending) {
    return <p className="text-sm text-zinc-500">Loading activity…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-zinc-500">Activity unavailable.</p>;
  }
  const events = query.data.events;
  if (events.length === 0) {
    return (
      <EmptyState
        title="No activity recorded yet."
        detail="Events appear as the agent parses strategies, the loop runs, and proposals move through the pipeline."
      />
    );
  }
  const latest = events.slice(0, 5);
  const earlier = events.slice(5);
  const renderEvent = (event: AgentEventRecord) => (
    <li key={event.id} className="flex items-baseline gap-3 text-sm">
      <span className="font-mono text-xs text-zinc-500">{formatClock(event.createdAt)}</span>
      <span className="text-zinc-200">{FRIENDLY[event.type] ?? event.type}</span>
      {event.detail?.["proposalId"] !== undefined && (
        <span className="font-mono text-xs text-zinc-500">
          {String(event.detail["proposalId"]).slice(0, 12)}…
        </span>
      )}
      {event.detail?.["name"] !== undefined && (
        <span className="truncate text-xs text-zinc-500">{String(event.detail["name"])}</span>
      )}
    </li>
  );
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
        Latest activity
      </p>
      <ol className="mt-2 space-y-2">{latest.map(renderEvent)}</ol>
      {earlier.length > 0 && (
        <>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-widest text-zinc-600">
            Earlier history
          </p>
          <ol className="mt-2 space-y-2 opacity-80">{earlier.map(renderEvent)}</ol>
        </>
      )}
    </div>
  );
}
