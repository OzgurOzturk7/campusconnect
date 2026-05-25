import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { ApiError } from "../lib/api";

/**
 * /forgot-password — public page.
 *
 * Posts the email to the backend, which calls Supabase's
 * `reset_password_for_email`. The server always replies 200 so we can't
 * leak whether an email is registered. The user sees a "check your inbox"
 * screen regardless.
 */
export function ForgotPassword() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setSubmitted(true);
    } catch (e: unknown) {
      // Rate-limit (429) is the only error worth surfacing — everything
      // else the server intentionally swallows to prevent enumeration.
      if (e instanceof ApiError && e.status === 429) {
        setError(t("forgot.rateLimit"));
      } else {
        setError(t("forgot.genericError"));
      }
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
          {submitted ? <SuccessView email={email} /> : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">{t("forgot.title")}</h1>
                <p className="text-sm text-muted-foreground mt-1.5">
                  {t("forgot.subtitle")}
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">{t("email")}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@final.edu.tr"
                      autoComplete="email"
                      autoFocus
                      required
                      className="w-full pl-9 pr-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> {t("forgot.sending")}
                    </>
                  ) : (
                    t("forgot.sendLink")
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

function SuccessView({ email }: { email: string }) {
  const { t } = useTranslation("auth");
  return (
    <div className="text-center py-6">
      <div className="w-14 h-14 mx-auto rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center mb-4">
        <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-xl font-bold mb-2">{t("forgot.successTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t("forgot.successBody", { email })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("forgot.successHint")}
      </p>
    </div>
  );
}
