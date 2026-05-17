-- ============================================================
-- 010: Clean up orphaned "accepted" project_applications
-- ============================================================
-- Before the workspace remove_member endpoint started cascading the
-- delete to project_applications, every member the owner removed left
-- behind an "accepted" row. The user saw "Application Accepted" on the
-- project card forever and couldn't re-apply.
--
-- This migration deletes those orphans: rows where status='accepted'
-- but the applicant is NOT currently in the project's workspace_members.
-- It is safe to re-run.
-- ============================================================

DELETE FROM public.project_applications pa
WHERE pa.status = 'accepted'
  AND NOT EXISTS (
        SELECT 1
        FROM public.workspaces w
        JOIN public.workspace_members wm
          ON wm.workspace_id = w.id
         AND wm.user_id      = pa.applicant_id
        WHERE w.project_id = pa.project_id
  );

NOTIFY pgrst, 'reload schema';
