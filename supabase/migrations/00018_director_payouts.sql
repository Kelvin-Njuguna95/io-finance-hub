-- Director payouts ledger for tracking initiation and settlement of payouts
CREATE TABLE IF NOT EXISTS director_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  director_name TEXT NOT NULL,
  profit_share_record_id UUID NOT NULL REFERENCES profit_share_records(id) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  amount_kes NUMERIC(12,2) NOT NULL CHECK (amount_kes > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'withdrawal')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  withdrawal_id UUID NULL REFERENCES withdrawals(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ NULL,
  paid_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NULL,
  initiated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_director_payouts_psr ON director_payouts(profit_share_record_id);
CREATE INDEX IF NOT EXISTS idx_director_payouts_director_period ON director_payouts(director_name, period_month);
CREATE INDEX IF NOT EXISTS idx_director_payouts_status ON director_payouts(status);

CREATE OR REPLACE FUNCTION set_director_payout_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_director_payouts_updated_at ON director_payouts;
CREATE TRIGGER trg_director_payouts_updated_at
  BEFORE UPDATE ON director_payouts
  FOR EACH ROW
  EXECUTE FUNCTION set_director_payout_updated_at();

CREATE OR REPLACE FUNCTION auto_mark_director_payout_paid()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.withdrawal_id IS NOT NULL AND NEW.status <> 'paid' THEN
    NEW.status := 'paid';
    NEW.paid_at := COALESCE(NEW.paid_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payout_auto_paid ON director_payouts;
CREATE TRIGGER trg_payout_auto_paid
  BEFORE INSERT OR UPDATE ON director_payouts
  FOR EACH ROW
  EXECUTE FUNCTION auto_mark_director_payout_paid();

CREATE OR REPLACE FUNCTION sync_profit_share_from_director_payouts()
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
      FROM director_payouts
      WHERE profit_share_record_id = target_record_id
        AND status = 'paid'
    ),
    balance_remaining = distributable_amount - (
      SELECT COALESCE(SUM(amount_kes), 0)
      FROM director_payouts
      WHERE profit_share_record_id = target_record_id
        AND status = 'paid'
    ),
    payout_status = CASE
      WHEN (
        SELECT COALESCE(SUM(amount_kes), 0)
        FROM director_payouts
        WHERE profit_share_record_id = target_record_id
          AND status = 'paid'
      ) = 0 THEN 'unpaid'
      WHEN (
        SELECT COALESCE(SUM(amount_kes), 0)
        FROM director_payouts
        WHERE profit_share_record_id = target_record_id
          AND status = 'paid'
      ) >= distributable_amount THEN 'paid'
      ELSE 'partial'
    END,
    last_payout_date = (
      SELECT MAX(COALESCE(paid_at::date, created_at::date))
      FROM director_payouts
      WHERE profit_share_record_id = target_record_id
        AND status = 'paid'
    )
  WHERE id = target_record_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_ps_payout_totals ON director_payouts;
CREATE TRIGGER trg_sync_ps_payout_totals
  AFTER INSERT OR UPDATE OR DELETE ON director_payouts
  FOR EACH ROW
  EXECUTE FUNCTION sync_profit_share_from_director_payouts();

ALTER TABLE director_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cfo_read_director_payouts ON director_payouts;
CREATE POLICY cfo_read_director_payouts
  ON director_payouts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role IN ('cfo', 'accountant', 'project_manager')
    )
  );

DROP POLICY IF EXISTS cfo_insert_director_payouts ON director_payouts;
CREATE POLICY cfo_insert_director_payouts
  ON director_payouts FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'cfo'
    )
  );

DROP POLICY IF EXISTS cfo_update_director_payouts ON director_payouts;
CREATE POLICY cfo_update_director_payouts
  ON director_payouts FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'cfo'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'cfo'
    )
  );
