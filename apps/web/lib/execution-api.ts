/** Extended API client methods for the Phase 6 execution pipeline. */
import type { ExecutionRecord, TradeQuote } from "@olyr/types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const API_BASE = process.env.NEXT_PUBLIC_OLYR_API_URL ?? "http://localhost:4000";
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const errorBody =
      (parsed as { error?: { category: string; message: string } } | null)?.error ?? null;
    throw new Error(errorBody?.message ?? `Request failed with HTTP ${response.status}`);
  }
  return parsed as T;
}

export interface SimulationResponse {
  id: string;
  status: "PASSED" | "FAILED" | "UNKNOWN";
  apiStatus: string | null;
  failReason: string | null;
  swap?: {
    mode: string;
    toTokenAmount: string | null;
    minReceiveAmount: string | null;
    slippagePercent: string | null;
    priceImpactPercent: string | null;
    tradeFeeUsd: string | null;
    estimateGasFee: string | null;
  };
  timestamp: string;
}

export async function simulateProposal(proposalId: string): Promise<SimulationResponse> {
  return post(`/api/proposals/${proposalId}/simulate`, {});
}

export async function authorizeProposal(
  proposalId: string,
  decision: "APPROVE" | "REJECT",
): Promise<{ id: string; decision: string }> {
  return post(`/api/proposals/${proposalId}/authorize`, { decision });
}

export async function createExecution(proposalId: string): Promise<ExecutionRecord> {
  return post("/api/executions", { proposalId });
}

export async function fetchQuote(
  proposalId: string,
  fromTokenAddress: string,
  toTokenAddress: string,
  amount: string,
): Promise<TradeQuote> {
  return post("/api/quotes", { proposalId, fromTokenAddress, toTokenAddress, amount });
}

export function estimateFromSimulation(simulation: SimulationResponse): {
  expectedOutput: string;
  fees: string;
  slippage: string;
} {
  return {
    expectedOutput: simulation.swap?.toTokenAmount ?? "Unavailable",
    fees:
      simulation.swap?.tradeFeeUsd !== null && simulation.swap?.tradeFeeUsd !== undefined
        ? `$${simulation.swap.tradeFeeUsd} + gas ${simulation.swap.estimateGasFee ?? "unavailable"}`
        : "Unavailable",
    slippage: simulation.swap?.slippagePercent ?? "Unavailable",
  };
}
