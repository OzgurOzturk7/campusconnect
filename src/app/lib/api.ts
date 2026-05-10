import { getStoredToken } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
      lastError = new Error(`HTTP ${response.status}`);
    } catch (e) {
      // Network / CORS error
      lastError = e;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }

  if (!response) {
    throw lastError instanceof Error ? lastError : new Error("Network error");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || `Request failed (${response.status})`);
  }

  if (response.status === 204) return null;
  return response.json();
}
