-- ============================================================
-- 018: Extend Supabase Realtime to the remaining collaborative tables
-- ============================================================
-- Goal: any change (new club/event/project, a membership/RSVP/application,
-- an admin club request) reflects on other users' screens without a manual
-- refresh. The frontend subscribes to these tables and re-fetches through
-- the (RLS-scoped) FastAPI API on change, so the realtime event is only a
-- "something changed" trigger — no row data is rendered straight from it.
--
-- Realtime requires the table to be in the `supabase_realtime` publication.
-- Idempotent: each ADD is guarded, so re-running is a no-op.
-- ============================================================

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'clubs',
        'club_requests',
        'club_announcements',
        'events',
        'event_attendees',
        'project_posts',
        'project_applications',
        'workspace_members',
        'workspace_resources'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END
$$;
