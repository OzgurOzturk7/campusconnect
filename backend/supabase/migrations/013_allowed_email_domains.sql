-- ============================================================
-- 013 — Configurable allowed email domains
-- Admin-managed whitelist for invites + Google sign-in.
-- Replaces the static INVITE_ALLOWED_DOMAINS env value and the
-- hardcoded ALLOWED_GOOGLE_DOMAIN. The backend falls back to the
-- env value when this table has no active rows, so an admin can
-- never accidentally lock everyone out by emptying the list.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.allowed_email_domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain      TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.allowed_email_domains ENABLE ROW LEVEL SECURITY;

-- The backend manages this table through the service-role client
-- (which bypasses RLS). There is no direct anon/authenticated access;
-- all reads and writes go through admin-guarded API routes.
DROP POLICY IF EXISTS "Service role manages allowed domains" ON public.allowed_email_domains;
CREATE POLICY "Service role manages allowed domains"
    ON public.allowed_email_domains FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Seed the default university domain (no-op if it already exists).
INSERT INTO public.allowed_email_domains (domain, is_active)
VALUES ('final.edu.tr', TRUE)
ON CONFLICT (domain) DO NOTHING;
