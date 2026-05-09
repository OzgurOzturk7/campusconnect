-- ============================================================
-- Club roles cleanup
-- - Remove the legacy "admin" role from club_memberships
--   (only "member" and "president" are valid going forward)
-- - Anyone who was role='admin' in a club is downgraded to 'member'
-- - Optionally tighten the CHECK constraint to enforce this
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1) Demote any existing club admins to members
UPDATE public.club_memberships
SET role = 'member'
WHERE role = 'admin';

-- 2) (Optional) Tighten constraint so future inserts can't use 'admin'
-- If your column has an existing CHECK constraint, drop it first.
-- The constraint name varies by environment — list them with:
--    SELECT conname FROM pg_constraint WHERE conrelid = 'public.club_memberships'::regclass;
-- and replace `club_memberships_role_check` below if different.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.club_memberships'::regclass
          AND conname = 'club_memberships_role_check'
    ) THEN
        ALTER TABLE public.club_memberships DROP CONSTRAINT club_memberships_role_check;
    END IF;
END $$;

ALTER TABLE public.club_memberships
    ADD CONSTRAINT club_memberships_role_check
    CHECK (role IN ('member', 'president'));
