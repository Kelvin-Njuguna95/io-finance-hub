-- ===========================================================================
-- 00057_pred02_predated_payouts_rls.sql
--
-- Hotfix for migration 00056 (Stage 1 of the predated-payouts feature).
-- The two new tables had RLS enabled-by-default in Supabase but no
-- policies attached, which silently blocked the Stage-4 read hook
-- (use-predated-payouts.ts) from returning any rows even though
-- admin-client INSERTs via the API routes succeeded. Symptom in
-- production: dialog records a payout, the row exists in SQL, but the
-- "Predated payouts" tab on /profit-share renders the empty state.
--
-- This migration:
--   1. Explicitly ENABLES RLS on both tables (idempotent — safe even
--      if already on).
--   2. Adds a SELECT policy for cfo + accountant on each table, using
--      the project's existing is_cfo() / is_accountant() helper
--      functions defined in 00003_rls_policies.sql:12,18 (matching
--      every other SELECT policy in the codebase rather than open-
--      coding the EXISTS lookup against the users table).
--   3. Does NOT add INSERT/UPDATE/DELETE policies. Writes go through
--      /api/predated-payouts and /api/predated-company-shares which
--      use the service-role admin client and bypass RLS. Adding write
--      policies would expand the attack surface unnecessarily.
--
-- Re-applying is safe: ALTER TABLE … ENABLE RLS is a no-op when
-- already on, and DROP POLICY IF EXISTS + CREATE POLICY handles the
-- policy idempotently.
--
-- Apply via Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.predated_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predated_company_share_distributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS predated_payouts_select_cfo_accountant
  ON public.predated_payouts;
DROP POLICY IF EXISTS predated_company_share_select_cfo_accountant
  ON public.predated_company_share_distributions;

CREATE POLICY predated_payouts_select_cfo_accountant
  ON public.predated_payouts
  FOR SELECT
  USING (is_cfo() OR is_accountant());

CREATE POLICY predated_company_share_select_cfo_accountant
  ON public.predated_company_share_distributions
  FOR SELECT
  USING (is_cfo() OR is_accountant());

COMMENT ON POLICY predated_payouts_select_cfo_accountant
  ON public.predated_payouts IS
  'Allows CFO + Accountant to read predated payout records via the anon client. Writes are admin-client-only via /api/predated-payouts.';
COMMENT ON POLICY predated_company_share_select_cfo_accountant
  ON public.predated_company_share_distributions IS
  'Allows CFO + Accountant to read predated company-share distributions via the anon client. Writes are admin-client-only via /api/predated-company-shares.';
