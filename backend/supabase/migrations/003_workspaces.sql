-- ============================================================
-- CampusConnect — Workspace Feature Migration
-- Run this in the Supabase SQL Editor (after 001 and 002)
-- ============================================================

-- 1) workspaces — one per project, auto-created on project creation
CREATE TABLE IF NOT EXISTS public.workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL UNIQUE REFERENCES public.project_posts(id) ON DELETE CASCADE,
    stage       TEXT NOT NULL DEFAULT 'recruiting'
                    CHECK (stage IN ('recruiting', 'planning', 'development', 'testing', 'launch', 'completed')),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_project_id ON public.workspaces(project_id);

-- 2) workspace_members — tracks every member with their role
CREATE TABLE IF NOT EXISTS public.workspace_members (
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member'
                     CHECK (role IN ('owner', 'admin', 'member')),
    joined_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);

-- 3) workspace_tasks — kanban cards
CREATE TABLE IF NOT EXISTS public.workspace_tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    assignee_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_by   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo', 'in_progress', 'review', 'done')),
    priority     TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_date     DATE,
    position     INTEGER DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_ws  ON public.workspace_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_pos ON public.workspace_tasks(workspace_id, status, position);

-- 4) workspace_task_comments
CREATE TABLE IF NOT EXISTS public.workspace_task_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES public.workspace_tasks(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.workspace_task_comments(task_id, created_at);

-- 5) workspace_resources — shared links (GitHub, Figma, Drive, etc.)
CREATE TABLE IF NOT EXISTS public.workspace_resources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    added_by     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    url          TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'link'
                     CHECK (type IN ('github', 'figma', 'drive', 'notion', 'meeting', 'link')),
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_resources_ws ON public.workspace_resources(workspace_id);

-- 6) workspace_activity_logs — audit / feed
CREATE TABLE IF NOT EXISTS public.workspace_activity_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,      -- e.g. 'member_joined', 'task_created', 'stage_updated'
    entity_type  TEXT,               -- e.g. 'task', 'resource', 'member'
    entity_id    UUID,
    metadata     JSONB DEFAULT '{}', -- flexible extra data (task title, etc.)
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_ws ON public.workspace_activity_logs(workspace_id, created_at DESC);

-- 7) Trigger: bump workspaces.updated_at on task changes
CREATE OR REPLACE FUNCTION public.bump_workspace_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.workspaces SET updated_at = NOW() WHERE id = NEW.workspace_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_bump_workspace ON public.workspace_tasks;
CREATE TRIGGER trg_tasks_bump_workspace
    AFTER INSERT OR UPDATE ON public.workspace_tasks
    FOR EACH ROW EXECUTE FUNCTION public.bump_workspace_updated_at();

-- 8) Enable Realtime for live task board + activity updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_activity_logs;

-- 9) Row Level Security
ALTER TABLE public.workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_tasks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_resources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_activity_logs ENABLE ROW LEVEL SECURITY;

-- Helper: is the calling user a member of this workspace?
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.workspace_members
        WHERE workspace_id = ws_id AND user_id = auth.uid()
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- workspaces: members can read; service role owns writes
DROP POLICY IF EXISTS "Workspace members can read" ON public.workspaces;
CREATE POLICY "Workspace members can read" ON public.workspaces FOR SELECT
    USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "Service role manages workspaces" ON public.workspaces;
CREATE POLICY "Service role manages workspaces" ON public.workspaces FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- workspace_members
DROP POLICY IF EXISTS "Members can read workspace_members" ON public.workspace_members;
CREATE POLICY "Members can read workspace_members" ON public.workspace_members FOR SELECT
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Service role manages workspace_members" ON public.workspace_members;
CREATE POLICY "Service role manages workspace_members" ON public.workspace_members FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- workspace_tasks
DROP POLICY IF EXISTS "Members can read tasks" ON public.workspace_tasks;
CREATE POLICY "Members can read tasks" ON public.workspace_tasks FOR SELECT
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Service role manages tasks" ON public.workspace_tasks;
CREATE POLICY "Service role manages tasks" ON public.workspace_tasks FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- workspace_task_comments
DROP POLICY IF EXISTS "Members can read task comments" ON public.workspace_task_comments;
CREATE POLICY "Members can read task comments" ON public.workspace_task_comments FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.workspace_tasks t
        WHERE t.id = task_id AND public.is_workspace_member(t.workspace_id)
    ));

DROP POLICY IF EXISTS "Service role manages task comments" ON public.workspace_task_comments;
CREATE POLICY "Service role manages task comments" ON public.workspace_task_comments FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- workspace_resources
DROP POLICY IF EXISTS "Members can read resources" ON public.workspace_resources;
CREATE POLICY "Members can read resources" ON public.workspace_resources FOR SELECT
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Service role manages resources" ON public.workspace_resources;
CREATE POLICY "Service role manages resources" ON public.workspace_resources FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- workspace_activity_logs
DROP POLICY IF EXISTS "Members can read activity" ON public.workspace_activity_logs;
CREATE POLICY "Members can read activity" ON public.workspace_activity_logs FOR SELECT
    USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Service role manages activity" ON public.workspace_activity_logs;
CREATE POLICY "Service role manages activity" ON public.workspace_activity_logs FOR ALL
    USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 10) BACKFILL: create workspaces for every existing project
-- ============================================================
DO $$
DECLARE
    p RECORD;
    ws_id UUID;
BEGIN
    FOR p IN SELECT id, owner_id FROM public.project_posts LOOP
        IF EXISTS (SELECT 1 FROM public.workspaces WHERE project_id = p.id) THEN
            CONTINUE;
        END IF;

        INSERT INTO public.workspaces (project_id, stage)
        VALUES (p.id, 'recruiting')
        RETURNING id INTO ws_id;

        -- owner as workspace owner
        INSERT INTO public.workspace_members (workspace_id, user_id, role)
        VALUES (ws_id, p.owner_id, 'owner')
        ON CONFLICT DO NOTHING;

        -- accepted applicants as members
        INSERT INTO public.workspace_members (workspace_id, user_id, role)
        SELECT ws_id, applicant_id, 'member'
        FROM public.project_applications
        WHERE project_id = p.id AND status = 'accepted'
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
