-- Add withdrawal_type column to withdrawals table
ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS withdrawal_type text;

-- Add a comment for documentation
COMMENT ON COLUMN withdrawals.withdrawal_type IS 'Type of withdrawal: operations or director_payout';

-- Backfill existing records:
-- All current records are operations withdrawals (director payouts didn't exist yet)
-- They incorrectly have purpose = 'director_payout' from the old form
UPDATE withdrawals
SET
  withdrawal_type = 'operations',
  purpose = 'company_operations'
WHERE withdrawal_type IS NULL;
