/**
 * Internal client for the Python agent service (POST /agent/parse).
 * Bounded timeout; structured errors; never logs request text or LLM data
 * beyond length.
 */
import type { AgentParseResponse } from "@olyr/types";

export interface AgentClient {
  parse(text: string): Promise<AgentParseResponse>;
}

export class AgentUnavailableError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentUnavailableError";
    this.status = status;
  }
}

export class HttpAgentClient implements AgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 45_000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async parse(text: string): Promise<AgentParseResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/agent/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new AgentUnavailableError(
        `Agent service unreachable: ${error instanceof Error ? error.name : "error"}`,
        503,
      );
    }
    clearTimeout(timer);
    const bodyText = await response.text();
    if (response.status === 503) {
      throw new AgentUnavailableError(
        `Agent LLM provider not configured: ${bodyText.slice(0, 200)}`,
        503,
      );
    }
    if (!response.ok) {
      throw new AgentUnavailableError(
        `Agent service error (HTTP ${response.status}): ${bodyText.slice(0, 200)}`,
        502,
      );
    }
    try {
      return JSON.parse(bodyText) as AgentParseResponse;
    } catch {
      throw new AgentUnavailableError("Agent service returned a non-JSON response", 502);
    }
  }
}
