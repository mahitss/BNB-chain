"use client";

/** Execution detail: full state timeline from the persisted record, tx hash
 * with a BscScan link ONLY when a real hash exists. */
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../../lib/api";
import { explorerTxUrl } from "../../../lib/format";
import {
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toneForStatus,
} from "../../../components/ui";
import type { ExecutionRecord } from "@olyr/types";

const TIMELINE: string[] = [
  "CREATED",
  "RISK_APPROVED",
  "QUOTE_REQUESTED",
  "QUOTE_RECEIVED",
  "SIMULATION_REQUESTED",
  "SIMULATION_PASSED",
  "AWAITING_AUTHORIZATION",
  "AUTHORIZED",
  "BROADCAST_REQUESTED",
  "BROADCAST",
  "CONFIRMING",
  "CONFIRMED",
];

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useQuery({
    queryKey: ["execution", id],
    queryFn: () => apiGet<ExecutionRecord>(`/api/executions/${encodeURIComponent(id)}`),
    refetchInterval: 10_000,
  });

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-3xl">
        <PageHeader eyebrow="OLYR · Execution" title="Detail" />
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
        <PageHeader eyebrow="OLYR · Execution" title="Detail" />
        <div className="mt-6">
          <ErrorState
            message={query.error instanceof Error ? query.error.message : "Execution unavailable."}
            onRetry={() => void query.refetch()}
          />
        </div>
      </main>
    );
  }

  const e = query.data;
  const currentIndex = TIMELINE.indexOf(e.state);
  const explorer = explorerTxUrl(e.txHash);
  const reached = (state: string) => currentIndex >= TIMELINE.indexOf(state) && currentIndex !== -1;

  return (
    <main className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="OLYR · Execution"
        title={e.proposalId.slice(0, 18)}
        meta={
          <Link href="/executions" className="text-amber-400 hover:underline">
            ← executions
          </Link>
        }
      />

      <Card className="mt-6">
        <CardHeader title="State" meta={`environment ${e.environment ?? "DRY_RUN"}`} />
        <div className="flex items-center gap-3 p-5">
          <StatusBadge tone={toneForStatus(e.state)} label={e.state} />
          {e.failureReason && <p className="text-xs text-red-300">Reason: {e.failureReason}</p>}
        </div>
        <div className="border-t border-zinc-800 px-5 py-4">
          <ol className="space-y-2">
            {TIMELINE.map((state) => {
              const done = reached(state);
              const isCurrent = e.state === state;
              return (
                <li key={state} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${
                      done ? "bg-emerald-400" : "bg-zinc-700"
                    } ${isCurrent ? "ring-2 ring-zinc-600" : ""}`}
                  />
                  <span className={`font-mono text-xs ${done ? "text-zinc-200" : "text-zinc-600"}`}>
                    {state}
                    {isCurrent ? " ←" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          {e.state !== "CONFIRMED" && e.failureReason && (
            <p className="mt-3 text-xs text-red-300">Failed after: {e.failureReason}</p>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Transaction" />
        <div className="p-5 text-sm">
          {e.txHash ? (
            <div>
              <p className="font-mono text-xs break-all text-zinc-200">{e.txHash}</p>
              {explorer && (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-amber-400 hover:underline"
                >
                  View on BscScan ↗
                </a>
              )}
            </div>
          ) : (
            <p className="text-zinc-500">
              No transaction hash. A hash appears only after a real broadcast.
            </p>
          )}
        </div>
      </Card>
    </main>
  );
}
