import { Home, User, Users, Calendar, Briefcase, MessageCircle, Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useNotifications } from "../context/NotificationContext";
import type { TranslationKey } from "../lib/i18n";

const navItems: { icon: any; key: TranslationKey; path: string }[] = [
  { icon: Home, key: "nav_dashboard", path: "/" },
  { icon: User, key: "nav_profile", path: "/profile" },
  { icon: Users, key: "nav_clubs", path: "/clubs" },
  { icon: Calendar, key: "nav_events", path: "/events" },
  { icon: Briefcase, key: "nav_projects", path: "/projects" },
  { icon: MessageCircle, key: "nav_chats", path: "/chats" },
  { icon: Bell, key: "nav_notifications", path: "/notifications" },
];

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();

  return (
    <aside className="fixed left-0 top-16 w-64 h-[calc(100vh-4rem)] bg-card border-r border-border overflow-y-auto">
      <nav className="p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            location.pathname === item.path ||
            (item.path !== "/" && location.pathname.startsWith(item.path));
          const isNotifications = item.path === "/notifications";

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
              {isNotifications && unreadCount > 0 && (
                <span className="w-5 h-5 bg-destructive text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}