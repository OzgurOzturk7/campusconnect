-- ============================================================
-- 017 — One chat per project
-- Application-level helpers (_get_or_create_project_chat,
-- _create_or_get_direct_chat) already try to be idempotent, but two
-- concurrent requests can still end up creating two chat rows for the
-- same project_id because the check-then-insert isn't atomic. This
-- migration adds the DB constraint that makes duplicates impossible.
--
-- Safe to apply to a live DB:
--   1) First, merge any existing duplicate chats. The oldest chat
--      (smallest created_at) wins; messages and members from younger
--      duplicates are moved over, then the empty rows are deleted.
--   2) Then create the partial unique index. Partial because direct
--      and group chats have project_id IS NULL — only the project
--      chats need to be unique.
-- ============================================================

DO $$
DECLARE
    grp RECORD;
    winner_id UUID;
BEGIN
    FOR grp IN
        SELECT project_id
        FROM public.chats
        WHERE project_id IS NOT NULL
        GROUP BY project_id
        HAVING COUNT(*) > 1
    LOOP
        -- Pick the oldest chat as the survivor.
        SELECT id INTO winner_id
        FROM public.chats
        WHERE project_id = grp.project_id
        ORDER BY created_at ASC
        LIMIT 1;

        -- Move messages from losers into the winner so chat history is
        -- preserved. The bump_chat_updated_at trigger fires per row,
        -- which is fine.
        UPDATE public.messages
           SET chat_id = winner_id
         WHERE chat_id IN (
                SELECT id FROM public.chats
                 WHERE project_id = grp.project_id AND id <> winner_id
              );

        -- Merge member rows. (chat_id, user_id) is the PK, so the
        -- ON CONFLICT clause skips users who are already in the winner.
        INSERT INTO public.chat_members (chat_id, user_id, role, joined_at, last_read_at, is_muted, hidden_at, pinned_at)
        SELECT winner_id, cm.user_id, cm.role, cm.joined_at, cm.last_read_at, cm.is_muted, cm.hidden_at, cm.pinned_at
          FROM public.chat_members cm
         WHERE cm.chat_id IN (
                SELECT id FROM public.chats
                 WHERE project_id = grp.project_id AND id <> winner_id
              )
        ON CONFLICT (chat_id, user_id) DO NOTHING;

        -- Drop the now-empty loser rows. CASCADE handles their
        -- chat_members + any stragglers.
        DELETE FROM public.chats
         WHERE project_id = grp.project_id AND id <> winner_id;
    END LOOP;
END $$;

-- Partial unique: only project chats need uniqueness on project_id.
CREATE UNIQUE INDEX IF NOT EXISTS chats_project_id_uniq
    ON public.chats (project_id)
    WHERE project_id IS NOT NULL;
