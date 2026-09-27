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

export default function PortfolioPage() {
  const balancesQuery = useQuery({
    queryKey: ["wallet-balances"],
    queryFn: () => apiGet<{ balances: BalanceEntry[] }>("/api/wallet/balances"),
    refetchInterval: 60_000,
    retry: 0,
  });

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
            detail="Connect the Binance Agentic Wallet (official Skill + QR sign-in) to display balances, tokenized-stock positions, and allocations. OLYR does not estimate portfolio value without real wallet data, and PnL is not computed because cost basis is not yet tracked."
          >
            <p className="font-mono text-xs text-zinc-500">
              Install: npx skills add
              binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
            </p>
          </EmptyState>
        ) : (
          <Card>
            <div className="p-5">
              <p className="text-sm text-zinc-300">
                {balancesQuery.data.balances.length} token balances reported by the wallet API.
              </p>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
