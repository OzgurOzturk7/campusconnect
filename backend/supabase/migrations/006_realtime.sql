-- ============================================================
-- 006: Enable Supabase Realtime on notifications + messages
-- ============================================================
-- The frontend NotificationProvider subscribes to these tables so the
-- bell badge and chat badge update without a 60s poll. Realtime requires
-- the table to be added to the `supabase_realtime` publication.
--
-- `notifications` rows are filtered client-side by user_id; row-level
-- security must permit SELECT on the user's own rows for the filter to
-- match — the existing RLS policies already cover this.
--
-- Idempotent: re-running this is a no-op.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
END
$$;
