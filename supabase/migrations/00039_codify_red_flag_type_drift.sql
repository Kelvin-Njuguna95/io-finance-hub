-- =====================================================================
-- F-33: Codify two red_flag_type enum values used in app code but
-- absent from the migration tree
--
-- BACKGROUND
-- The original red_flag_type enum (00001_enums.sql:78-90) declared 11
-- values; migration 00038 added 'report_delivery_failed' as part of
-- F-18. Two further values are inserted by application code but were
-- never declared in any migration:
--
--   - 'expense_variance_overspend' — src/app/api/expense-lifecycle/
--     route.ts:780, 874 (variance generator overspend alert,
--     fired post-confirm when an expense category exceeds the
--     configured overspend threshold)
--   - 'misc_topup_limit_reached'   — src/app/api/misc-draws/route.ts:371
--     (monthly top-up cap alert)
--
-- Same drift family as F-02 (expenses.lifecycle_status), F-05 (profit_
-- share trigger columns), F-18 (report_delivery_failed).
--
-- PRODUCTION SCENARIO CONFIRMED (2026-04-27, Phase 1 verification)
-- The Phase 1 diagnostic surfaced two possible scenarios:
--   (a) production enum patched directly outside migrations, or
--   (b) inserts have been silently failing in production.
-- A pg_enum query against live production returned exactly the 12
-- declared values; both drift values are absent. Scenario (b) holds.
--
-- The two callsites both use bare `await admin.from('red_flags').
-- insert({...})` with no `.error` check, so the 22P02 enum violations
-- have been swallowed end-to-end. This means:
--   - Every expense-variance overspend alert that should have fired
--     since the variance generator landed has produced ZERO red flag
--     rows in production.
--   - Every misc top-up limit-reached alert has produced ZERO rows.
-- Two categories of operational alerts have effectively been disabled
-- since the routes were written. This migration restores them by
-- making the enum values valid; future fires from these callsites
-- will land. Past events are not recoverable — the source data
-- (variance/top-up trigger conditions at the moment of the failed
-- insert) was not preserved anywhere outside the swallowed insert.
--
-- This is the F-33 finding from AUDIT_1_CORRECTNESS.md (Medium).
--
-- WHAT THIS MIGRATION DOES
-- 1. ADD VALUE IF NOT EXISTS for both values. Idempotent; safe to
--    re-apply.
-- 2. Self-verification block that raises if either didn't land.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- - Does not add `.error` checks to the two insert callsites. The
--   inserts will start succeeding once this migration applies, but
--   the call sites still won't surface any future failures. Sibling
--   of F-25 (closed via commit 83db636 for notification inserts);
--   tracked separately.
-- - Does not backfill missing historical red_flag rows. The condition
--   data (which variance threshold was breached on which date, which
--   misc draw hit its cap on which date) was not captured anywhere
--   else and cannot be reconstructed.
-- - Does not remove dead `'missing_expense_classification'` (post-F-18
--   no consumer remains). Postgres enum value removal is non-trivial
--   and out of scope.
-- =====================================================================

ALTER TYPE red_flag_type ADD VALUE IF NOT EXISTS 'expense_variance_overspend';
ALTER TYPE red_flag_type ADD VALUE IF NOT EXISTS 'misc_topup_limit_reached';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'red_flag_type' AND e.enumlabel = 'expense_variance_overspend'
  ) THEN
    RAISE EXCEPTION 'F-33: red_flag_type enum did not gain value ''expense_variance_overspend''. Migration partial-apply.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'red_flag_type' AND e.enumlabel = 'misc_topup_limit_reached'
  ) THEN
    RAISE EXCEPTION 'F-33: red_flag_type enum did not gain value ''misc_topup_limit_reached''. Migration partial-apply.';
  END IF;
END $$;
