-- ============================================================
-- 012: Enforce one application per (project, applicant)
-- ============================================================
-- A user is meant to have at most one application row per project.
-- The apply endpoint already checks this before INSERT, but two
-- concurrent POSTs can both pass the check and both insert, leaving a
-- duplicate pending application that confuses the owner's review queue.
-- We add a DB-level guarantee.
--
-- Before creating the unique index, we deduplicate existing rows. The
-- tiebreaker is status priority: accepted > pending > rejected. Within
-- the same status we keep the newest row. This preserves rows that
-- back real workspace memberships (accepted) at all costs.
-- ============================================================

WITH ranked AS (
    SELECT
        id,
        project_id,
        applicant_id,
        ROW_NUMBER() OVER (
            PARTITION BY project_id, applicant_id
            ORDER BY
                CASE status
                    WHEN 'accepted' THEN 0
                    WHEN 'pending'  THEN 1
                    WHEN 'rejected' THEN 2
                    ELSE 3
                END,
                created_at DESC
        ) AS rn
    FROM public.project_applications
)
DELETE FROM public.project_applications pa
USING ranked r
WHERE pa.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_project_application
    ON public.project_applications (project_id, applicant_id);

NOTIFY pgrst, 'reload schema';
