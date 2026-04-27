-- =====================================================================
-- F-07 (preparatory): Codify the four budget_status enum values used
-- by application code but absent from the migration tree
--
-- BACKGROUND
-- The original budget_status enum (00001_enums.sql:23-29) declared 5
-- values: 'draft', 'submitted', 'under_review', 'approved', 'rejected'.
-- Application code (src/types/database.ts:7 plus every budget-route
-- file) writes four additional values that no migration ever declared:
--
--   - 'pm_review'        — TL/Accountant submission moves here for PM review
--   - 'pm_approved'      — PM has signed off; budget is queued for CFO approval
--   - 'pm_rejected'      — PM has rejected; TL must create a new budget
--   - 'returned_to_tl'   — PM is sending the budget back for changes
--
-- Same drift family as F-02 (expenses.lifecycle_status), F-05 (profit-
-- share trigger columns), F-10 (notifications body/type), F-33 (red_flag_
-- type). Either production was patched directly via ALTER TYPE ADD VALUE
-- outside the migrations tree, or the four writes have been failing for
-- as long as the routes have existed. Pre-flight pg_enum query
-- (Phase 2 plan, F-07 §step 1) determines which scenario holds; either
-- way this migration codifies the values and is idempotent.
--
-- This is preparatory for the F-07 RPC migration (00042). The RPCs
-- transition rows through these statuses; if the enum doesn't admit
-- them, the RPCs raise constraint violations on apply.
--
-- WHAT THIS MIGRATION DOES
-- 1. ADD VALUE IF NOT EXISTS for each of the four values. Idempotent;
--    safe to re-apply. Postgres requires ALTER TYPE ADD VALUE to run
--    outside a transaction block — Supabase's Dashboard SQL Editor
--    runs each statement in autocommit so a clean paste-and-run works.
-- 2. Self-verification block that raises if any of the four didn't
--    land. Catches partial-apply.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- - Does not remove the original 5 values (all are still in active use
--   somewhere in the codebase or DB functions).
-- - Does not enforce any state-machine rules on transitions; that lives
--   in the RPCs (00042). Codifying the enum just admits the values.
--
-- DEPLOY ORDER
-- This migration MUST be applied before 00042 (F-07 RPCs). The RPCs'
-- INSERTs into budget_versions specify these enum values; if the
-- values are not yet declared, the function bodies fail to compile.
-- Apply 00041 first, verify, then apply 00042.
-- =====================================================================

ALTER TYPE budget_status ADD VALUE IF NOT EXISTS 'pm_review';
ALTER TYPE budget_status ADD VALUE IF NOT EXISTS 'pm_approved';
ALTER TYPE budget_status ADD VALUE IF NOT EXISTS 'pm_rejected';
ALTER TYPE budget_status ADD VALUE IF NOT EXISTS 'returned_to_tl';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'budget_status' AND e.enumlabel = 'pm_review'
  ) THEN
    RAISE EXCEPTION 'F-07: budget_status enum did not gain value ''pm_review''. Migration partial-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'budget_status' AND e.enumlabel = 'pm_approved'
  ) THEN
    RAISE EXCEPTION 'F-07: budget_status enum did not gain value ''pm_approved''. Migration partial-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'budget_status' AND e.enumlabel = 'pm_rejected'
  ) THEN
    RAISE EXCEPTION 'F-07: budget_status enum did not gain value ''pm_rejected''. Migration partial-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'budget_status' AND e.enumlabel = 'returned_to_tl'
  ) THEN
    RAISE EXCEPTION 'F-07: budget_status enum did not gain value ''returned_to_tl''. Migration partial-apply.';
  END IF;
END $$;
