-- Allow Accountant to link withdrawals to director payouts
DROP POLICY IF EXISTS accountant_update_director_payouts
  ON director_payouts;

CREATE POLICY accountant_update_director_payouts
  ON director_payouts FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'accountant'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE id = auth.uid()
      AND role = 'accountant'
    )
  );
