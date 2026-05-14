-- ============================================================
-- 009: Extend club_requests for richer review flow
-- ============================================================
-- New columns:
--   motivation  TEXT  — why the requester wants this club, shown to
--                       reviewing admins.
--   is_open     BOOLEAN — open-membership flag carried from the request
--                         into the resulting club on approval.
--
-- Both default to safe values so existing rows stay valid.
-- ============================================================

ALTER TABLE public.club_requests
    ADD COLUMN IF NOT EXISTS motivation TEXT,
    ADD COLUMN IF NOT EXISTS is_open    BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';
