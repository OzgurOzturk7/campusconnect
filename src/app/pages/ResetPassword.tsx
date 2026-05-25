import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, ArrowLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * /reset-password — landing page after the user clicks the email link.
 *
 * Supabase Auth appends `#access_token=...&refresh_token=...&type=recovery`
 * to the URL fragment. The supabase-js client picks this up automatically
 * via its `detectSessionInUrl` default, so by the time this component
 * mounts the user is already signed in (temporarily) via the recovery
 * session and we can call `updateUser({ password })`.
 *
 * After success we sign the user out so they're forced to log in again
 * with the fresh password — cleaner mental model than silently elevating
 * a recovery session into a normal one.
 */
export function ResetPassword() {
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Confirm the recovery flow is active. Without a session here, the
    // user probably opened the page directly or the link expired.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError(t("reset.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("reset.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password: next });
      if (updateErr) throw updateErr;
      await supabase.auth.signOut();
      setDone(true);
    } catch (e: any) {
      setError(e?.message || t("reset.updateFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("reset.backToSignIn")}
        </Link>

        <div className="bg-card border border-border rounded-2xl shadow-lg p-6 md:p-8">
          {done ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 mx-auto rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-xl font-bold mb-2">{t("reset.doneTitle")}</h2>
              <p className="text-sm text-muted-foreground mb-6">
                {t("reset.doneBody")}
              </p>
              <button
                onClick={() => navigate("/login", { replace: true })}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                {t("reset.goToSignIn")}
              </button>
            </div>
          ) : hasSession === false ? (
            <div>
              <div className="flex items-start gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="font-semibold">{t("reset.invalidTitle")}</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("reset.invalidBody")}
                  </p>
                </div>
              </div>
              <Link
                to="/forgot-password"
                className="block w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold text-center hover:bg-primary/90 transition-colors"
              >
                {t("reset.requestNewLink")}
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">{t("reset.title")}</h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  {t("reset.subtitle")}
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <PasswordField
                  label={t("reset.newPassword")}
                  value={next}
                  onChange={setNext}
                  autoComplete="new-password"
                />
                <PasswordField
                  label={t("reset.confirmPassword")}
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
                  disabled={submitting || !next || !confirm}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> {t("reset.saving")}
                    </>
                  ) : (
                    t("reset.updateButton")
                  )}
                </button>
              </form>
            </>
          )}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
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
          required
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </div>
  );
}
