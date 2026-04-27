-- =====================================================================
-- F-05 BUG-003: Route revenue queries through lagged views
--
-- BACKGROUND
-- fn_calculate_project_profitability and fn_generate_monthly_snapshot both
-- read from invoices.billing_period directly. AGENTS.md hard rule #1
-- requires revenue queries to use lagged_revenue_by_project_month (per
-- project) or lagged_revenue_company_month (company-wide). The direct
-- reads return current-month invoices instead of the lagged previous
-- month, producing materially wrong values throughout the close pipeline.
--
-- For April 2026 Windward this produced distributable_profit_kes =
-- -2,407,146.51 (RPC stored, using April invoices ≈ 0 KES) instead of
-- the truth value +1,705,902.99 (using March invoices lagged to April,
-- 4,113,049.50 KES, minus 2,140,188.94 direct expenses minus 266,957.57
-- allocated overhead).
--
-- FIX
-- Both functions are rewritten to source revenue from the corresponding
-- lagged view. The sole behavior change is the revenue read; everything
-- else (expense queries, overhead reads, sign math, INSERT/UPSERT, NUMERIC
-- precision) is byte-identical to migration 00025.
--
-- DEFENSIVE PRE-ASSIGNMENT
-- The lagged views are LEFT JOINs that may return no row for a project-
-- month combination with neither revenue nor expenses recorded. Without
-- pre-assignment, SELECT INTO leaves the v_revenue_* variables NULL,
-- which would propagate through arithmetic and likely violate NOT NULL
-- constraints downstream. Pre-assigning to 0 makes the SELECT a "best-
-- effort overlay."
--
-- VIEW COLUMNS USED
--   lagged_revenue_by_project_month (00029:146-179)
--     - lagged_revenue_usd  (sum of invoices.amount_usd lagged 1 month)
--     - lagged_revenue_kes  (sum of invoices.amount_kes lagged 1 month)
--   lagged_revenue_company_month   (00029:213-226)
--     - total_revenue_usd   (sum across all projects)
--     - total_revenue_kes   (sum across all projects)
--
-- OUT OF SCOPE
-- - fn_calculate_overhead_allocations has the same family bug at line 175,
--   but only in the revenue_based/hybrid weighting branch which is
--   unreachable under the headcount_based default. Filed as follow-up.
-- - BUG-004 (fn_close_month failing with generic toast error) is being
--   tested independently after this migration ships; if it persists,
--   diagnose fresh.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. fn_calculate_project_profitability — route revenue through lagged
-- ---------------------------------------------------------------------
-- Body byte-identical to migration 00025:57-138 except the revenue SELECT
-- block (lines 75-79 there) is replaced with a lagged-view read with
-- defensive pre-assignment to 0.

CREATE OR REPLACE FUNCTION public.fn_calculate_project_profitability(p_project_id uuid, p_year_month text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_revenue_usd NUMERIC(16,4);
  v_revenue_kes NUMERIC(16,2);
  v_direct_usd NUMERIC(16,4);
  v_direct_kes NUMERIC(16,2);
  v_overhead_usd NUMERIC(16,4);
  v_overhead_kes NUMERIC(16,2);
  v_gross_usd NUMERIC(16,4);
  v_gross_kes NUMERIC(16,2);
  v_distributable_usd NUMERIC(16,4);
  v_distributable_kes NUMERIC(16,2);
  v_margin NUMERIC(8,4);
BEGIN
  -- Revenue from invoices, lagged by 1 month per AGENTS.md rule #1.
  -- For p_year_month='2026-04', the view returns invoices billed in 2026-03.
  -- Pre-assignment guards against the LEFT-JOIN view returning no row for
  -- project-months with neither revenue nor expenses recorded.
  v_revenue_usd := 0;
  v_revenue_kes := 0;
  SELECT lagged_revenue_usd, lagged_revenue_kes
  INTO v_revenue_usd, v_revenue_kes
  FROM lagged_revenue_by_project_month
  WHERE project_id = p_project_id AND expense_month = p_year_month;

  -- Direct project expenses
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_direct_usd, v_direct_kes
  FROM expenses
  WHERE project_id = p_project_id
    AND year_month = p_year_month
    AND expense_type = 'project_expense'
    AND lifecycle_status = 'confirmed';

  -- Allocated overhead
  SELECT COALESCE(allocated_amount_usd, 0), COALESCE(allocated_amount_kes, 0)
  INTO v_overhead_usd, v_overhead_kes
  FROM overhead_allocations
  WHERE project_id = p_project_id AND year_month = p_year_month;

  v_gross_usd := v_revenue_usd - v_direct_usd;
  v_gross_kes := v_revenue_kes - v_direct_kes;
  v_distributable_usd := v_gross_usd - v_overhead_usd;
  v_distributable_kes := v_gross_kes - v_overhead_kes;

  IF v_revenue_usd > 0 THEN
    v_margin := (v_distributable_usd / v_revenue_usd) * 100;
  ELSE
    v_margin := 0;
  END IF;

  INSERT INTO project_profitability (
    project_id, year_month,
    revenue_usd, revenue_kes,
    direct_expenses_usd, direct_expenses_kes,
    allocated_overhead_usd, allocated_overhead_kes,
    gross_profit_usd, gross_profit_kes,
    distributable_profit_usd, distributable_profit_kes,
    margin_pct
  )
  VALUES (
    p_project_id, p_year_month,
    v_revenue_usd, v_revenue_kes,
    v_direct_usd, v_direct_kes,
    v_overhead_usd, v_overhead_kes,
    v_gross_usd, v_gross_kes,
    v_distributable_usd, v_distributable_kes,
    v_margin
  )
  ON CONFLICT (project_id, year_month) DO UPDATE SET
    revenue_usd = EXCLUDED.revenue_usd,
    revenue_kes = EXCLUDED.revenue_kes,
    direct_expenses_usd = EXCLUDED.direct_expenses_usd,
    direct_expenses_kes = EXCLUDED.direct_expenses_kes,
    allocated_overhead_usd = EXCLUDED.allocated_overhead_usd,
    allocated_overhead_kes = EXCLUDED.allocated_overhead_kes,
    gross_profit_usd = EXCLUDED.gross_profit_usd,
    gross_profit_kes = EXCLUDED.gross_profit_kes,
    distributable_profit_usd = EXCLUDED.distributable_profit_usd,
    distributable_profit_kes = EXCLUDED.distributable_profit_kes,
    margin_pct = EXCLUDED.margin_pct;
END;
$function$;


-- ---------------------------------------------------------------------
-- 2. fn_generate_monthly_snapshot — route revenue through company lagged
-- ---------------------------------------------------------------------
-- Body byte-identical to migration 00025:242-318 except the revenue SELECT
-- block (lines 257-259 there) is replaced with a company-lagged-view read
-- with defensive pre-assignment to 0.

CREATE OR REPLACE FUNCTION public.fn_generate_monthly_snapshot(p_year_month text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_rev_usd NUMERIC(16,4);
  v_rev_kes NUMERIC(16,2);
  v_direct_usd NUMERIC(16,4);
  v_direct_kes NUMERIC(16,2);
  v_overhead_usd NUMERIC(16,4);
  v_overhead_kes NUMERIC(16,2);
  v_forex_gl NUMERIC(16,2);
  v_agents INTEGER;
BEGIN
  -- Revenue from invoices, lagged by 1 month per AGENTS.md rule #1.
  -- Company-wide aggregate via lagged_revenue_company_month view.
  -- Pre-assignment guards against the view returning no row for months
  -- with neither revenue nor expenses recorded.
  v_rev_usd := 0;
  v_rev_kes := 0;
  SELECT total_revenue_usd, total_revenue_kes
  INTO v_rev_usd, v_rev_kes
  FROM lagged_revenue_company_month
  WHERE expense_month = p_year_month;

  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_direct_usd, v_direct_kes
  FROM expenses WHERE year_month = p_year_month AND expense_type = 'project_expense'
    AND lifecycle_status = 'confirmed';

  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_overhead_usd, v_overhead_kes
  FROM expenses WHERE year_month = p_year_month AND expense_type = 'shared_expense'
    AND lifecycle_status = 'confirmed';

  SELECT COALESCE(SUM(variance_kes), 0)
  INTO v_forex_gl
  FROM withdrawals WHERE year_month = p_year_month;

  SELECT COALESCE(SUM(agent_count), 0)
  INTO v_agents
  FROM agent_counts WHERE year_month = p_year_month;

  INSERT INTO monthly_financial_snapshots (
    year_month,
    total_revenue_usd, total_revenue_kes,
    total_direct_costs_usd, total_direct_costs_kes,
    gross_profit_usd, gross_profit_kes,
    total_shared_overhead_usd, total_shared_overhead_kes,
    operating_profit_usd, operating_profit_kes,
    forex_gain_loss_kes,
    net_profit_usd, net_profit_kes,
    total_agents
  )
  VALUES (
    p_year_month,
    v_rev_usd, v_rev_kes,
    v_direct_usd, v_direct_kes,
    v_rev_usd - v_direct_usd, v_rev_kes - v_direct_kes,
    v_overhead_usd, v_overhead_kes,
    v_rev_usd - v_direct_usd - v_overhead_usd, v_rev_kes - v_direct_kes - v_overhead_kes,
    v_forex_gl,
    v_rev_usd - v_direct_usd - v_overhead_usd,
    v_rev_kes - v_direct_kes - v_overhead_kes + v_forex_gl,
    v_agents
  )
  ON CONFLICT (year_month) DO UPDATE SET
    total_revenue_usd = EXCLUDED.total_revenue_usd,
    total_revenue_kes = EXCLUDED.total_revenue_kes,
    total_direct_costs_usd = EXCLUDED.total_direct_costs_usd,
    total_direct_costs_kes = EXCLUDED.total_direct_costs_kes,
    gross_profit_usd = EXCLUDED.gross_profit_usd,
    gross_profit_kes = EXCLUDED.gross_profit_kes,
    total_shared_overhead_usd = EXCLUDED.total_shared_overhead_usd,
    total_shared_overhead_kes = EXCLUDED.total_shared_overhead_kes,
    operating_profit_usd = EXCLUDED.operating_profit_usd,
    operating_profit_kes = EXCLUDED.operating_profit_kes,
    forex_gain_loss_kes = EXCLUDED.forex_gain_loss_kes,
    net_profit_usd = EXCLUDED.net_profit_usd,
    net_profit_kes = EXCLUDED.net_profit_kes,
    total_agents = EXCLUDED.total_agents;
END;
$function$;
