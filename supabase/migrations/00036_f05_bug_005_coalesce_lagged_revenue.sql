-- =====================================================================
-- F-05 BUG-005: NULL-safe revenue read from lagged views
--
-- BACKGROUND
-- Migration 00035 (BUG-003) routed revenue through lagged_revenue_by_project_month
-- and lagged_revenue_company_month. To handle the "view returns no row" case,
-- 00035 used the pattern:
--
--   v_revenue_usd := 0;
--   v_revenue_kes := 0;
--   SELECT lagged_revenue_usd, lagged_revenue_kes
--   INTO v_revenue_usd, v_revenue_kes
--   FROM lagged_revenue_by_project_month
--   WHERE project_id = p_project_id AND expense_month = p_year_month;
--
-- This pattern is broken. PL/pgSQL's SELECT INTO with no matching row leaves
-- the target variables UNCHANGED — but the lagged view is a LEFT JOIN that
-- can return a row whose lagged_revenue_usd / lagged_revenue_kes columns are
-- themselves NULL (project-month with no invoices, only expenses, or vice
-- versa). When the SELECT returns a row with NULL values, INTO faithfully
-- assigns those NULLs and overwrites the pre-assigned 0s.
--
-- The downstream INSERT into project_profitability then violates the NOT NULL
-- constraint on revenue_usd, raising:
--   ERROR: 23502: null value in column "revenue_usd" of relation
--   "project_profitability" violates not-null constraint
--
-- Confirmed in production by direct call to
-- fn_recompute_profit_share('2026-04', '<cfo-uuid>') failing on Signafide's
-- project-month row (no invoices, no expenses for April).
--
-- FIX
-- Replace the pre-assignment + SELECT INTO pattern with a single SELECT INTO
-- whose target expressions are scalar subqueries wrapped in COALESCE. This
-- makes the read NULL-safe whether the view returns no row OR returns a row
-- with NULL columns:
--
--   SELECT
--     COALESCE((SELECT lagged_revenue_usd FROM lagged_revenue_by_project_month
--               WHERE project_id = p_project_id AND expense_month = p_year_month), 0),
--     COALESCE((SELECT lagged_revenue_kes FROM lagged_revenue_by_project_month
--               WHERE project_id = p_project_id AND expense_month = p_year_month), 0)
--   INTO v_revenue_usd, v_revenue_kes;
--
-- The scalar subqueries return at most one row each (the view keyset is
-- (project_id, expense_month) for lagged_revenue_by_project_month and
-- (expense_month, revenue_source_month) for lagged_revenue_company_month —
-- both produce exactly one row per filter, or zero). COALESCE handles the
-- zero-row case (subquery returns NULL) and the one-row-with-NULL-columns
-- case (subquery returns NULL) identically.
--
-- Sole behavior change vs 00035 is the revenue read; all other reads,
-- arithmetic, INSERT/UPSERT, NUMERIC precision, and column lists are
-- byte-identical to 00035.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. fn_calculate_project_profitability — NULL-safe lagged revenue read
-- ---------------------------------------------------------------------

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
  -- Scalar-subquery + COALESCE pattern is NULL-safe both when the view
  -- returns no row AND when it returns a row with NULL columns (e.g. a
  -- project-month with expenses but no invoices).
  SELECT
    COALESCE((SELECT lagged_revenue_usd FROM lagged_revenue_by_project_month
              WHERE project_id = p_project_id AND expense_month = p_year_month), 0),
    COALESCE((SELECT lagged_revenue_kes FROM lagged_revenue_by_project_month
              WHERE project_id = p_project_id AND expense_month = p_year_month), 0)
  INTO v_revenue_usd, v_revenue_kes;

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
-- 2. fn_generate_monthly_snapshot — NULL-safe lagged revenue read
-- ---------------------------------------------------------------------

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
  -- Scalar-subquery + COALESCE pattern is NULL-safe both when the view
  -- returns no row AND when it returns a row with NULL columns.
  SELECT
    COALESCE((SELECT total_revenue_usd FROM lagged_revenue_company_month
              WHERE expense_month = p_year_month), 0),
    COALESCE((SELECT total_revenue_kes FROM lagged_revenue_company_month
              WHERE expense_month = p_year_month), 0)
  INTO v_rev_usd, v_rev_kes;

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
