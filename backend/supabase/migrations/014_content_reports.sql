-- ============================================================
-- 014 — Content reports (moderation)
-- Users flag inappropriate content (currently chat messages);
-- platform admins review and resolve them from Settings → Reports.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.content_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content_type      TEXT NOT NULL DEFAULT 'message',
    content_id        TEXT NOT NULL,
    -- Snapshot of the reported text at report time, so the report still
    -- makes sense even if the original message is later deleted.
    content_preview   TEXT,
    reported_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    chat_id           UUID,
    reason            TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'reviewed', 'dismissed')),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_reports_status_idx
    ON public.content_reports (status, created_at DESC);

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Backend manages this through the service-role client; no direct
-- anon/authenticated access. Creation and review go through API routes.
DROP POLICY IF EXISTS "Service role manages content reports" ON public.content_reports;
CREATE POLICY "Service role manages content reports"
    ON public.content_reports FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
