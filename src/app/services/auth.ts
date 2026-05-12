import { apiFetch } from "../lib/api";

/**
 * Auth service — public auth operations.
 *
 * Currently every call goes through the FastAPI backend, which itself talks
 * to Supabase. When the app migrates to talk Supabase Auth directly from the
 * browser, only this file changes; AuthContext consumers stay the same.
 */

export interface AuthUser {
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "student";
  access_token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export const authService = {
  login(creds: LoginCredentials): Promise<AuthUser> {
    return apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(creds),
    });
  },

  loginWithGoogle(credential: string): Promise<AuthUser> {
    return apiFetch("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
  },

  me(): Promise<AuthUser> {
    return apiFetch("/api/auth/me");
  },
};
