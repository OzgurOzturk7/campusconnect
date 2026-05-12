import {
  RealtimeChannel,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
} from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/**
 * Realtime service — single seam between the app and Supabase Realtime.
 *
 * Keep direct `supabase.channel(...)` calls out of page/component code.
 * Importing from "../services/realtime" lets us swap the underlying transport
 * (Socket.IO, server-sent events, a different BaaS) without touching consumers.
 */

export type PostgresEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

export interface PostgresChangePayload<T = Record<string, unknown>> {
  event: "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string;
  new: T;
  old: T;
}

export interface SubscribeTableOptions<T> {
  /** Database table to watch. */
  table: string;
  /** Which DML events to listen for. Default: all. */
  event?: PostgresEvent;
  /** Supabase Realtime row filter, e.g. `"chat_id=eq.123"`. */
  filter?: string;
  /** Optional channel name override (handy for debugging). */
  channelName?: string;
  /** Called when a matching row changes. */
  onChange: (payload: PostgresChangePayload<T>) => void;
  /** Called when the subscription status changes (CONNECTING/SUBSCRIBED/etc). */
  onStatus?: (status: string) => void;
}

export interface Subscription {
  /** Tear down the subscription. Idempotent. */
  unsubscribe: () => void;
  /** Underlying channel, useful for sending broadcasts on the same channel. */
  channel: RealtimeChannel;
}

/**
 * Subscribe to Postgres CDC events on a table.
 *
 * Returns a `Subscription` you must call `.unsubscribe()` on when done.
 * Most consumers should use `useRealtimeChannel` instead — it handles cleanup.
 */
export function subscribeToTable<T = Record<string, unknown>>(
  opts: SubscribeTableOptions<T>
): Subscription {
  const name = opts.channelName ?? `${opts.table}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase.channel(name);

  channel.on(
    REALTIME_LISTEN_TYPES.POSTGRES_CHANGES as never,
    {
      event: (opts.event ?? "*") as REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
      schema: "public",
      table: opts.table,
      ...(opts.filter ? { filter: opts.filter } : {}),
    } as never,
    (payload: unknown) => opts.onChange(payload as PostgresChangePayload<T>)
  );

  channel.subscribe((status) => opts.onStatus?.(status));

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
    channel,
  };
}

/**
 * Subscribe to a Supabase Realtime broadcast channel. Use for ephemeral
 * messages (typing indicators, cursor positions) that aren't persisted.
 */
export function subscribeToBroadcast<T = unknown>(opts: {
  channelName: string;
  event: string;
  onMessage: (payload: T) => void;
  /** Default false — the sender doesn't usually need to hear themselves. */
  receiveOwnMessages?: boolean;
}): Subscription {
  const channel = supabase.channel(opts.channelName, {
    config: { broadcast: { self: !!opts.receiveOwnMessages } },
  });

  channel.on(
    REALTIME_LISTEN_TYPES.BROADCAST as never,
    { event: opts.event } as never,
    (payload: { payload: T }) => opts.onMessage(payload.payload)
  );

  channel.subscribe();

  return {
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
    channel,
  };
}

/** Send a broadcast message on an existing channel. */
export async function broadcast(channel: RealtimeChannel, event: string, payload: unknown) {
  await channel.send({ type: "broadcast", event, payload });
}
