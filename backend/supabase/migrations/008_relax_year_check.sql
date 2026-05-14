-- ============================================================
-- 008: Relax the year-of-study CHECK on public.users
-- ============================================================
-- Migration 001 set the column to BETWEEN 1 AND 6. That was wrong for
-- semester-based programs (8 semesters = 4 years) and for longer
-- programs (medicine, architecture). Edit-Profile crashes with
-- 23514 / users_year_check when the dropdown sends 7+.
--
-- New range: 1..12. Covers 6-year programs even when reported in
-- semesters. Still keeps the column away from junk like 99 or 0.
--
-- NULL stays allowed — many users don't fill the field.
-- ============================================================

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_year_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_year_check
    CHECK (year IS NULL OR (year BETWEEN 1 AND 12));

NOTIFY pgrst, 'reload schema';
