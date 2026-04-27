-- =====================================================================
-- F-18: Extend red_flag_type enum with 'report_delivery_failed'
--
-- BACKGROUND
-- src/app/api/eod/route.ts:303-310 inserts a red_flag when EOD Slack
-- delivery fails. Until now it reused 'missing_expense_classification' as
-- the flag_type to satisfy the NOT NULL enum constraint, even though that
-- value semantically describes an unclassified expense — a different
-- problem entirely. Result: EOD delivery failures surface in the red-flags
-- dashboard and the misc page miscategorised under "missing expense
-- classification", diluting both buckets.
--
-- The original red_flag_type enum (00001_enums.sql:78-90) covers financial/
-- operational data issues only; no value names a system/integration
-- delivery failure. This migration adds one.
--
-- This is the F-18 finding from AUDIT_1_CORRECTNESS.md (Medium).
--
-- WHAT THIS MIGRATION DOES
-- 1. ADD VALUE IF NOT EXISTS for 'report_delivery_failed' on the
--    red_flag_type enum. Idempotent — safe to re-apply.
-- 2. Self-verification block that raises if the value didn't land.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- - Does not remove 'missing_expense_classification'. After F-18 it
--   becomes a dead enum value (no consumer in any migration or code path
--   per the F-18 sweep), but Postgres enum-value removal is non-trivial
--   and not in scope for this finding.
-- - Does not alter any existing red_flag rows. The EOD route's misuse
--   pattern was insert-only; in-place rewrites of historical data are
--   out of scope and would erase the audit trail of the bug.
--
-- DEPLOY ORDER
-- This migration MUST be applied before the matching code change in
-- src/app/api/eod/route.ts ships, otherwise the EOD route hits an enum
-- constraint violation on the next Slack delivery failure. Apply via
-- Supabase Dashboard SQL Editor, verify, then deploy the code.
-- =====================================================================

ALTER TYPE red_flag_type ADD VALUE IF NOT EXISTS 'report_delivery_failed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'red_flag_type'
      AND e.enumlabel = 'report_delivery_failed'
  ) THEN
    RAISE EXCEPTION 'F-18: red_flag_type enum did not gain value ''report_delivery_failed''. Migration partial-apply.';
  END IF;
END $$;
