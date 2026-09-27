"use client";

/** Executions list: only real backend state. BROADCAST != CONFIRMED and the
 * UI never pretends otherwise. */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { formatClock } from "../../lib/format";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toneForStatus,
} from "../../components/ui";
import type { ExecutionRecord } from "@olyr/types";

export default function ExecutionsPage() {
  const query = useQuery({
    queryKey: ["executions"],
    queryFn: () => apiGet<{ executions: ExecutionRecord[] }>("/api/executions"),
    refetchInterval: 15_000,
  });

  if (query.isPending) {
    return (
      <main className="mx-auto max-w-4xl">
        <PageHeader eyebrow="OLYR · Executions" title="Execution History" />
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
        <PageHeader eyebrow="OLYR · Executions" title="Execution History" />
        <div className="mt-6">
          <ErrorState
            message={query.error instanceof Error ? query.error.message : "Executions unavailable."}
            onRetry={() => void query.refetch()}
          />
        </div>
      </main>
    );
  }

  const executions = query.data.executions;

  return (
    <main className="mx-auto max-w-4xl">
      <PageHeader eyebrow="OLYR · Executions" title="Execution History" />
      {executions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No executions yet."
            detail="Executions appear after a proposal passes every gate and an authorized broadcast succeeds. OLYR has not broadcast any transaction."
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 font-mono text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {executions.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-800/30">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/executions/${encodeURIComponent(e.id)}`}
                      className="font-mono text-amber-400 hover:underline"
                    >
                      {e.proposalId.slice(0, 14)}…
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge tone={toneForStatus(e.state)} label={e.state} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">—</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                    {e.txHash ? `${e.txHash.slice(0, 12)}…` : (e.orderId ?? "—")}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">
                    {formatClock(e.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </main>
  );
}
