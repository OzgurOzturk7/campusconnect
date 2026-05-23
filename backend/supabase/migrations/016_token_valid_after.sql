-- ============================================================
-- 016 — Session invalidation support
-- Tokens issued before this timestamp are rejected for the user.
-- Set on password change so old / stolen sessions stop working.
-- NULL (the default) means "no invalidation yet" — existing tokens
-- keep working, so this migration is safe to apply to a live DB.
-- ============================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS token_valid_after TIMESTAMPTZ;
