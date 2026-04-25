-- =====================================================================
-- F-05 Stage 1: Install corrected profit-share trigger functions.
--
-- BACKGROUND
-- Migrations 00017/00018 declared two trigger functions:
--   - update_profit_share_payout_totals      (00017:53-90, on withdrawals)
--   - sync_profit_share_from_director_payouts (00018:55-103, on director_payouts)
-- Both function bodies referenced profit_share_records.distributable_amount,
-- a column that does not exist in production. The actual column for a
-- director's per-month profit share is director_share_kes (the 70% slice).
--
-- Production introspection 2026-04-25 confirmed neither function exists in
-- the database — the migrations effectively no-op'd, so the advisory
-- columns total_paid_out / balance_remaining / payout_status / last_payout_date
-- on profit_share_records have never been maintained automatically.
--
-- Production introspection 2026-04-26 also revealed that 00017 partially
-- applied to withdrawals: withdrawal_type, director_name, and payout_type
-- were added, but profit_share_record_id (the FK column to
-- profit_share_records) was not. This migration adds that column and the
-- partial index 00017 declared, in addition to installing the corrected
-- trigger functions.
--
-- This migration:
--   0. Adds the missing profit_share_record_id column on withdrawals
--      and its partial index — both declared in 00017 but never applied.
--   1. Drops any leftover triggers/functions from 00017/00018 (defensive;
--      idempotent — safe whether or not they ever installed).
--   2. Creates fn_-prefixed versions with corrected column references
--      (distributable_amount → director_share_kes, 4 occurrences).
--   3. Recreates the triggers wired to the corrected functions.
--
-- DESIGN NOTES
-- - SECURITY DEFINER on both functions: the psr_manage RLS policy on
--   profit_share_records (00003:380) requires is_cfo() for UPDATE.
--   Without SECURITY DEFINER, an accountant inserting a withdrawal would
--   fire the trigger and trip RLS, failing the parent insert. SECURITY
--   DEFINER lets the trigger run with owner privileges and update the
--   row regardless of caller role.
-- - SET search_path = public, pg_temp: standard hardening for SECURITY
--   DEFINER functions. Prevents search_path injection where a malicious
--   schema entry could shadow public objects the function references.
-- - These functions are ADVISORY-COLUMN MAINTAINERS, not the source of
--   truth. Stage 4 will build a canonical balance view that retires
--   reliance on these columns. Until then, the two triggers will
--   "flap" if both ledgers (withdrawals + director_payouts) carry rows
--   for the same profit_share_record — the trigger that fires last
--   wins. There is also a third writer in
--   src/app/api/withdrawals/update/route.ts that performs its own
--   recompute of these columns from application code; that path is
--   tracked for cleanup in Stage 2/3. Today the flap is theoretical
--   (production has 0 director_payouts rows and 1 orphan withdrawal).
-- - Existing rows are NOT hydrated by this migration. Per the Stage 1
--   plan, Stage 2's profit-share recompute will overwrite the 2 hand-
--   seeded 2026-04 rows with computed values, hydrating the advisory
--   columns at the same time.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Schema repair — add missing FK column and partial index
-- ---------------------------------------------------------------------
-- Migration 00017 was supposed to add profit_share_record_id to
-- public.withdrawals, but production introspection 2026-04-26 confirmed
-- the column is absent. The trigger functions below reference
-- NEW.profit_share_record_id, so without this column the triggers would
-- error at runtime even after install. Idempotent ADD COLUMN IF NOT EXISTS
-- means re-running this migration after the column lands is safe.
--
-- ON DELETE NO ACTION matches 00017's intended default and prevents
-- accidental cascade — profit_share_records are audit data and should
-- not be deleted while withdrawals reference them.
--
-- Partial index excludes NULL rows (the existing orphan withdrawal has
-- NULL here) to keep the index small. Index supports the trigger's
-- reverse lookup: SUM(amount_kes) FROM withdrawals
-- WHERE profit_share_record_id = X AND withdrawal_type = 'director_payout'.

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS profit_share_record_id UUID
  REFERENCES public.profit_share_records(id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_withdrawals_profit_share
  ON public.withdrawals (profit_share_record_id)
  WHERE profit_share_record_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- 1. Defensive cleanup of any 00017/00018 leftovers
-- ---------------------------------------------------------------------
-- Triggers are dropped first because dropping a function while a
-- trigger still references it would error.

DROP TRIGGER IF EXISTS trg_withdrawal_payout_totals ON withdrawals;
DROP TRIGGER IF EXISTS trg_sync_ps_payout_totals ON director_payouts;

DROP FUNCTION IF EXISTS public.update_profit_share_payout_totals();
DROP FUNCTION IF EXISTS public.sync_profit_share_from_director_payouts();


-- ---------------------------------------------------------------------
-- 2a. fn_update_profit_share_payout_totals
-- ---------------------------------------------------------------------
-- Fires AFTER INSERT/UPDATE/DELETE on withdrawals. When the changed
-- withdrawal references a profit_share_record_id, recomputes
-- total_paid_out and last_payout_date from the withdrawals ledger
-- (filtered to withdrawal_type='director_payout'), then derives
-- balance_remaining and payout_status from director_share_kes.
--
-- Two sequential UPDATE statements: the second reads total_paid_out
-- written by the first, so the order matters.

CREATE OR REPLACE FUNCTION public.fn_update_profit_share_payout_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    balance_remaining = director_share_kes - total_paid_out,
    payout_status = CASE
      WHEN total_paid_out = 0 THEN 'unpaid'
      WHEN total_paid_out >= director_share_kes THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = target_record_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;


-- ---------------------------------------------------------------------
-- 2b. fn_sync_profit_share_from_director_payouts
-- ---------------------------------------------------------------------
-- Fires AFTER INSERT/UPDATE/DELETE on director_payouts. When the
-- changed payout references a profit_share_record_id, recomputes
-- total_paid_out, balance_remaining, payout_status, and
-- last_payout_date from the director_payouts ledger (filtered to
-- status='paid' — pending payouts don't count as paid out yet).
--
-- Single UPDATE; the four subqueries return identical sums but are
-- repeated for clarity matching 00018:55-103. The CASE expression's
-- subqueries are deterministic in one statement so this is correct,
-- if redundant.

CREATE OR REPLACE FUNCTION public.fn_sync_profit_share_from_director_payouts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    balance_remaining = director_share_kes - (
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
      ) >= director_share_kes THEN 'paid'
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
$$;


-- ---------------------------------------------------------------------
-- 3. Recreate triggers wired to the corrected functions
-- ---------------------------------------------------------------------

CREATE TRIGGER trg_withdrawal_payout_totals
  AFTER INSERT OR UPDATE OR DELETE ON withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_profit_share_payout_totals();

CREATE TRIGGER trg_sync_ps_payout_totals
  AFTER INSERT OR UPDATE OR DELETE ON director_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_profit_share_from_director_payouts();
