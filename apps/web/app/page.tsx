"use client";

/**
 * Overview dashboard — answers "what is happening right now" from real
 * backend state only: market status, portfolio (when the wallet exists),
 * live opportunities, strategies, agent, executions.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../lib/api";
import { formatPercent, timeAgo } from "../lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
  Stat,
  StatusBadge,
  toneForStatus,
} from "../components/ui";
import type { MarketOpportunity, StrategyRecord } from "@olyr/types";

interface GlobalState {
  usEquities: string;
  onChainMarket: string;
  onChainMarketDetail: string;
  timestamp: string;
}

interface OpportunitiesResponse {
  opportunities: MarketOpportunity[];
  lastScanAt: string | null;
}

interface AgentStatus {
  loopEnabled: boolean;
  activeStrategies: number;
  totalStrategies: number;
  lastScanAt: string | null;
}

interface ExecutionsResponse {
  executions: Array<{ id: string; state: string; asset: string; createdAt: string }>;
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-5">
          <Skeleton lines={4} />
        </Card>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const globalState = useQuery({
    queryKey: ["market-state"],
    queryFn: () => apiGet<GlobalState>("/api/market/state"),
    refetchInterval: 60_000,
  });
  const opportunities = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => apiGet<OpportunitiesResponse>("/api/opportunities"),
    refetchInterval: 30_000,
  });
  const agent = useQuery({
    queryKey: ["agent-status"],
    queryFn: () => apiGet<AgentStatus>("/api/agent/status"),
    refetchInterval: 60_000,
  });
  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: () => apiGet<{ strategies: StrategyRecord[] }>("/api/strategies"),
  });
  const executions = useQuery({
    queryKey: ["executions"],
    queryFn: () => apiGet<ExecutionsResponse>("/api/executions"),
    refetchInterval: 30_000,
  });

  const loading = globalState.isPending || opportunities.isPending || agent.isPending;
  if (loading) {
    return (
      <main className="mx-auto max-w-6xl">
        <PageHeader eyebrow="OLYR" title="Overview" />
        <div className="mt-6">
          <DashboardSkeleton />
        </div>
      </main>
    );
  }

  const gs = globalState.data;
  const opps = opportunities.data?.opportunities ?? [];
  const notable = opps.filter(
    (o) => o.status === "OPPORTUNITY" || o.status === "WATCH" || o.status === "BLOCKED",
  );
  const agentData = agent.data;
  const execs = executions.data?.executions ?? [];
  const confirmedToday = execs.filter(
    (e) =>
      e.state === "CONFIRMED" && new Date(e.createdAt).toDateString() === new Date().toDateString(),
  ).length;

  return (
    <main className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="OLYR"
        title="Overview"
        meta={gs ? `updated ${timeAgo(gs.timestamp)}` : undefined}
      />

      {/* Market status */}
      <section aria-labelledby="mkt" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 id="mkt" className="sr-only">
          Market status
        </h2>
        <Card className="p-5">
          <Stat
            label="US equities"
            value={gs?.usEquities ?? "UNKNOWN"}
            tone={gs?.usEquities === "OPEN" ? "pass" : "neutral"}
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="On-chain market"
            value={gs?.onChainMarket ?? "UNKNOWN"}
            tone={gs?.onChainMarket === "ACTIVE" ? "pass" : "warn"}
            hint={gs?.onChainMarketDetail}
          />
        </Card>
        <Card className="p-5">
          <Stat
            label="Agent"
            value={agentData?.loopEnabled ? "ACTIVE" : "STANDBY"}
            tone={agentData?.loopEnabled ? "pass" : "warn"}
            hint={
              agentData
                ? `${agentData.activeStrategies} active strategies · scan ${timeAgo(agentData.lastScanAt)}`
                : undefined
            }
          />
        </Card>
      </section>

      {/* Portfolio */}
      <section aria-labelledby="pf" className="mt-6">
        <h2 id="pf" className="sr-only">
          Portfolio
        </h2>
        <Card>
          <CardHeader
            title="Portfolio"
            meta={
              <Link href="/portfolio" className="text-amber-400 hover:underline">
                details →
              </Link>
            }
          />
          <div className="p-5">
            <EmptyState
              title="Wallet not connected"
              detail="Portfolio value, allocation, and positions appear once the Agentic Wallet is configured and signed in. OLYR does not display estimated values without real wallet data."
            >
              <Link href="/wallet" className="text-xs text-amber-400 hover:underline">
                Wallet setup →
              </Link>
            </EmptyState>
          </div>
        </Card>
      </section>

      {/* Opportunities + strategies */}
      <section aria-labelledby="opp" className="mt-6 grid gap-4 lg:grid-cols-2">
        <h2 id="opp" className="sr-only">
          Live opportunities and strategies
        </h2>
        <Card>
          <CardHeader
            title="Live opportunities"
            meta={`scan ${timeAgo(opportunities.data?.lastScanAt)}`}
          />
          <div className="p-4">
            {notable.length === 0 ? (
              <EmptyState
                title="No divergence signals"
                detail="All evaluated assets are within configured thresholds, or the scanner has not completed a scan."
              />
            ) : (
              <ul className="space-y-2">
                {notable.slice(0, 5).map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/opportunities/${encodeURIComponent(o.id)}`}
                      className="flex items-baseline justify-between rounded px-2 py-1.5 hover:bg-zinc-800/40"
                    >
                      <span className="font-mono text-sm text-zinc-100">{o.ticker}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-sm text-zinc-300">
                          {formatPercent(o.spreadPercent)}
                        </span>
                        <StatusBadge tone={toneForStatus(o.status)} label={o.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Strategies" />
          <div className="grid grid-cols-3 gap-3 p-5">
            <Stat label="Active" value={String(agentData?.activeStrategies ?? 0)} tone="pass" />
            <Stat label="Saved" value={String(strategies.data?.strategies.length ?? 0)} />
            <Stat
              label="Blocked"
              value={String(opps.filter((o) => o.status === "BLOCKED").length)}
              tone="fail"
            />
          </div>
        </Card>
      </section>

      {/* Executions */}
      <section aria-labelledby="exec" className="mt-6">
        <h2 id="exec" className="sr-only">
          Execution
        </h2>
        <Card>
          <CardHeader
            title="Execution"
            meta={
              <Link href="/executions" className="text-amber-400 hover:underline">
                all →
              </Link>
            }
          />
          <div className="grid grid-cols-3 gap-3 p-5">
            <Stat label="Total" value={String(execs.length)} />
            <Stat
              label="Pending"
              value={String(
                execs.filter((e) => !["CONFIRMED", "FAILED", "CANCELLED"].includes(e.state)).length,
              )}
              tone="warn"
            />
            <Stat label="Confirmed today" value={String(confirmedToday)} tone="pass" />
          </div>
        </Card>
      </section>
    </main>
  );
}
