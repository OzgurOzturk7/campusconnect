import { Home, User, Users, Calendar, Briefcase, MessageCircle, Bell, X } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useNotifications } from "../context/NotificationContext";

const navItems: { icon: any; key: string; path: string }[] = [
  { icon: Home, key: "nav.dashboard", path: "/" },
  { icon: User, key: "nav.profile", path: "/profile" },
  { icon: Users, key: "nav.clubs", path: "/clubs" },
  { icon: Calendar, key: "nav.events", path: "/events" },
  { icon: Briefcase, key: "nav.projects", path: "/projects" },
  { icon: MessageCircle, key: "nav.chats", path: "/chats" },
  { icon: Bell, key: "nav.notifications", path: "/notifications" },
];

interface SidebarProps {
  /** Mobile drawer open state. Desktop sidebar ignores this. */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const { t } = useTranslation("common");
  const { unreadCount, chatUnread } = useNotifications();

  // Close the mobile drawer whenever the route changes so it doesn't linger
  // after a tap.
  useEffect(() => {
    if (mobileOpen) onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const navContent = (
    <nav className="p-4 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          location.pathname === item.path ||
          (item.path !== "/" && location.pathname.startsWith(item.path));
        const isNotifications = item.path === "/notifications";
        const isChats = item.path === "/chats";
        const badgeValue =
          isNotifications ? unreadCount :
          isChats ? chatUnread : 0;

        return (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="font-medium flex-1">{t(item.key)}</span>
            {badgeValue > 0 && (
              <span className="min-w-[22px] h-5 px-1.5 bg-destructive text-white text-xs rounded-full flex items-center justify-center font-bold">
                {badgeValue > 99 ? "99+" : badgeValue}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop — always-visible left rail */}
      <aside className="hidden md:block fixed left-0 top-16 w-64 h-[calc(100vh-4rem)] bg-card border-r border-border overflow-y-auto">
        {navContent}
      </aside>

      {/* Mobile — slide-in drawer */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!mobileOpen}
      >
        <div className="absolute inset-0 bg-black/40" onClick={onMobileClose} />
        <aside
          className={`absolute top-0 left-0 h-full w-72 max-w-[85vw] bg-card border-r border-border shadow-xl transform transition-transform ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          role="dialog"
          aria-label={t("a11y.navigation")}
        >
          <div className="h-16 flex items-center justify-between px-4 border-b border-border">
            <span className="font-bold">{t("a11y.menu")}</span>
            <button
              onClick={onMobileClose}
              aria-label={t("a11y.closeMenu")}
              className="p-2 rounded-lg hover:bg-muted"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="overflow-y-auto h-[calc(100%-4rem)]">{navContent}</div>
        </aside>
      </div>
    </>
  );
}
