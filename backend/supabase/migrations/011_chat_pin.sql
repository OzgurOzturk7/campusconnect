-- ============================================================
-- 011: Per-user chat pinning
-- ============================================================
-- Adds `pinned_at` to chat_members so each user can pin chats to the
-- top of their own list without affecting anyone else's ordering.
-- NULL = not pinned. The newest pin floats above older pins.
-- ============================================================

ALTER TABLE public.chat_members
    ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_members_user_pinned
    ON public.chat_members(user_id, pinned_at DESC NULLS LAST);

NOTIFY pgrst, 'reload schema';
