"use client";

/** Portfolio: real wallet data only. The wallet is not configured in this
 * environment, so the page shows the setup state — never estimated values. */
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { Card, EmptyState, PageHeader, Skeleton } from "../../components/ui";

interface BalanceEntry {
  chainId: string;
  tokenContractAddress: string;
  symbol: string | null;
  balance: string | null;
  tokenPrice: string | null;
}

interface PositionEntry extends BalanceEntry {
  valueUsd: string | null;
}

export default function PortfolioPage() {
  const balancesQuery = useQuery({
    queryKey: ["wallet-balances"],
    queryFn: () =>
      apiGet<{ positions: PositionEntry[]; source: string; timestamp: string }>(
        "/api/portfolio",
      ),
    refetchInterval: 60_000,
    retry: 0,
  });

  const positions = balancesQuery.data?.positions ?? [];
  const totalUsd = positions.reduce((sum, p) => {
    const v = p.valueUsd !== null ? Number(p.valueUsd) : NaN;
    return Number.isFinite(v) && v >= 0 ? sum + v : sum;
  }, 0);
  const hasPriced = positions.some(
    (p) => p.valueUsd !== null && Number.isFinite(Number(p.valueUsd)),
  );

  return (
    <main className="mx-auto max-w-4xl">
      <PageHeader eyebrow="OLYR · Portfolio" title="Portfolio" />
      <div className="mt-6">
        {balancesQuery.isPending ? (
          <Card className="p-5">
            <Skeleton lines={5} />
          </Card>
        ) : balancesQuery.isError ? (
          <EmptyState
            title="Portfolio requires the Agentic Wallet"
            detail="Connect the Binance Agentic Wallet (official Skill + QR sign-in) or set OLYR_EXECUTOR_ADDRESS to display balances, tokenized-stock positions, and allocations. OLYR does not estimate portfolio value without real wallet data, and PnL is not computed because cost basis is not yet tracked."
          >
            <p className="font-mono text-xs text-zinc-500">
              Install: npx skills add
              binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
            </p>
          </EmptyState>
        ) : positions.length === 0 ? (
          <EmptyState
            title="No positions reported"
            detail="The wallet read succeeded but returned no token balances. Nothing is estimated."
          />
        ) : (
          <Card>
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                Total value
              </p>
              <p className="mt-0.5 font-mono text-xl font-medium text-zinc-100">
                {hasPriced
                  ? `$${totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "Unavailable"}
              </p>
              <p className="mt-0.5 font-mono text-xs text-zinc-600">
                {balancesQuery.data?.source} ·{" "}
                {balancesQuery.data
                  ? new Date(balancesQuery.data.timestamp).toLocaleTimeString("en-US", {
                      hour12: false,
                    })
                  : ""}
              </p>
            </div>
            <ul className="divide-y divide-zinc-800">
              {positions.map((p) => (
                <li
                  key={`${p.chainId}:${p.tokenContractAddress}`}
                  className="flex items-baseline justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="font-mono text-sm text-zinc-100">{p.symbol ?? "Unknown"}</p>
                    <p className="font-mono text-xs text-zinc-500">
                      {p.balance ?? "Unavailable"}
                      {p.tokenPrice ? ` · $${p.tokenPrice}` : " · price unavailable"}
                    </p>
                  </div>
                  <p className="font-mono text-sm text-zinc-100">
                    {p.valueUsd !== null ? `$${Number(p.valueUsd).toFixed(2)}` : "Unavailable"}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
