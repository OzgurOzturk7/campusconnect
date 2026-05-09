import { Bell, LogOut } from "lucide-react";
import { Link } from "react-router";
import { Avatar } from "./Avatar";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export function Navbar() {
  const { user, logout } = useAuth();
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

  async function fetchUnreadCount() {
    try {
      const data = await apiFetch("/api/notifications/unread-count");
      setUnreadCount(data.count);
    } catch {
      // silent fail
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
          placeholder="Search students, clubs, projects..."
          className="w-full pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border border-transparent focus:border-primary focus:outline-none transition-colors"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {user?.role === "admin" && (
          <span className="px-2.5 py-1 text-xs font-semibold bg-primary/10 text-primary rounded-full border border-primary/20">
            Admin
          </span>
        )}

        <Link to="/notifications" className="relative p-2 rounded-lg hover:bg-muted transition-colors">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-xs rounded-full flex items-center justify-center font-bold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <Link to="/profile">
          <Avatar name={user?.name || "User"} size="sm" />
        </Link>

        <button
          onClick={logout}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}