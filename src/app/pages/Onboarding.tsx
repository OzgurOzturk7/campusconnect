import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Lock, Loader2, AlertCircle, ShieldCheck, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { toUserError } from "../lib/errors";

/**
 * /onboarding — forced password change after first sign-in.
 *
 * Reached only when the AuthContext user has `must_change_password=true`.
 * ProtectedRoute traps every other path back here until the flag clears.
 *
 * No navbar, no sidebar — the user shouldn't be exploring the app yet.
 * Just an explanation, the form, and an emergency "sign out" escape.
 */
export function Onboarding() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const { user, logout, markPasswordChanged } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError(t("onboarding.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("onboarding.mismatch"));
      return;
    }
    if (next === current) {
      setError(t("onboarding.sameAsTemp"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      // Persist the fresh token: the password change invalidates the
      // temp-password session server-side, so without this the user would
      // be bounced to /login right after onboarding.
      markPasswordChanged(res?.access_token);
      navigate("/", { replace: true });
    } catch (e: unknown) {
      const ue = toUserError(e);
      setError(ue.body);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-2xl shadow-lg p-6 md:p-8">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t("onboarding.title")}</h1>
              <p className="text-sm text-muted-foreground mt-1 leading-snug">
                {user?.name
                  ? t("onboarding.welcomeNamed", { name: user.name.split(" ")[0] })
                  : t("onboarding.welcome")}
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <PasswordField
              label={t("onboarding.tempPassword")}
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              autoFocus
            />
            <PasswordField
              label={t("onboarding.newPassword")}
              value={next}
              onChange={setNext}
              autoComplete="new-password"
            />
            <PasswordField
              label={t("onboarding.confirmPassword")}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />

            {error && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" /> {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !current || !next || !confirm}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("onboarding.saving")}
                </>
              ) : (
                t("onboarding.continue")
              )}
            </button>
          </form>
        </div>

        <div className="mt-4 flex justify-center">
          <button
            onClick={() => { logout(); navigate("/login", { replace: true }); }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            {t("onboarding.signOutInstead")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </div>
  );
}
