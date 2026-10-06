"use client";

/** OLYR wallet status (Phase 7): public wallet information only — no secrets. */
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";

interface SkillInfo {
  skill: string;
  type: string;
  olyrPermission: string;
  allowlisted: boolean;
}

interface WalletResponse {
  wallet: {
    provider: string;
    status: string;
    address: string | null;
    network: string | null;
    detail: string | null;
    versions: { cli: string | null; skill: string | null };
  };
  executionMode: string;
  limits: {
    maxTradeUsd: number;
    maxDailyUsd: number;
    maxSlippagePercent: number;
    allowedAssets: string[];
    allowedActions: string[];
  };
  capabilities: {
    canReadMarketData: boolean;
    canReadWallet: boolean;
    canReadPortfolio: boolean;
    canRequestQuotes: boolean;
    canSimulateTransactions: boolean;
    canExecuteTrades: boolean;
    walletConfigured: boolean;
    policyMode: string;
  };
  skills: SkillInfo[];
  timestamp: string;
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <li className={`font-mono text-sm ${enabled ? "text-emerald-400" : "text-zinc-600"}`}>
      {enabled ? "✓" : "✗"} {label}
    </li>
  );
}

interface BalanceEntry {
  chainId: string;
  tokenContractAddress: string;
  symbol: string | null;
  balance: string | null;
  tokenPrice: string | null;
}

export default function WalletPage() {
  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiGet<WalletResponse>("/api/wallet"),
    refetchInterval: 60_000,
  });
  const balancesQuery = useQuery({
    queryKey: ["wallet-balances"],
    queryFn: () =>
      apiGet<{ balances: BalanceEntry[]; source: string; timestamp: string }>(
        "/api/wallet/balances",
      ),
    refetchInterval: 60_000,
    retry: 0,
  });

  if (walletQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="font-mono text-sm text-zinc-400">Loading wallet status…</p>
      </main>
    );
  }

  if (walletQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-zinc-50">Wallet</h1>
        <p className="mt-6 text-sm text-red-400">
          {walletQuery.error instanceof Error ? walletQuery.error.message : "Failed to load wallet"}
        </p>
      </main>
    );
  }

  const { wallet, executionMode, limits, capabilities, skills } = walletQuery.data;
  const connected = wallet.status === "CONNECTED";

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-500">OLYR Wallet</p>
        <h1 className="mt-2 text-3xl font-semibold text-zinc-50">Agentic Wallet</h1>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 sm:max-w-lg">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Status</p>
          <p
            className={`mt-1 font-mono text-xl font-semibold ${connected ? "text-emerald-400" : "text-amber-400"}`}
          >
            {connected ? "CONNECTED ✓" : wallet.status}
          </p>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Network</p>
          <p className="mt-1 font-mono text-xl text-zinc-200">
            {wallet.network ?? "BNB Smart Chain"}
          </p>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Address</p>
          <p className="mt-1 font-mono text-sm text-zinc-300">
            {wallet.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : "Not connected"}
          </p>
        </div>
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
            Execution mode
          </p>
          <p className="mt-1 font-mono text-sm text-zinc-200">{executionMode}</p>
        </div>
      </section>

      {wallet.address && <p className="mt-2 font-mono text-xs text-zinc-500">{wallet.address}</p>}

      {!connected && wallet.status !== "CONNECTED" && (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 text-sm leading-relaxed text-amber-300">
          <p className="font-semibold">
            {wallet.status === "ERROR"
              ? "Wallet error."
              : wallet.status === "CONFIGURED"
                ? "Wallet configured — verification pending."
                : "Agentic Wallet not connected."}
          </p>
          <p className="mt-2 text-amber-200/80">
            {wallet.detail ?? "No wallet address is configured."}
          </p>
          {wallet.status !== "ERROR" && wallet.status !== "CONFIGURED" && (
            <p className="mt-2 text-amber-200/80">
              The Binance Agentic Wallet connects via the official Skill (
              <code className="font-mono">
                npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
              </code>
              ) and QR sign-in from the Binance App, or set OLYR_EXECUTOR_ADDRESS to a BSC
              address for read-only access. OLYR isolates it behind an adapter and never
              receives signing material. Balances and positions appear here once connected.
            </p>
          )}
        </div>
      )}

      {balancesQuery.data && balancesQuery.data.balances.length > 0 && (
        <section className="mt-8">
          <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
            Balances · {balancesQuery.data.source}
          </h2>
          <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {balancesQuery.data.balances.map((b) => (
              <li
                key={`${b.chainId}:${b.tokenContractAddress}`}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <div>
                  <p className="font-mono text-sm text-zinc-200">{b.symbol ?? "Unknown"}</p>
                  <p className="font-mono text-xs text-zinc-500">{b.tokenContractAddress}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-zinc-100">{b.balance ?? "Unavailable"}</p>
                  <p className="font-mono text-xs text-zinc-500">
                    {b.tokenPrice ? `$${b.tokenPrice}` : "price unavailable"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-xs text-zinc-600">
            read {new Date(balancesQuery.data.timestamp).toLocaleTimeString("en-US", { hour12: false })}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">Limits</h2>
        <ul className="mt-3 space-y-1 text-sm text-zinc-300">
          <li className="font-mono">${limits.maxTradeUsd} / trade</li>
          <li className="font-mono">${limits.maxDailyUsd} / day</li>
          <li className="font-mono">{limits.maxSlippagePercent}% max slippage</li>
          <li className="text-xs text-zinc-500">
            Allowed assets:{" "}
            {limits.allowedAssets.length > 0 ? limits.allowedAssets.join(", ") : "all listed"}
          </li>
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">Capabilities</h2>
        <ul className="mt-3 space-y-1">
          <Capability label="Read market data" enabled={capabilities.canReadMarketData} />
          <Capability label="Read wallet" enabled={capabilities.canReadWallet} />
          <Capability label="Read portfolio" enabled={capabilities.canReadPortfolio} />
          <Capability label="Get quotes" enabled={capabilities.canRequestQuotes} />
          <Capability
            label="Simulate transactions"
            enabled={capabilities.canSimulateTransactions}
          />
          <Capability label="Execute within policy" enabled={capabilities.canExecuteTrades} />
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Wallet skills (official, allowlisted)
        </h2>
        <ul className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {skills.map((skill) => (
            <li key={skill.skill} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <div>
                <p className="font-mono text-sm text-zinc-200">{skill.skill}</p>
                <p className="text-xs text-zinc-500">{skill.olyrPermission}</p>
              </div>
              <span
                className={`rounded border px-2 py-0.5 font-mono text-xs ${
                  skill.allowlisted
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-zinc-700 text-zinc-600"
                }`}
              >
                {skill.allowlisted ? "ALLOWED" : "blocked"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
