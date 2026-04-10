-- Add withdrawal type to distinguish operational vs payout
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS withdrawal_type TEXT
    NOT NULL DEFAULT 'operations'
    CHECK (withdrawal_type IN ('operations', 'director_payout'));

-- For director payout withdrawals:
-- Link to the profit share record being paid out
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS profit_share_record_id UUID
    REFERENCES profit_share_records(id) DEFAULT NULL;

-- Director receiving the payout
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS director_name TEXT DEFAULT NULL;
-- One of: 'Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'

-- Whether this is a full or partial payout
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS payout_type TEXT DEFAULT NULL
    CHECK (payout_type IN ('full', 'partial', NULL));

-- For partial payouts: running total paid to this director
-- for this profit share record
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS partial_payout_sequence INTEGER
    DEFAULT NULL;
-- 1 = first partial, 2 = second partial, etc.

-- Add index for profit share lookups
CREATE INDEX IF NOT EXISTS idx_withdrawals_profit_share
  ON withdrawals (profit_share_record_id)
  WHERE profit_share_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_type
  ON withdrawals (withdrawal_type);

ALTER TABLE profit_share_records
  ADD COLUMN IF NOT EXISTS total_paid_out NUMERIC(12,2)
    DEFAULT 0;

ALTER TABLE profit_share_records
  ADD COLUMN IF NOT EXISTS balance_remaining NUMERIC(12,2);

ALTER TABLE profit_share_records
  ADD COLUMN IF NOT EXISTS payout_status TEXT
    DEFAULT 'unpaid'
    CHECK (payout_status IN ('unpaid', 'partial', 'paid'));

ALTER TABLE profit_share_records
  ADD COLUMN IF NOT EXISTS last_payout_date DATE DEFAULT NULL;

CREATE OR REPLACE FUNCTION update_profit_share_payout_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_record_id UUID := COALESCE(NEW.profit_share_record_id, OLD.profit_share_record_id);
BEGIN
  IF target_record_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE profit_share_records
  SET
    total_paid_out = (
      SELECT COALESCE(SUM(amount_kes), 0)
      FROM withdrawals
      WHERE profit_share_record_id = target_record_id
        AND withdrawal_type = 'director_payout'
    ),
    last_payout_date = (
      SELECT MAX(withdrawal_date)
      FROM withdrawals
      WHERE profit_share_record_id = target_record_id
        AND withdrawal_type = 'director_payout'
    )
  WHERE id = target_record_id;

  UPDATE profit_share_records
  SET
    balance_remaining = distributable_amount - total_paid_out,
    payout_status = CASE
      WHEN total_paid_out = 0 THEN 'unpaid'
      WHEN total_paid_out >= distributable_amount THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = target_record_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_withdrawal_payout_totals ON withdrawals;
CREATE TRIGGER trg_withdrawal_payout_totals
  AFTER INSERT OR UPDATE OR DELETE ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION update_profit_share_payout_totals();
