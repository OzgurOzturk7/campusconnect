import { Bell, LogOut, Briefcase, Calendar, Users, MessageSquare, CheckCheck, User as UserIcon, Menu, Settings as SettingsIcon, Search, Loader2, X } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Avatar } from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { useNotifications } from "../context/NotificationContext";
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

interface SearchResults {
  clubs: { id: string; name: string; category?: string }[];
  events: { id: string; title: string }[];
  projects: { id: string; title: string }[];
  users: { id: string; name: string; avatar_url?: string; department?: string }[];
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
  chat_mention: MessageSquare,
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
  chat_mention: "bg-purple-50 text-purple-600",
  system: "bg-primary/10 text-primary",
};

function useRelativeTime() {
  const { t } = useTranslation("common");
  return (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("notifications.justNow");
    if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("notifications.hoursAgo", { count: hours });
    return t("notifications.daysAgo", { count: Math.floor(hours / 24) });
  };
}

interface NavbarProps {
  onMenuClick?: () => void;
}

/** One labelled group of search results (Clubs / Events / Projects / People). */
function SearchGroup<T extends { id: string }>({
  title,
  icon: Icon,
  items,
  render,
  onPick,
}: {
  title: string;
  icon: React.ElementType;
  items: T[];
  render: (item: T) => string;
  onPick: (item: T) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="py-1 border-b border-border last:border-0">
      <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onPick(item)}
          className="w-full text-start px-4 py-2 flex items-center gap-3 hover:bg-muted transition-colors"
        >
          <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm truncate">{render(item)}</span>
        </button>
      ))}
    </div>
  );
}

export function Navbar({ onMenuClick }: NavbarProps = {}) {
  const { user, logout } = useAuth();
  const { t } = useTranslation("common");
  const { unreadCount, refresh: refreshUnread } = useNotifications();
  const navigate = useNavigate();
  const timeAgo = useRelativeTime();
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

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


  // Debounced global search across clubs / events / projects / users.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
        setSearchResults(data);
        setSearchOpen(true);
      } catch {
        // silent — search is best-effort
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchOpen]);

  function handleSearchNavigate(path: string) {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
    navigate(path);
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
      refreshUnread();
    }
    setOpen(false);
    if (notif.link) navigate(notif.link);
  }

  async function markAllRead() {
    try {
      await apiFetch("/api/notifications/read-all", { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      refreshUnread();
      window.dispatchEvent(new Event("notifications-updated"));
    } catch {
      // silent
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border z-50 flex items-center px-4 gap-2 md:gap-4">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          aria-label={t("a11y.openMenu")}
          className="md:hidden p-2 rounded-lg hover:bg-muted -ml-1"
        >
          <Menu className="w-5 h-5" />
        </button>
      )}
      <Link to="/" className="flex items-center mr-2 md:mr-6 flex-shrink-0">
        <img
          src="/logo.png"
          alt="CampusConnect"
          className="cc-logo h-12 md:h-14 w-auto object-contain"
        />
      </Link>

      <div ref={searchRef} className="relative flex-1 min-w-0 max-w-xl mx-2 md:mx-4">
        <div
          className={`flex items-center gap-2 bg-muted rounded-lg px-3 h-9 border transition-colors ${
            searchOpen ? "border-primary/40" : "border-transparent"
          }`}
        >
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => { if (searchResults) setSearchOpen(true); }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
          />
          {searchLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
          {searchQuery && !searchLoading && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label={t("actions.close")}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {searchOpen && searchResults && (
          <div className="absolute top-full mt-2 left-0 right-0 bg-card border border-border rounded-xl shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto z-50">
            {searchResults.clubs.length + searchResults.events.length + searchResults.projects.length + searchResults.users.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("search.noResults")}</div>
            ) : (
              <>
                <SearchGroup title={t("nav.clubs")} icon={Users} items={searchResults.clubs} render={(c) => c.name} onPick={(c) => handleSearchNavigate(`/clubs/${c.id}`)} />
                <SearchGroup title={t("nav.events")} icon={Calendar} items={searchResults.events} render={(e) => e.title} onPick={() => handleSearchNavigate(`/events`)} />
                <SearchGroup title={t("nav.projects")} icon={Briefcase} items={searchResults.projects} render={(p) => p.title} onPick={() => handleSearchNavigate(`/projects`)} />
                <SearchGroup title={t("search.users")} icon={UserIcon} items={searchResults.users} render={(u) => u.name} onPick={() => handleSearchNavigate(`/chats`)} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-3 flex-shrink-0">
        {user?.role === "admin" && (
          <span className="hidden sm:inline-flex px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary rounded-full border border-primary/20">
            {t("badges.admin")}
          </span>
        )}

        <div ref={wrapperRef} className="relative">
          <button
            onClick={toggleDropdown}
            aria-label={t("notifications.title")}
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
            // On phones (<sm) the dropdown is pinned just below the navbar
            // and spans the viewport with small side gaps so it stays
            // centred regardless of which icon spawned it. From sm: up
            // it anchors to the bell icon as before.
            <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2 sm:w-[380px] sm:max-w-[90vw] bg-card border border-border rounded-xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{t("notifications.title")}</h3>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-semibold rounded-full">
                      {t("notifications.newCount", { count: unreadCount })}
                    </span>
                  )}
                </div>
                <button
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  {t("actions.markAllRead")}
                </button>
              </div>

              <div className="max-h-[420px] overflow-y-auto">
                {loadingNotifs ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("state.loading")}</div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
                    <p className="text-sm text-muted-foreground">{t("notifications.allCaught")}</p>
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
                {t("notifications.viewAll")}
              </Link>
            </div>
          )}
        </div>

        <div ref={userMenuRef} className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label={t("a11y.userMenu")}
            className={`rounded-full transition-all ${userMenuOpen ? "ring-2 ring-primary/40" : "hover:opacity-80"}`}
          >
            <Avatar name={user?.name || "User"} size="sm" />
          </button>

          {userMenuOpen && (
            <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-16 sm:top-full sm:mt-2 sm:w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <Avatar name={user?.name || "User"} size="sm" />
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{user?.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                </div>
              </div>

              <Link
                to="/profile"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <UserIcon className="w-4 h-4 text-muted-foreground" />
                <span>{t("userMenu.profile")}</span>
              </Link>

              <Link
                to="/settings"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <SettingsIcon className="w-4 h-4 text-muted-foreground" />
                <span>{t("userMenu.settings")}</span>
              </Link>

              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-destructive/10 hover:text-destructive transition-colors text-left border-t border-border"
              >
                <LogOut className="w-4 h-4" />
                <span>{t("userMenu.logout")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
