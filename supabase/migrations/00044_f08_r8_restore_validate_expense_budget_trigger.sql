-- ===========================================================================
-- 00044_f08_r8_restore_validate_expense_budget_trigger.sql
--
-- F-08 / R-8: restore the validate_expense_budget trigger on public.expenses
-- with corrected logic that accommodates F-07 budget version history.
--
-- HISTORY
--   00004_functions.sql:94-111  defined fn_validate_expense_budget() and the
--                               BEFORE INSERT OR UPDATE trigger. The original
--                               body validated only that bv.status='approved'
--                               and bv.budget_id=NEW.budget_id. Acceptable
--                               under the pre-F-07 model where each budget
--                               had exactly one approved version at a time.
--
--   F-07 (00042_f07_budget_lifecycle_rpcs.sql) introduced version-history
--   semantics: budgets accumulate multiple historical 'approved' rows in
--   budget_versions as revisions occur. The original trigger would now
--   silently accept links to stale-but-once-approved versions, defeating
--   the integrity intent. Trigger was dropped (out-of-band) ahead of F-07.
--
--   00029_f06_expense_lifecycle_rpcs.sql:54  acknowledged the gap:
--       "F-08 validate_expense_budget trigger re-installation (R-8 deferred)"
--
-- THIS MIGRATION (R-8 closure)
--   * Reinstalls the trigger as INSERT-only. UPDATE is intentionally NOT
--     guarded: post-confirm UPDATEs (e.g., budgets/cfo-revert/route.ts:120
--     setting budget_approval_revoked, and 00042:818's RPC-level revoke)
--     legitimately touch expenses rows whose pinned budget_version_id is
--     historical evidence by design. Guarding UPDATE would block these
--     flows. The link is validated once at INSERT; afterward the row's
--     budget_version_id is immutable historical evidence (no code path
--     mutates it).
--   * New filter: bv.version_number = b.current_version. Rejects inserts
--     pointing at any historical approved version, not just non-approved
--     ones.
--   * NULL allowance is NOT included: expenses.budget_id and
--     expenses.budget_version_id are NOT NULL in 00002_tables.sql:206-207.
--     Schema invariant > defensive branch.
--   * Error pattern matches 00029/00042/00043 RPC convention: ERRCODE='P0001'
--     with structured HINT for route-level translation.
--
-- VERIFICATION
--   Self-verify DO block at end confirms trigger present and INSERT-only.
-- ===========================================================================

-- Idempotent drop in case of manual re-install drift
DROP TRIGGER IF EXISTS validate_expense_budget ON public.expenses;

CREATE OR REPLACE FUNCTION public.fn_validate_expense_budget()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempted_version int;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.budget_versions bv
    JOIN public.budgets b ON b.id = bv.budget_id
    WHERE bv.id = NEW.budget_version_id
      AND bv.budget_id = NEW.budget_id
      AND bv.status = 'approved'::budget_status
      AND bv.version_number = b.current_version
  ) THEN
    SELECT bv2.version_number
      INTO v_attempted_version
    FROM public.budget_versions bv2
    WHERE bv2.id = NEW.budget_version_id;

    RAISE EXCEPTION
      'Expenses can only be linked to the current approved budget version (got version % of budget %, status check failed)',
      COALESCE(v_attempted_version::text, 'unknown'),
      NEW.budget_id
      USING ERRCODE = 'P0001',
            HINT    = 'Verify budget_id and budget_version_id match the budget''s current approved version. Budget revisions create new versions; expenses must link to b.current_version.';
  END IF;

  RETURN NEW;
END;
$$;

-- INSERT only per F-07 reality (UPDATEs of post-confirm flag/state fields
-- must remain unblocked even when the row's pinned budget_version_id is
-- no longer current).
CREATE TRIGGER validate_expense_budget
  BEFORE INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_expense_budget();

-- ---------------------------------------------------------------------------
-- Self-verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_trigger_count int;
  v_has_update    boolean;
BEGIN
  SELECT COUNT(*)
    INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class      c ON c.oid = t.tgrelid
  JOIN pg_namespace  n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'expenses'
    AND t.tgname  = 'validate_expense_budget'
    AND NOT t.tgisinternal;

  IF v_trigger_count = 0 THEN
    RAISE EXCEPTION 'F-08 R-8 self-verify failed: validate_expense_budget trigger not present on public.expenses';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table  = 'expenses'
      AND trigger_name        = 'validate_expense_budget'
      AND event_manipulation  = 'UPDATE'
  ) INTO v_has_update;

  IF v_has_update THEN
    RAISE EXCEPTION 'F-08 R-8 self-verify failed: validate_expense_budget fires on UPDATE; expected INSERT only';
  END IF;

  RAISE NOTICE 'F-08 R-8 self-verify passed: validate_expense_budget INSERT-only trigger installed on public.expenses';
END $$;
