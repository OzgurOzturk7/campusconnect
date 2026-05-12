import { getStoredToken } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * HTTP transport errors thrown by `apiFetch`.
 *
 * Carries the original status code so consumers (including `toUserError`)
 * can branch on it without parsing the message string.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// Status codes worth retrying — 503 (our transient supabase glitch),
// 502/504 (proxy/gateway), and `0` (network unreachable / CORS).
const RETRYABLE = new Set([0, 502, 503, 504]);
const RETRY_DELAYS_MS = [150, 400, 900]; // total ~1.5s of patience

async function fetchOnce(path: string, options: RequestInit) {
  const token = getStoredToken();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  let response: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      response = await fetchOnce(path, options);
      if (!RETRYABLE.has(response.status)) break;
      lastError = new ApiError(response.status, `HTTP ${response.status}`);
    } catch (e) {
      lastError = e;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  if (!response) {
    // Network reached its limit; surface as an ApiError with status 0 so
    // toUserError() can show the "no connection" copy.
    const message = lastError instanceof Error ? lastError.message : "Network error";
    throw new ApiError(0, message, lastError);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail =
      (body && typeof body === "object" && "detail" in body && body.detail) ||
      `Request failed (${response.status})`;
    throw new ApiError(response.status, String(detail), body);
  }

  if (response.status === 204) return null;
  return response.json();
}
