import { Bell, LogOut, Briefcase, Calendar, Users, MessageSquare, CheckCheck, Sun, Moon, User as UserIcon, Globe, Check } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Avatar } from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useLanguage } from "../context/LanguageContext";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

const iconMap: Record<string, React.ElementType> = {
  project_application: Briefcase,
  project_application_result: Briefcase,
  project_team_join: Briefcase,
  club_announcement: Users,
  club_application_result: Users,
  new_event: Calendar,
  event_reminder: Calendar,
  study_file_upload: MessageSquare,
  system: Bell,
};

const colorMap: Record<string, string> = {
  project_application: "bg-blue-50 text-blue-600",
  project_application_result: "bg-blue-50 text-blue-600",
  project_team_join: "bg-blue-50 text-blue-600",
  club_announcement: "bg-green-50 text-green-600",
  club_application_result: "bg-green-50 text-green-600",
  new_event: "bg-orange-50 text-orange-600",
  event_reminder: "bg-orange-50 text-orange-600",
  study_file_upload: "bg-purple-50 text-purple-600",
  system: "bg-primary/10 text-primary",
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Navbar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    window.addEventListener("notifications-updated", fetchUnreadCount);
    return () => {
      clearInterval(interval);
      window.removeEventListener("notifications-updated", fetchUnreadCount);
    };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [userMenuOpen]);

  async function fetchUnreadCount() {
    try {
      const data = await apiFetch("/api/notifications/unread-count");
      setUnreadCount(data.count);
    } catch {
      // silent fail
    }
  }

  async function fetchNotifications() {
    try {
      setLoadingNotifs(true);
      const data = await apiFetch("/api/notifications/");
      setNotifications(data.slice(0, 8));
    } catch {
      // silent fail
    } finally {
      setLoadingNotifs(false);
    }
  }

  function toggleDropdown() {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  }

  async function handleNotifClick(notif: Notification) {
    if (!notif.is_read) {
      apiFetch(`/api/notifications/${notif.id}/read`, { method: "PATCH" }).then(() => {
        window.dispatchEvent(new Event("notifications-updated"));
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (notif.link) navigate(notif.link);
  }

  async function markAllRead() {
    try {
      await apiFetch("/api/notifications/read-all", { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      window.dispatchEvent(new Event("notifications-updated"));
    } catch {
      // silent
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border z-50 flex items-center px-4 gap-4">
      <Link to="/" className="flex items-center mr-6 flex-shrink-0">
        <img
          src="/logo.png"
          alt="CampusConnect"
          className="h-30 w-auto object-contain"
        />
      </Link>

      <div className="flex-1 max-w-md relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder={t("search_placeholder")}
          className="w-full pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none transition-colors"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {user?.role === "admin" && (
          <span className="px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary rounded-full border border-primary/20">
            {t("admin_badge")}
          </span>
        )}

        <div ref={wrapperRef} className="relative">
          <button
            onClick={toggleDropdown}
            aria-label="Notifications"
            className={`relative p-2 rounded-lg transition-colors ${open ? "bg-muted" : "hover:bg-muted"}`}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-primary text-white text-xs rounded-full flex items-center justify-center font-bold">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-[380px] max-w-[90vw] bg-card border border-border rounded-xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{t("notifications")}</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-semibold rounded-full">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                <button
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {t("mark_all")}
                </button>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {loadingNotifs ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">{t("you_are_caught_up")}</p>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const Icon = iconMap[notif.type] || Bell;
                    const color = colorMap[notif.type] || colorMap.system;
                    return (
                      <button
                        key={notif.id}
                        onClick={() => handleNotifClick(notif)}
                        className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-border last:border-0 transition-colors hover:bg-muted ${
                          !notif.is_read ? "bg-accent/40" : ""
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-sm truncate">{notif.title}</p>
                            {!notif.is_read && (
                              <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notif.body}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(notif.created_at)}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="block px-4 py-3 text-center text-sm font-medium text-primary border-t border-border hover:bg-muted transition-colors"
              >
                {t("view_all_notifications")}
              </Link>
            </div>
          )}
        </div>

        {/* User menu */}
        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="User menu"
            className={`rounded-full transition-all ${userMenuOpen ? "ring-2 ring-primary/40" : "hover:opacity-80"}`}
          >
            <Avatar name={user?.name || "User"} size="sm" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <Avatar name={user?.name || "User"} size="sm" />
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{user?.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                </div>
              </div>

              {/* Profile link */}
              <Link
                to="/profile"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                <span>{t("menu_profile")}</span>
              </Link>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left"
              >
                {theme === "dark" ? <Sun className="w-4 h-4 text-muted-foreground" /> : <Moon className="w-4 h-4 text-muted-foreground" />}
                <span className="flex-1">{theme === "dark" ? t("menu_light_mode") : t("menu_dark_mode")}</span>
              </button>

              {/* Language */}
              <div className="border-t border-border px-4 py-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t("menu_language")}</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setLang("en")}
                    className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      lang === "en" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                    }`}
                  >
                    {lang === "en" && <Check className="w-3 h-3" />}
                    {t("lang_english")}
                  </button>
                  <button
                    onClick={() => setLang("tr")}
                    className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      lang === "tr" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                    }`}
                  >
                    {lang === "tr" && <Check className="w-3 h-3" />}
                    {t("lang_turkish")}
                  </button>
                </div>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-destructive/10 hover:text-destructive transition-colors text-left border-t border-border"
              >
                <LogOut className="w-4 h-4" />
                <span>{t("menu_logout")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
