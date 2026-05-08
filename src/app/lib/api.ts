import { getStoredToken } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
  let response = await fetchOnce(path, options);

  // Auto-retry once on transient 503 (Supabase connection blip)
  if (response.status === 503) {
    await new Promise((r) => setTimeout(r, 200));
    response = await fetchOnce(path, options);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(error.detail || "Request failed");
  }

  if (response.status === 204) return null;
  return response.json();
}
