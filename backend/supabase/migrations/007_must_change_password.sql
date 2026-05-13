-- ============================================================
-- 007: First-login forced password change
-- ============================================================
-- Adds a flag to public.users that the login flow checks. When TRUE the
-- frontend redirects to /onboarding and refuses to navigate elsewhere
-- until the user picks a real password.
--
-- Existing rows default FALSE (they've already chosen their password by
-- definition — they're in the system). Only newly invited users start
-- with TRUE.
-- ============================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing user profiles stay opted out of the onboarding flow.
UPDATE public.users SET must_change_password = FALSE
WHERE must_change_password IS NULL;

NOTIFY pgrst, 'reload schema';
