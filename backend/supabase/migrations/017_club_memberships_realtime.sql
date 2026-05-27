-- ============================================================
-- 017: Enable Supabase Realtime on club_memberships
-- ============================================================
-- ClubDetail subscribes to this table (filtered by club_id) so that
-- join requests and approve/reject decisions reflect instantly for the
-- other party — the president sees new applications without a refresh,
-- and the applicant sees the decision without a refresh. Realtime
-- requires the table to be in the `supabase_realtime` publication.
--
-- Idempotent: re-running this is a no-op.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'club_memberships'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.club_memberships;
    END IF;
END
$$;
