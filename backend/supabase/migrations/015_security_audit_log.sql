-- ============================================================
-- 015 — Security audit log
-- Append-only record of security-relevant events (login, password
-- change, invite, role change). Written best-effort by the backend;
-- a failed insert never blocks the underlying action.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.security_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  TEXT NOT NULL,
    -- Subject of the event (e.g. the user who logged in / was invited).
    user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    -- Who performed it, when different from the subject (e.g. admin inviting).
    actor_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
    detail      TEXT,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_audit_log_event_idx
    ON public.security_audit_log (event_type, created_at DESC);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

-- Backend (service-role) writes/reads only; no direct anon/authenticated access.
DROP POLICY IF EXISTS "Service role manages audit log" ON public.security_audit_log;
CREATE POLICY "Service role manages audit log"
    ON public.security_audit_log FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
