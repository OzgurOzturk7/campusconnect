import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

interface NotificationContextType {
  unreadCount: number;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const POLL_INTERVAL_MS = 30_000;

/**
 * Centralised unread-count polling. Without this, both Sidebar and Navbar
 * spawned their own setInterval — doubling traffic. Now there's exactly
 * one poll, and any component can call refresh() after an action.
 *
 * Components also listen to the `notifications-updated` window event so
 * legacy code paths that dispatch it still trigger a refresh.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    try {
      const data = await apiFetch("/api/notifications/unread-count");
      setUnreadCount(data?.count ?? 0);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onUpdated = () => refresh();
    window.addEventListener("notifications-updated", onUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("notifications-updated", onUpdated);
    };
  }, [user, refresh]);

  return (
    <NotificationContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
