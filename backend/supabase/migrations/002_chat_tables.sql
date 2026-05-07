-- ============================================================
-- CampusConnect — Chat Feature Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 0) DROP old study_groups tables (replaced by chat system)
DROP TABLE IF EXISTS public.study_group_messages CASCADE;
DROP TABLE IF EXISTS public.study_group_members CASCADE;
DROP TABLE IF EXISTS public.study_groups CASCADE;
DROP TABLE IF EXISTS public.study_group_files CASCADE;

-- 1) chats table
CREATE TABLE IF NOT EXISTS public.chats (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL CHECK (type IN ('direct', 'group', 'project')),
    title       TEXT,                                       -- group/project title (null for direct DMs)
    avatar_url  TEXT,
    project_id  UUID REFERENCES public.project_posts(id) ON DELETE CASCADE,
    created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chats_project_id ON public.chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON public.chats(updated_at DESC);

-- 2) chat_members
CREATE TABLE IF NOT EXISTS public.chat_members (
    chat_id        UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at      TIMESTAMPTZ DEFAULT NOW(),
    last_read_at   TIMESTAMPTZ DEFAULT NOW(),
    is_muted       BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON public.chat_members(user_id);

-- 3) messages
CREATE TABLE IF NOT EXISTS public.messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    body            TEXT,
    attachment_url  TEXT,
    attachment_type TEXT CHECK (attachment_type IN ('image', 'video', 'file', 'audio')),
    attachment_name TEXT,
    reply_to_id     UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    is_pinned       BOOLEAN DEFAULT FALSE,
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    CHECK (body IS NOT NULL OR attachment_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON public.messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON public.messages(chat_id) WHERE is_pinned = TRUE;
-- Full-text search on body
CREATE INDEX IF NOT EXISTS idx_messages_body_search ON public.messages USING gin (to_tsvector('simple', coalesce(body, '')));

-- 4) message_reactions
CREATE TABLE IF NOT EXISTS public.message_reactions (
    message_id  UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON public.message_reactions(message_id);

-- 5) Trigger: bump chats.updated_at when a new message arrives (for sorting chat list)
CREATE OR REPLACE FUNCTION public.bump_chat_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.chats SET updated_at = NEW.created_at WHERE id = NEW.chat_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_bump_chat ON public.messages;
CREATE TRIGGER trg_messages_bump_chat
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.bump_chat_updated_at();

-- 6) Enable Realtime publication for these tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;

-- 7) Row Level Security
ALTER TABLE public.chats             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- chats: members can read; service role manages writes
DROP POLICY IF EXISTS "Members can read chats" ON public.chats;
CREATE POLICY "Members can read chats" ON public.chats FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.chat_members cm
        WHERE cm.chat_id = id AND cm.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role manages chats" ON public.chats;
CREATE POLICY "Service role manages chats" ON public.chats FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- chat_members: members of the chat can read membership; service role writes
DROP POLICY IF EXISTS "Members can read membership" ON public.chat_members;
CREATE POLICY "Members can read membership" ON public.chat_members FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.chat_members cm
        WHERE cm.chat_id = chat_members.chat_id AND cm.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role manages membership" ON public.chat_members;
CREATE POLICY "Service role manages membership" ON public.chat_members FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- messages: members can read & insert; only sender can update/delete
DROP POLICY IF EXISTS "Members can read messages" ON public.messages;
CREATE POLICY "Members can read messages" ON public.messages FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.chat_members cm
        WHERE cm.chat_id = messages.chat_id AND cm.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role manages messages" ON public.messages;
CREATE POLICY "Service role manages messages" ON public.messages FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- reactions: members can read; service role manages
DROP POLICY IF EXISTS "Members can read reactions" ON public.message_reactions;
CREATE POLICY "Members can read reactions" ON public.message_reactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.messages m
        JOIN public.chat_members cm ON cm.chat_id = m.chat_id
        WHERE m.id = message_reactions.message_id AND cm.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Service role manages reactions" ON public.message_reactions;
CREATE POLICY "Service role manages reactions" ON public.message_reactions FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 8) BACKFILL: existing projects → create project chats and add members
-- ============================================================
DO $$
DECLARE
    p RECORD;
    new_chat_id UUID;
BEGIN
    FOR p IN SELECT id, title, owner_id FROM public.project_posts LOOP
        -- skip if a chat already exists for this project
        IF EXISTS (SELECT 1 FROM public.chats WHERE project_id = p.id) THEN
            CONTINUE;
        END IF;

        INSERT INTO public.chats (type, title, project_id, created_by)
        VALUES ('project', p.title, p.id, p.owner_id)
        RETURNING id INTO new_chat_id;

        -- add owner as admin
        INSERT INTO public.chat_members (chat_id, user_id, role)
        VALUES (new_chat_id, p.owner_id, 'admin')
        ON CONFLICT DO NOTHING;

        -- add accepted applicants as members
        INSERT INTO public.chat_members (chat_id, user_id, role)
        SELECT new_chat_id, applicant_id, 'member'
        FROM public.project_applications
        WHERE project_id = p.id AND status = 'accepted'
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- ============================================================
-- 9) STORAGE BUCKET for chat media
-- Run this separately in the Supabase Dashboard → Storage → "New bucket":
--    Name: chat-media
--    Public: NO  (we'll generate signed URLs from backend)
-- Or via SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('chat-media', 'chat-media', false)
-- ON CONFLICT (id) DO NOTHING;
-- ============================================================
