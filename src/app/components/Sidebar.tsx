import { Home, User, Users, Calendar, Briefcase, BookOpen, Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { icon: Home, label: "Dashboard", path: "/" },
  { icon: User, label: "Profile", path: "/profile" },
  { icon: Users, label: "Clubs", path: "/clubs" },
  { icon: Calendar, label: "Events", path: "/events" },
  { icon: Briefcase, label: "Projects", path: "/projects" },
  { icon: BookOpen, label: "Study Groups", path: "/study-groups" },
  { icon: Bell, label: "Notifications", path: "/notifications" },
];

export function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Refresh count when navigating away from notifications
  useEffect(() => {
    if (location.pathname !== "/notifications") {
      fetchUnreadCount();
    }
  }, [location.pathname]);

  async function fetchUnreadCount() {
    try {
      const data = await apiFetch("/api/notifications/unread-count");
      setUnreadCount(data.count ?? 0);
    } catch {
      // silent fail
    }
  }

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
              <span className="font-medium flex-1">{item.label}</span>
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