-- ============================================================
-- Tier 1 alignment: user roles and submitted_by_role values
-- ============================================================

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'department_head';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE budgets
  DROP CONSTRAINT IF EXISTS budgets_submitted_by_role_check;

ALTER TABLE budgets
  ADD CONSTRAINT budgets_submitted_by_role_check
  CHECK (
    submitted_by_role IS NULL
    OR submitted_by_role IN ('team_leader', 'accountant', 'project_manager', 'cfo', 'department_head')
  );
