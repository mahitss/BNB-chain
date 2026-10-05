"use client";

/**
 * Overview — OLYR live intelligence terminal.
 *
 * Answers "what is happening right now" from real backend state only:
 * market telemetry, live opportunities (the primary section), agent
 * operations, strategies, executions. No fabricated values anywhere:
 * every number traces to one of the five queries below, and every
 * failure renders an explicit error with retry instead of a silent zero.
 */
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get as apiGet } from "../lib/api";
import { formatPercent, timeAgo } from "../lib/format";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  StatusBadge,
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
  configurationStatus?: "CONFIGURED" | "NOT_CONFIGURED";
  configurationDetail?: string;
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

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

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

/** Compact telemetry item for the operational status strip. */
function TelemetryItem({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "pass" | "warn" | "fail" | "neutral";
  hint?: string;
}) {
  const valueCls =
    tone === "pass"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "fail"
          ? "text-red-400"
          : "text-zinc-100";
  return (
    <div className="min-w-0 flex-1 px-4 py-3 first:pl-5 last:pr-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-base font-medium ${valueCls}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

/**
 * Institutional state marker for opportunity signals. Deliberately neutral:
 * a premium is a measured divergence, never an implied profit — so no
 * green checkmark, only a restrained label.
 */
function SignalState({ status }: { status: string }) {
  return <StatusBadge tone={status === "BLOCKED" ? "warn" : "neutral"} label={status} />;
}

export default function OverviewPage() {
  const queryClient = useQueryClient();
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

  const refreshing =
    globalState.isFetching ||
    opportunities.isFetching ||
    agent.isFetching ||
    strategies.isFetching ||
    executions.isFetching;
  const refreshAll = () => {
    void queryClient.invalidateQueries();
  };

  const failed = [
    globalState.error ? "market status" : null,
    opportunities.error ? "opportunities" : null,
    agent.error ? "agent status" : null,
    strategies.error ? "strategies" : null,
    executions.error ? "executions" : null,
  ].filter((s): s is string => s !== null);

  const criticalPending =
    globalState.isPending || opportunities.isPending || agent.isPending;
  const criticalFailed = Boolean(globalState.error || opportunities.error || agent.error);
  if (criticalPending && !criticalFailed) {
    return (
      <main className="mx-auto max-w-7xl">
        <PageHeader eyebrow="OLYR" title="Autonomous Tokenized Equity Intelligence" />
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
  const actionable = opps.filter((o) => o.status === "OPPORTUNITY").length;
  const watched = opps.filter((o) => o.status === "WATCH").length;
  const agentData = agent.data;
  const execs = executions.data?.executions ?? [];
  const confirmedToday = execs.filter(
    (e) =>
      e.state === "CONFIRMED" && new Date(e.createdAt).toDateString() === new Date().toDateString(),
  ).length;

  return (
    <main className="mx-auto max-w-7xl">
      {/* Product identity + freshness + refresh */}
      <PageHeader
        eyebrow="OLYR"
        title="Autonomous Tokenized Equity Intelligence"
        meta={gs ? `updated ${timeAgo(gs.timestamp)}` : undefined}
        actions={
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            aria-label="Refresh all overview data"
            className={`rounded border border-zinc-700 px-3 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-800/60 hover:text-zinc-100 disabled:cursor-wait disabled:opacity-50 ${FOCUS_RING}`}
          >
            {refreshing ? "REFRESHING…" : "REFRESH"}
          </button>
        }
      />

      {/* Partial-failure honesty: name exactly what is unavailable. */}
      {failed.length > 0 && (
        <div className="mt-4" role="alert">
          <ErrorState
            message={`Partial data — unavailable: ${failed.join(", ")}. Shown values remain live; nothing is estimated.`}
            onRetry={refreshAll}
          />
        </div>
      )}

      {/* Operational status strip — telemetry, not marketing cards. */}
      <section aria-label="System telemetry" className="mt-6">
        <div className="flex flex-col divide-y divide-zinc-800/80 rounded-lg border border-zinc-800 bg-zinc-900/40 sm:flex-row sm:divide-x sm:divide-y-0">
          <TelemetryItem
            label="US equities"
            value={gs?.usEquities ?? "UNKNOWN"}
            tone={gs ? (gs.usEquities === "OPEN" ? "pass" : "neutral") : "neutral"}
            hint={gs ? `as of ${timeAgo(gs.timestamp)}` : "market status unavailable"}
          />
          <TelemetryItem
            label="On-chain market"
            value={gs?.onChainMarket ?? "UNKNOWN"}
            tone={
              !gs
                ? "neutral"
                : gs.onChainMarket === "ACTIVE"
                  ? "pass"
                  : gs.onChainMarket === "NOT_CONFIGURED"
                    ? "fail"
                    : "warn"
            }
            hint={gs?.onChainMarketDetail ?? "on-chain observability unavailable"}
          />
          <TelemetryItem
            label="Agent"
            value={agentData ? (agentData.loopEnabled ? "RUNNING" : "STANDBY") : "UNKNOWN"}
            tone={agentData ? (agentData.loopEnabled ? "pass" : "warn") : "neutral"}
            hint={
              agentData
                ? `${agentData.activeStrategies} active strategies · scan ${timeAgo(agentData.lastScanAt)}`
                : "agent status unavailable"
            }
          />
        </div>
      </section>

      {/* Primary: live market intelligence. */}
      <section aria-labelledby="intel" className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="intel"
            className="font-mono text-xs uppercase tracking-[0.25em] text-zinc-400"
          >
            Live market intelligence
          </h2>
          {opportunities.data && (
            <p className="font-mono text-xs text-zinc-600">
              {opps.length} signals tracked · {actionable} actionable · {watched} watch ·
              scan {timeAgo(opportunities.data.lastScanAt)}
            </p>
          )}
        </div>
        <Card className="mt-3">
          <div className="p-2 sm:p-3">
            {opportunities.isPending ? (
              <div className="p-3">
                <Skeleton lines={4} />
              </div>
            ) : opportunities.error ? (
              <div className="p-2">
                <ErrorState
                  message="Opportunity data could not be loaded."
                  onRetry={() => void opportunities.refetch()}
                />
              </div>
            ) : notable.length === 0 ? (
              <div className="p-2">
                {opportunities.data?.configurationStatus === "NOT_CONFIGURED" ? (
                  <EmptyState
                    title="Market data unavailable"
                    detail="Configure the Binance Web3 data source (BINANCE_API_KEY and BINANCE_API_SECRET) to evaluate divergence signals. The scanner has not run."
                  />
                ) : (
                  <EmptyState
                    title="No divergence signals"
                    detail="All evaluated assets are within configured thresholds, or the scanner has not completed a scan."
                  />
                )}
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800/60">
                {notable.slice(0, 6).map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/opportunities/${encodeURIComponent(o.id)}`}
                      aria-label={`${o.ticker} ${o.status}, spread ${formatPercent(o.spreadPercent)}, market ${o.marketState}. Open signal detail.`}
                      className={`flex items-center gap-4 px-3 py-3 transition-colors hover:bg-zinc-800/40 sm:gap-6 sm:px-4 ${FOCUS_RING}`}
                    >
                      <span className="w-16 shrink-0 font-mono text-base font-semibold tracking-tight text-zinc-50">
                        {o.ticker}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-lg font-medium tabular-nums text-zinc-100">
                          {formatPercent(o.spreadPercent)}
                          <span className="ml-2 align-middle font-sans text-[11px] font-normal uppercase tracking-wider text-zinc-500">
                            {o.direction === "NONE" ? "" : o.direction}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {o.marketState} · {o.referenceFreshness} · evaluated{" "}
                          {timeAgo(o.timestamp)}
                          {o.reasons[0] ? ` · ${o.reasons[0].message}` : ""}
                        </span>
                      </span>
                      <SignalState status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      {/* Operations: agent + strategies + portfolio. */}
      <section aria-label="Operations" className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Agent operations" />
          <div className="p-5">
            {agent.isPending ? (
              <Skeleton lines={3} />
            ) : agent.error ? (
              <ErrorState
                message="Agent status could not be loaded."
                onRetry={() => void agent.refetch()}
              />
            ) : agentData ? (
              <dl className="space-y-2 font-mono text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wider text-zinc-500">State</dt>
                  <dd className="text-zinc-100">
                    {agentData.loopEnabled ? "RUNNING" : "STANDBY"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wider text-zinc-500">
                    Active strategies
                  </dt>
                  <dd className="text-zinc-100">{agentData.activeStrategies}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wider text-zinc-500">
                    Signals tracked
                  </dt>
                  <dd className="text-zinc-100">{opps.length}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs uppercase tracking-wider text-zinc-500">Last scan</dt>
                  <dd className="text-zinc-100">{timeAgo(agentData.lastScanAt)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-zinc-500">Agent status unavailable.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Strategies"
            meta={
              <Link
                href="/strategies"
                aria-label="Open all strategies"
                className={`text-amber-400 hover:underline ${FOCUS_RING}`}
              >
                open →
              </Link>
            }
          />
          <div className="p-5">
            {strategies.isPending ? (
              <Skeleton lines={3} />
            ) : strategies.error ? (
              <ErrorState
                message="Strategy data could not be loaded."
                onRetry={() => void strategies.refetch()}
              />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  label="Active"
                  value={String(agentData?.activeStrategies ?? "—")}
                  tone="pass"
                />
                <Stat
                  label="Saved"
                  value={String(strategies.data?.strategies.length ?? "—")}
                />
                <Stat
                  label="Blocked"
                  value={String(
                    opps.filter((o) => o.status === "BLOCKED").length,
                  )}
                  tone="fail"
                />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Portfolio"
            meta={
              <Link
                href="/portfolio"
                aria-label="Open portfolio details"
                className={`text-amber-400 hover:underline ${FOCUS_RING}`}
              >
                details →
              </Link>
            }
          />
          <div className="px-5 py-4">
            <p className="text-sm font-medium text-zinc-300">Wallet not connected</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Portfolio data unavailable until wallet setup. No values estimated.
            </p>
            <Link
              href="/wallet"
              aria-label="Go to wallet setup"
              className={`mt-2 inline-block text-xs text-amber-400 hover:underline ${FOCUS_RING}`}
            >
              Wallet setup →
            </Link>
          </div>
        </Card>
      </section>

      {/* Execution telemetry — quiet unless something exists. */}
      <section aria-label="Execution summary" className="mt-4">
        <Card>
          <CardHeader
            title="Execution"
            meta={
              <Link
                href="/executions"
                aria-label="Open all executions"
                className={`text-amber-400 hover:underline ${FOCUS_RING}`}
              >
                all →
              </Link>
            }
          />
          <div className="p-5">
            {executions.isPending ? (
              <Skeleton lines={2} />
            ) : executions.error ? (
              <ErrorState
                message="Execution data could not be loaded."
                onRetry={() => void executions.refetch()}
              />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Total" value={String(execs.length)} />
                <Stat
                  label="Pending"
                  value={String(
                    execs.filter((e) => !["CONFIRMED", "FAILED", "CANCELLED"].includes(e.state))
                      .length,
                  )}
                  tone="warn"
                />
                <Stat label="Confirmed today" value={String(confirmedToday)} tone="pass" />
              </div>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
