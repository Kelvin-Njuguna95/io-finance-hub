-- =====================================================================
-- F-02: Codify expenses.lifecycle_status column in the migration tree
--
-- BACKGROUND
-- Application code references expenses.lifecycle_status across 8+ call
-- sites and AGENTS.md hard rule #2 depends on filtering by it. Production
-- has the column (post-00029 it is enum-typed, NOT NULL, default 'confirmed'),
-- but no migration on disk ever ADDed the column — 00029 only ALTERs its
-- type, assuming the column already exists. The column was added to
-- production directly outside the migration tree.
--
-- This is the F-02 finding from AUDIT_1_CORRECTNESS.md (Critical, schema
-- drift). Same family as BUG-002 (the missing UNIQUE on profit_share_records
-- that was declared inline in 00002 but never applied).
--
-- WHAT THIS MIGRATION DOES
-- 1. Idempotently ensures the expense_lifecycle_status enum exists.
--    Already created in 00029; this guard exists for environments where
--    00037 is the only migration applied (e.g. when codifying a future
--    fresh DB into the canonical state).
-- 2. ADD COLUMN IF NOT EXISTS for lifecycle_status with the canonical
--    post-00029 shape (enum, NOT NULL, default 'confirmed').
-- 3. Self-verification block that raises an explicit exception if the
--    column is missing or the NOT NULL constraint didn't land — so a
--    silent partial-apply doesn't go unnoticed.
--
-- IDEMPOTENCY / IMPACT ON PRODUCTION
-- ALL three blocks are idempotent. Against production (where the column
-- already exists post-00029) every step is a no-op:
--   - The enum guard short-circuits on the IF NOT EXISTS check.
--   - ADD COLUMN IF NOT EXISTS skips when the column is present.
--   - The verification asserts state that is already true.
-- No data is touched, no rows rewritten, no constraints recomputed.
--
-- RESIDUAL STRUCTURAL ISSUE — fresh-rebuild path is NOT fully closed
-- 00029 still assumes the column exists when it issues ALTER COLUMN
-- TYPE / SET NOT NULL. On a brand-new database applied in numerical
-- order, 00029 fails before 00037 ever runs. To close the fresh-rebuild
-- path entirely, 00029 needs to be edited in place to include an
-- `ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'confirmed'`
-- step immediately before its ALTER COLUMN block. That edit is OUT OF
-- SCOPE for this ticket per AGENTS.md ("Do not refactor 'while we're
-- here'"). This migration achieves the audit's primary goal (disk
-- matches production state, future audits won't re-flag the drift)
-- but does not unblock fresh rebuilds.
--
-- Practical impact: production unaffected (column already exists);
-- local dev / disaster-recovery rebuilds remain broken at 00029 until
-- a separate ticket addresses that historical migration.
--
-- OUT OF SCOPE
-- - Editing migration 00029 (separate ticket).
-- - F-10 (notifications schema drift — sibling finding).
-- - Any application code change (8+ existing consumers continue to work
--   correctly; this is documentation/codification only).
-- - Backfill of any column values (production rows are already populated;
--   the DEFAULT 'confirmed' covers the fresh-DB case).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ensure the expense_lifecycle_status enum exists
-- ---------------------------------------------------------------------
-- 4 values, not 6. PE-only states ('pending_auth', 'carried_forward')
-- are tracked on pending_expenses.status (text+CHECK in 00007), never on
-- expenses.lifecycle_status. Including them here would create dead enum
-- values. Matches the enum declared in 00029:82-91 byte-for-byte.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_lifecycle_status') THEN
    CREATE TYPE public.expense_lifecycle_status AS ENUM (
      'confirmed',
      'modified',
      'voided',
      'under_review'
    );
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 2. Codify the column existence
-- ---------------------------------------------------------------------
-- ADD COLUMN IF NOT EXISTS is a no-op against production (column is
-- already enum-typed post-00029) and adds the column fresh-defaulted
-- on any environment where it's absent. NOT NULL + DEFAULT means
-- existing rows get backfilled to 'confirmed' automatically when the
-- column is first added.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS lifecycle_status public.expense_lifecycle_status
    NOT NULL DEFAULT 'confirmed';


-- ---------------------------------------------------------------------
-- 3. Self-verification
-- ---------------------------------------------------------------------
-- Raises an explicit exception if the column ended up missing or
-- nullable after this migration. Surfaces silent partial-apply.

DO $$
DECLARE
  v_data_type TEXT;
  v_udt_name  TEXT;
  v_nullable  TEXT;
BEGIN
  SELECT data_type, udt_name, is_nullable
  INTO v_data_type, v_udt_name, v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'expenses'
    AND column_name = 'lifecycle_status';

  IF v_data_type IS NULL THEN
    RAISE EXCEPTION
      'F-02 verification failed: expenses.lifecycle_status column missing after migration.';
  END IF;

  IF v_nullable <> 'NO' THEN
    RAISE EXCEPTION
      'F-02 verification failed: expenses.lifecycle_status should be NOT NULL, got is_nullable=%.', v_nullable;
  END IF;

  -- udt_name is the underlying type name. For an enum-typed column,
  -- data_type is 'USER-DEFINED' and udt_name is the enum name.
  IF v_data_type <> 'USER-DEFINED' OR v_udt_name <> 'expense_lifecycle_status' THEN
    RAISE WARNING
      'F-02 verification: expenses.lifecycle_status type is data_type=%, udt_name=% — expected USER-DEFINED / expense_lifecycle_status. This is a WARNING (not ERROR) because pre-00029 environments may still have the column as text; running 00029 will promote it.',
      v_data_type, v_udt_name;
  END IF;
END $$;
