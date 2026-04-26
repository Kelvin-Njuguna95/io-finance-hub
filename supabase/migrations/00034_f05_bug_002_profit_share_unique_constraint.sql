-- =====================================================================
-- F-05 BUG-002: Restore missing UNIQUE constraint on profit_share_records
--
-- BACKGROUND
-- profit_share_records was declared with UNIQUE(project_id, year_month)
-- inline in migration 00002_tables.sql:383, but production was confirmed
-- (2026-04-26) to be missing this constraint. Schema drift origin unknown.
--
-- The missing constraint blocks fn_generate_profit_shares' INSERT … ON
-- CONFLICT (project_id, year_month) clause, which fails at executor plan
-- time with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" — regardless of whether any conflicting rows actually
-- exist. This breaks BOTH fn_close_month and fn_recompute_profit_share,
-- meaning no month-close has successfully generated profit_share_records
-- via the engine since the drift was introduced.
--
-- PRE-MIGRATION STATE (verified 2026-04-26):
-- - profit_share_records contains exactly 2 rows, both for 2026-04
--   Windward, both placeholder seeds (NULL director_user_id, identical
--   distributable values).
-- - No other months have any profit_share_records.
-- - No director_payouts or withdrawals reference these rows.
-- - Monthly counts query returned only 2026-04 with row_count=2,
--   closure_status=NULL.
--
-- CLEANUP DECISION
-- Both 2026-04 rows are placeholder data with no real downstream
-- references. Delete them. The recompute UI will rebuild them with
-- calculated values once the constraint is in place.
--
-- DEFENSE: ALTER TABLE … ADD CONSTRAINT … UNIQUE will fail loudly if any
-- duplicate (project_id, year_month) pair remains. Postgres self-protects
-- against partial cleanup.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Wipe placeholder rows
-- ---------------------------------------------------------------------

DELETE FROM profit_share_records WHERE year_month = '2026-04';


-- ---------------------------------------------------------------------
-- 2. Add the missing UNIQUE constraint
-- ---------------------------------------------------------------------
-- Constraint name follows Postgres's auto-generated naming convention
-- (table_columns_key) so it matches what 00002 would have produced if
-- the inline UNIQUE(project_id, year_month) had been applied.

ALTER TABLE profit_share_records
  ADD CONSTRAINT profit_share_records_project_id_year_month_key
  UNIQUE (project_id, year_month);


-- ---------------------------------------------------------------------
-- 3. Verification (pure SELECT — no side effects)
-- ---------------------------------------------------------------------
-- Confirms the constraint landed. If the EXISTS check returns FALSE,
-- raises an explicit error so the operator notices in the SQL Editor
-- output.

DO $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profit_share_records'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%project_id%year_month%'
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Constraint profit_share_records_project_id_year_month_key not found after migration. Check pg_constraint manually.';
  END IF;
END $$;
