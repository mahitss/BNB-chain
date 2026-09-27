"use client";

/** Settings: read-only display of the effective server-side configuration.
 * Limits are enforced by the risk engine and the API; editing them is not
 * exposed until a policy-management endpoint exists. */
import { useQuery } from "@tanstack/react-query";
import { get as apiGet } from "../../lib/api";
import { Card, CardHeader, PageHeader, Skeleton } from "../../components/ui";

interface WalletResponse {
  executionMode: string;
  limits: {
    maxTradeUsd: number;
    maxDailyUsd: number;
    maxSlippagePercent: number;
    allowedAssets: string[];
    allowedActions: string[];
  };
  capabilities: { policyMode: string; canExecuteTrades: boolean; walletConfigured: boolean };
}

export default function SettingsPage() {
  const walletQuery = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiGet<WalletResponse>("/api/wallet"),
  });
  const limits = walletQuery.data?.limits;

  return (
    <main className="mx-auto max-w-3xl">
      <PageHeader eyebrow="OLYR · Settings" title="Configuration" />
      <p className="mt-3 max-w-xl text-xs leading-relaxed text-zinc-500">
        These values are server-side configuration enforced by the Rust risk engine and the API.
        They are shown read-only: policy management endpoints are not exposed yet, and OLYR does not
        render fake editable controls.
      </p>

      {walletQuery.isPending || !limits ? (
        <div className="mt-6">
          <Card className="p-5">
            <Skeleton lines={5} />
          </Card>
        </div>
      ) : (
        <>
          <Card className="mt-6">
            <CardHeader title="Execution policy" />
            <div className="space-y-1.5 p-5 text-sm text-zinc-300">
              <p className="font-mono">Mode: {walletQuery.data!.executionMode}</p>
              <p className="text-xs text-zinc-500">
                Set via OLYR_EXECUTION_POLICY (MANUAL | BOUNDED_AGENT | DISABLED).
              </p>
            </div>
          </Card>
          <Card className="mt-4">
            <CardHeader title="Risk limits" />
            <div className="space-y-1.5 p-5 text-sm text-zinc-300">
              <p className="font-mono">Max trade: ${limits.maxTradeUsd}</p>
              <p className="font-mono">Max daily: ${limits.maxDailyUsd}</p>
              <p className="font-mono">Max slippage: {limits.maxSlippagePercent}%</p>
              <p className="text-xs text-zinc-500">
                Allowed assets:{" "}
                {limits.allowedAssets.length > 0 ? limits.allowedAssets.join(", ") : "all listed"}
                {" · "}
                Allowed actions:{" "}
                {limits.allowedActions.length > 0
                  ? limits.allowedActions.join(", ")
                  : "default spot set"}
              </p>
            </div>
          </Card>
          <Card className="mt-4">
            <CardHeader title="Account / wallet" />
            <div className="space-y-1.5 p-5 text-sm text-zinc-300">
              <p className="font-mono">
                Wallet:{" "}
                {walletQuery.data!.capabilities.walletConfigured ? "configured" : "not configured"}
              </p>
              <p className="text-xs text-zinc-500">
                Owner identity uses a development-safe abstraction (OLYR_DEFAULT_OWNER); no
                authentication system exists yet.
              </p>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
