import { useState, useEffect, useRef, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import {
  User as UserIcon,
  Lock,
  Palette,
  Globe,
  Sun,
  Moon,
  Check,
  CheckCircle2,
  Loader2,
  AlertCircle,
  AtSign,
  Plus,
  Trash2,
  Flag,
  X,
} from "lucide-react";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { apiFetch } from "../lib/api";
import { SUPPORTED_LANGS, type Lang } from "../lib/i18n";
import { toUserError } from "../lib/errors";

type TabKey = "profile" | "password" | "appearance" | "language" | "domains" | "reports";

interface AllowedDomain {
  id: string;
  domain: string;
  is_active: boolean;
  created_at?: string;
}

interface ContentReport {
  id: string;
  content_type: string;
  content_id: string;
  content_preview?: string;
  reason: string;
  status: "pending" | "reviewed" | "dismissed";
  created_at: string;
  reporter_name?: string;
  reported_user_name?: string;
}

const TABS: { key: TabKey; icon: typeof UserIcon }[] = [
  { key: "profile", icon: UserIcon },
  { key: "password", icon: Lock },
  { key: "appearance", icon: Palette },
  { key: "language", icon: Globe },
];

export function Settings() {
  const { t } = useTranslation("settings");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  // Tab persists in the URL so refresh / bookmarks land back on the same one.
  const requestedTab = ((params.get("tab") as TabKey) || "profile") as TabKey;
  // Non-admins can't land on the admin-only domains tab via a typed URL.
  const activeTab: TabKey =
    (requestedTab === "domains" || requestedTab === "reports") && !isAdmin
      ? "profile"
      : requestedTab;
  const setTab = (key: TabKey) => setParams({ tab: key }, { replace: true });

  // Domain management + reports are admin-only; append their tabs.
  const tabs = isAdmin
    ? [
        ...TABS,
        { key: "domains" as TabKey, icon: AtSign },
        { key: "reports" as TabKey, icon: Flag },
      ]
    : TABS;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar / tab rail */}
        <nav
          className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible -mx-1 px-1"
          aria-label="Settings sections"
        >
          {tabs.map(({ key, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="w-4 h-4" />
                {t(`tabs.${key}`)}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "password" && <PasswordTab />}
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "language" && <LanguageTab />}
          {activeTab === "domains" && isAdmin && <DomainsTab />}
          {activeTab === "reports" && isAdmin && <ReportsTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function ProfileTab() {
  const { t } = useTranslation("settings");
  const { user } = useAuth();

  // Display-only summary of the current account. Editing happens on the
  // dedicated /profile page; we intentionally don't surface that as a
  // button here — Settings is purely informational so the user isn't
  // confused about where the "real" form lives.
  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("profile.title")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("profile.description")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ReadonlyField label={t("profile.name_label")} value={user?.name || ""} />
        <ReadonlyField
          label={t("profile.email_label")}
          value={user?.email || ""}
          hint={t("profile.email_help")}
        />
      </div>
    </Card>
  );
}

function ReadonlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">
        {label}
      </label>
      <div className="px-3 py-2 rounded-lg bg-muted text-sm text-foreground/90 truncate">
        {value || "—"}
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------
function PasswordTab() {
  const { t } = useTranslation("settings");
  const { success: toastOk, error: toastError } = useToast();
  const { markPasswordChanged } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  // Persistent in-form success banner. The toast is fleeting (auto-dismisses
  // bottom-right); for a destructive action like a password change we want
  // a more anchored confirmation right where the user is looking.
  const [showSuccess, setShowSuccess] = useState(false);
  const successTimerRef = useRef<number | null>(null);

  // Clear the timer if the tab unmounts mid-banner.
  useEffect(() => {
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  function validate(): string | null {
    if (next.length < 8) return t("password.too_short");
    if (next !== confirm) return t("password.mismatch");
    if (next === current) return t("password.same_as_old");
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setClientError(null);
    setShowSuccess(false);
    const err = validate();
    if (err) {
      setClientError(err);
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      // Password change invalidates older sessions server-side; persist the
      // fresh token so this device stays signed in.
      if (res?.access_token) markPasswordChanged(res.access_token);
      toastOk(t("password.updated"));
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowSuccess(true);
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
      successTimerRef.current = window.setTimeout(() => setShowSuccess(false), 6000);
    } catch (e: unknown) {
      toastError(toUserError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{t("password.title")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("password.description")}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 max-w-md">
        {showSuccess && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm border bg-green-50 border-green-200 text-green-800 dark:bg-green-500/10 dark:border-green-500/30 dark:text-green-300"
          >
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold leading-snug">{t("password.updated")}</p>
              <p className="text-xs opacity-80 mt-0.5">
                Next time you sign in, use your new password.
              </p>
            </div>
          </div>
        )}

        <PasswordInput
          label={t("password.current_label")}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          required
        />
        <PasswordInput
          label={t("password.new_label")}
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          required
        />
        <PasswordInput
          label={t("password.confirm_label")}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />

        {clientError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> {clientError}
          </p>
        )}

        <Button type="submit" disabled={submitting || !current || !next || !confirm}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("password.submit")}
        </Button>
      </form>
    </Card>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        className="w-full px-3 py-2.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance — theme picker
// ---------------------------------------------------------------------------
function AppearanceTab() {
  const { t } = useTranslation("settings");
  const { theme, setTheme } = useTheme();

  const options: { value: "light" | "dark"; icon: typeof Sun; label: string }[] = [
    { value: "light", icon: Sun, label: t("appearance.theme_light") },
    { value: "dark", icon: Moon, label: t("appearance.theme_dark") },
  ];

  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{t("appearance.title")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("appearance.description")}</p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("appearance.title")}
        className="grid grid-cols-2 gap-3 max-w-md"
      >
        {options.map(({ value, icon: Icon, label }) => {
          const selected = theme === value;
          return (
            <button
              key={value}
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-muted"
              }`}
            >
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-sm font-medium">{label}</span>
              {selected && (
                <Check className="absolute top-2 right-2 w-4 h-4 text-primary" />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Language picker
// ---------------------------------------------------------------------------
function LanguageTab() {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { lang, setLang } = useLanguage();
  const { success } = useToast();

  function pick(code: Lang) {
    if (code === lang) return;
    setLang(code);
    success(t("language.saved"));
  }

  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">{t("language.title")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("language.description")}</p>
      </div>

      <div role="radiogroup" aria-label={t("language.title")} className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md">
        {SUPPORTED_LANGS.map((code) => {
          const selected = lang === code;
          return (
            <button
              key={code}
              role="radio"
              aria-checked={selected}
              onClick={() => pick(code as Lang)}
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                selected
                  ? "border-primary bg-primary/5 text-primary font-medium"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span>{tCommon(`languages.${code}`)}</span>
              {selected && <Check className="w-4 h-4" />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Allowed domains — admin only
// ---------------------------------------------------------------------------
function DomainsTab() {
  const { t } = useTranslation("settings");
  const { success: toastOk, error: toastError } = useToast();
  const { confirm } = useConfirm();
  const [domains, setDomains] = useState<AllowedDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiFetch("/api/auth/allowed-domains");
        if (alive) setDomains(data || []);
      } catch (e: unknown) {
        if (alive) toastError(toUserError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toastError]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const domain = newDomain.trim();
    if (!domain) return;
    setAdding(true);
    try {
      const created = await apiFetch("/api/auth/allowed-domains", {
        method: "POST",
        body: JSON.stringify({ domain }),
      });
      setDomains((prev) => [...prev, created]);
      setNewDomain("");
      toastOk(t("domains.added"));
    } catch (e: unknown) {
      toastError(toUserError(e));
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(d: AllowedDomain) {
    setBusyId(d.id);
    try {
      const updated = await apiFetch(`/api/auth/allowed-domains/${d.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !d.is_active }),
      });
      setDomains((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
      toastOk(t("domains.updated"));
    } catch (e: unknown) {
      toastError(toUserError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(d: AllowedDomain) {
    const ok = await confirm({
      title: t("domains.delete_title"),
      description: t("domains.delete_body", { domain: d.domain }),
      confirmLabel: t("domains.delete_confirm"),
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(d.id);
    try {
      await apiFetch(`/api/auth/allowed-domains/${d.id}`, { method: "DELETE" });
      setDomains((prev) => prev.filter((x) => x.id !== d.id));
      toastOk(t("domains.removed"));
    } catch (e: unknown) {
      toastError(toUserError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("domains.title")}</h2>
      </div>

      <form onSubmit={onAdd} className="flex gap-2 max-w-md">
        <div className="flex-1 flex items-center gap-2 bg-muted border border-border rounded-lg px-3 focus-within:ring-2 focus-within:ring-primary">
          <AtSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder={t("domains.add_placeholder")}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent py-2.5 text-sm focus:outline-none"
          />
        </div>
        <Button type="submit" disabled={adding || !newDomain.trim()}>
          {adding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <span className="flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              {t("domains.add_button")}
            </span>
          )}
        </Button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("domains.loading")}
        </div>
      ) : domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("domains.empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border max-w-md">
          {domains.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">@{d.domain}</p>
                <span
                  className={`inline-block mt-0.5 text-xs ${
                    d.is_active
                      ? "text-green-600 dark:text-green-400"
                      : "text-muted-foreground"
                  }`}
                >
                  {d.is_active ? t("domains.active") : t("domains.inactive")}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => onToggle(d)}
                  disabled={busyId === d.id}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {d.is_active ? t("domains.inactive") : t("domains.active")}
                </button>
                <button
                  onClick={() => onRemove(d)}
                  disabled={busyId === d.id}
                  aria-label={t("domains.delete_confirm")}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Content reports — admin only
// ---------------------------------------------------------------------------
function ReportsTab() {
  const { t } = useTranslation("settings");
  const { error: toastError } = useToast();
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiFetch("/api/reports");
        if (alive) setReports(data || []);
      } catch (e: unknown) {
        if (alive) toastError(toUserError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toastError]);

  async function setStatus(r: ContentReport, status: "reviewed" | "dismissed") {
    setBusyId(r.id);
    try {
      const updated = await apiFetch(`/api/reports/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)));
    } catch (e: unknown) {
      toastError(toUserError(e));
    } finally {
      setBusyId(null);
    }
  }

  const statusStyle: Record<string, string> = {
    pending: "text-amber-600 dark:text-amber-400",
    reviewed: "text-green-600 dark:text-green-400",
    dismissed: "text-muted-foreground",
  };

  return (
    <Card className="p-6 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t("reports.title")}</h2>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("reports.loading")}
        </div>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reports.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">
                    {t("reports.reported")}:{" "}
                    <span className="font-medium text-foreground">{r.reported_user_name || "—"}</span>
                    {"  ·  "}
                    {t("reports.reporter")}:{" "}
                    <span className="font-medium text-foreground">{r.reporter_name || "—"}</span>
                  </p>
                  {r.content_preview && (
                    <p className="text-sm mt-1.5 bg-muted rounded-md px-3 py-2 line-clamp-3">
                      {r.content_preview}
                    </p>
                  )}
                  <p className="text-sm mt-1.5 text-foreground/90">{r.reason}</p>
                  <span
                    className={`inline-block mt-1.5 text-xs font-medium ${statusStyle[r.status] || ""}`}
                  >
                    {t(`reports.status_${r.status}`)}
                  </span>
                </div>
                {r.status === "pending" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setStatus(r, "reviewed")}
                      disabled={busyId === r.id}
                      title={t("reports.review")}
                      aria-label={t("reports.review")}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-green-600 hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setStatus(r, "dismissed")}
                      disabled={busyId === r.id}
                      title={t("reports.dismiss")}
                      aria-label={t("reports.dismiss")}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
