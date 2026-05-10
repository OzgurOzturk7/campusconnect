-- ============================================================
-- 005 — Extras: project deadline + applications cv/links + chat per-user delete
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1) Project applications: optional CV file URL + extra links (JSON array)
ALTER TABLE public.project_applications
    ADD COLUMN IF NOT EXISTS cv_url TEXT,
    ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]';
-- links shape: [{"label": "GitHub", "url": "https://github.com/foo"}, ...]

-- 2) Project posts: deadline + start date so we can show progress / time-left
ALTER TABLE public.project_posts
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS deadline   DATE;

-- 3) Chat members: per-user "deleted_at" so a direct chat removed by one
--    side disappears for them but the other side still sees history.
--    Group chats: leaving == row delete (existing behaviour). After leaving,
--    the chat appears for nobody in their list.
ALTER TABLE public.chat_members
    ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 4) Storage: chat-files bucket already covers attachments. No new bucket needed
--    for the in-chat "files archive" — we'll query messages where
--    attachment_url is not null.

-- 5) Storage: applications-cv bucket for CV uploads (one bucket reused for
--    all CVs). Create it via Supabase Dashboard:
--    Name: applications-cv     Public: NO
-- INSERT INTO storage.buckets (id, name, public) VALUES ('applications-cv', 'applications-cv', false)
-- ON CONFLICT (id) DO NOTHING;
