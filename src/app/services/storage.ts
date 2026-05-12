import { getStoredToken } from "../context/AuthContext";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

/**
 * Storage service — file uploads.
 *
 * Goes through the backend today (which validates + signs URLs). If we move
 * to direct browser→Supabase Storage uploads later, the call sites don't
 * change.
 */

export interface UploadedFile {
  url: string;
  name: string;
}

export const storageService = {
  /** Upload a CV (PDF/Word). Returns a signed URL valid for 30 days. */
  async uploadCv(file: File): Promise<UploadedFile> {
    const token = getStoredToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/projects/upload-cv`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const detail =
        (await res.json().catch(() => null))?.detail || `Upload failed (${res.status})`;
      const err = new Error(detail) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return res.json();
  },
};
