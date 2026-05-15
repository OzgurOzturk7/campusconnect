import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthContext";
import { useRealtimeChannel } from "../hooks/useRealtimeChannel";

interface NotificationContextType {
  /** Unread count for the bell icon (system notifications: project, club, etc.). */
  unreadCount: number;
  /** Unread count for chat messages — separate from the bell. */
  chatUnread: number;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

// Fallback poll cadence. Realtime is the primary signal; this catches the rare
// case where a Realtime subscription drops without us noticing.
const POLL_INTERVAL_MS = 60_000;

/**
 * Centralised state for the two unread badges shown in the chrome.
 *
 * - `unreadCount`  → bell icon (notifications table)
 * - `chatUnread`   → "Chats" badge (messages, summed; muted chats excluded by the API)
 *
 * Realtime: subscribes to `notifications` rows filtered by user_id and to
 * `messages` (any chat — we re-query the server for the correct, mute-aware
 * count). The 60s poll is a safety net.
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

  // Realtime: bell badge updates the moment a notification row appears for
  // the current user, instead of waiting up to 60s for the poll.
  useRealtimeChannel({
    table: "notifications",
    event: "INSERT",
    filter: user ? `user_id=eq.${user.user_id}` : undefined,
    enabled: !!user,
    onChange: () => refresh(),
  });

  // Chat unread badge: the old implementation subscribed to every INSERT
  // on the public.messages table — that meant every signed-in client
  // re-queried `/unread-total` for every chat message sent anywhere on
  // the platform. With 100 users chatting the cost was quadratic.
  //
  // The refresh signals we keep are:
  //   1. The 60s safety poll above (already in the useEffect).
  //   2. The "chat-unread-updated" window event Chat.tsx dispatches
  //      whenever the active chat changes its unread state (markRead,
  //      send, etc.).
  //   3. Realtime subscription on chat_members filtered by user_id —
  //      catches admin add/remove and the soft-hide reset on a new
  //      direct message (the send_message endpoint nulls hidden_at,
  //      which writes to chat_members).
  useRealtimeChannel({
    table: "chat_members",
    event: "*",
    filter: user ? `user_id=eq.${user.user_id}` : undefined,
    enabled: !!user,
    onChange: () => refresh(),
  });

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
