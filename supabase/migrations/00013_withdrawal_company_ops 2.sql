-- ============================================================
-- Migration 00013: Support Company Operations withdrawals
--
-- Context:
--   Withdrawals currently only support director payouts.
--   This migration adds support for "company_operations"
--   withdrawals that are tied to approved budgets rather
--   than individual directors.
--
-- Changes:
--   1. Add purpose column (default 'director_payout' for existing rows)
--   2. Make director_tag and director_user_id nullable
--   3. Add project_id and budget_id columns for company ops
-- ============================================================

-- 1. Add purpose column
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'director_payout';

-- 2. Make director columns nullable (they are NOT NULL today)
ALTER TABLE withdrawals ALTER COLUMN director_tag DROP NOT NULL;
ALTER TABLE withdrawals ALTER COLUMN director_user_id DROP NOT NULL;

-- 3. Add project/budget reference for company operations
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES budgets(id);

-- 4. Add constraint: director fields required for director_payout,
--    project_id required for company_operations
ALTER TABLE withdrawals ADD CONSTRAINT withdrawal_purpose_check CHECK (
  (purpose = 'director_payout' AND director_tag IS NOT NULL AND director_user_id IS NOT NULL) OR
  (purpose = 'company_operations' AND project_id IS NOT NULL)
);

-- 5. Index for querying by purpose and project
CREATE INDEX IF NOT EXISTS idx_withdrawals_purpose ON withdrawals(purpose);
CREATE INDEX IF NOT EXISTS idx_withdrawals_project ON withdrawals(project_id) WHERE project_id IS NOT NULL;
