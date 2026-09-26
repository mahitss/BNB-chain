/**
 * Typed client for OLYR's own API. The browser NEVER talks to Binance
 * directly and never sees Binance credentials — the API service is the only
 * upstream. (Security boundary documented in docs/architecture/README.md.)
 */

const API_BASE = process.env.NEXT_PUBLIC_OLYR_API_URL ?? "http://localhost:4000";

export interface OlyrApiError {
  category: string;
  code?: number;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: OlyrApiError | null;
  constructor(status: number, body: OlyrApiError | null) {
    super(body?.message ?? `OLYR API request failed with HTTP ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiRequestError(response.status, {
      category: "malformed",
      message: "OLYR API returned a non-JSON response",
    });
  }
  if (!response.ok) {
    const errorBody = (body as { error?: OlyrApiError } | null)?.error ?? null;
    throw new ApiRequestError(response.status, errorBody);
  }
  return body as T;
}

export interface AssetsResponse {
  chainId: string;
  assets: import("@olyr/types").RwaAssetWithMarket[];
  retrievedAt: string;
}

export function fetchRwaAssets(params: { platformId?: string } = {}): Promise<AssetsResponse> {
  const query = params.platformId ? `?platformId=${encodeURIComponent(params.platformId)}` : "";
  return get<AssetsResponse>(`/api/rwa/assets${query}`);
}

export function fetchRwaPlatforms(): Promise<{ platforms: import("@olyr/types").RwaPlatform[] }> {
  return get("/api/rwa/platforms");
}
