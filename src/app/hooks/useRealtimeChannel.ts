import { useEffect } from "react";
import {
  subscribeToTable,
  type PostgresEvent,
  type PostgresChangePayload,
} from "../services/realtime";

/**
 * React hook over `subscribeToTable` with automatic teardown.
 *
 * Re-subscribes when any of `table`, `event`, or `filter` change. The
 * callback is captured *at subscription time* by design — pass a stable
 * function (via useCallback) if it closes over state that changes often.
 *
 * Pass `enabled: false` to skip subscription temporarily (e.g. when a
 * required ID isn't loaded yet) without ripping the hook out of the tree.
 *
 * @example
 *   useRealtimeChannel({
 *     table: "notifications",
 *     filter: `user_id=eq.${userId}`,
 *     onChange: () => refresh(),
 *     enabled: !!userId,
 *   });
 */
export function useRealtimeChannel<T = Record<string, unknown>>(opts: {
  table: string;
  event?: PostgresEvent;
  filter?: string;
  channelName?: string;
  enabled?: boolean;
  onChange: (payload: PostgresChangePayload<T>) => void;
  onStatus?: (status: string) => void;
}) {
  const { table, event, filter, channelName, enabled = true, onChange, onStatus } = opts;

  useEffect(() => {
    if (!enabled) return;
    const sub = subscribeToTable<T>({
      table,
      event,
      filter,
      channelName,
      onChange,
      onStatus,
    });
    return () => sub.unsubscribe();
    // We intentionally don't depend on `onChange`/`onStatus`. Re-subscribing
    // on every render that creates a new function reference would thrash the
    // channel. Consumers should wrap callbacks in useCallback if they need
    // fresh closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, event, filter, channelName, enabled]);
}
