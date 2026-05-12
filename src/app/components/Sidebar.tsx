import { Home, User, Users, Calendar, Briefcase, MessageCircle, Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
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

export function Sidebar() {
  const location = useLocation();
  const { user: _user } = useAuth();
  const { t } = useTranslation("common");
  const { unreadCount, chatUnread } = useNotifications();

  return (
    <aside className="hidden md:block fixed left-0 top-16 w-64 h-[calc(100vh-4rem)] bg-card border-r border-border overflow-y-auto">
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
    </aside>
  );
}
