-- Migration: Add company operations support to withdrawals
-- Applied to production: 2026-04-11

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'director_payout';
ALTER TABLE withdrawals ALTER COLUMN director_tag DROP NOT NULL;
ALTER TABLE withdrawals ALTER COLUMN director_user_id DROP NOT NULL;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS budget_id UUID REFERENCES budgets(id);

-- Ensure data integrity based on purpose
ALTER TABLE withdrawals ADD CONSTRAINT withdrawal_purpose_check CHECK (
  (purpose = 'director_payout' AND director_tag IS NOT NULL AND director_user_id IS NOT NULL) OR
  (purpose = 'company_operations' AND project_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_purpose ON withdrawals(purpose);
CREATE INDEX IF NOT EXISTS idx_withdrawals_project ON withdrawals(project_id) WHERE project_id IS NOT NULL;

