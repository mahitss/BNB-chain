/**
 * Risk-engine HTTP client (Fastify → Rust). Bounded timeout; the browser
 * never talks to the Rust service directly.
 */
import type { RiskDecision, RiskInput } from "@olyr/types";

export interface RiskEngineClient {
  evaluate(input: RiskInput): Promise<RiskDecision>;
}

export class RiskEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiskEngineUnavailableError";
  }
}

export class HttpRiskEngineClient implements RiskEngineClient {
  private readonly evaluateUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.evaluateUrl = `${baseUrl.replace(/\/$/, "")}/evaluate`;
    this.timeoutMs = timeoutMs;
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.evaluateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new RiskEngineUnavailableError(
        `Risk engine unreachable: ${error instanceof Error ? error.name : "error"}`,
      );
    }
    clearTimeout(timer);
    const text = await response.text();
    if (!response.ok) {
      throw new RiskEngineUnavailableError(
        `Risk engine error (HTTP ${response.status}): ${text.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(text) as RiskDecision;
    } catch {
      throw new RiskEngineUnavailableError("Risk engine returned a non-JSON response");
    }
  }
}
