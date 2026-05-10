import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";

interface NotificationContextType {
  /** Unread count for the bell icon (system notifications: project, club, etc.). */
  unreadCount: number;
  /** Unread count for chat messages — separate from the bell. */
  chatUnread: number;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

const POLL_INTERVAL_MS = 30_000;

/**
 * Centralised polling for both notification types. Keeps a single 30s
 * timer for the whole app instead of having Sidebar/Navbar each set up
 * their own.
 *
 * - `unreadCount`  → bell icon (notifications table)
 * - `chatUnread`   → next to "Chats" in Sidebar (messages table, summed)
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setChatUnread(0);
      return;
    }
    try {
      const [n, c] = await Promise.all([
        apiFetch("/api/notifications/unread-count").catch(() => ({ count: 0 })),
        apiFetch("/api/chats/unread-total").catch(() => ({ count: 0 })),
      ]);
      setUnreadCount(n?.count ?? 0);
      setChatUnread(c?.count ?? 0);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      setChatUnread(0);
      return;
    }
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onUpdated = () => refresh();
    window.addEventListener("notifications-updated", onUpdated);
    window.addEventListener("chat-unread-updated", onUpdated);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("notifications-updated", onUpdated);
      window.removeEventListener("chat-unread-updated", onUpdated);
    };
  }, [user, refresh]);

  return (
    <NotificationContext.Provider value={{ unreadCount, chatUnread, refresh }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside NotificationProvider");
  return ctx;
}
