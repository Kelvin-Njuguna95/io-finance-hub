-- =========================================================
-- Fix F-26: Add lifecycle_status='confirmed' filter to remaining expense aggregates
--
-- Fix 2a (commits 8929e57 / 82cb118 — migration 00024) added the
-- lifecycle filter to lagged_revenue_by_project_month. This migration
-- (Fix 2a-bis) extends the same filter to the five other expense
-- aggregates that the F-26 deferred queue identified.
--
-- Objects redefined here (in apply order):
--   A. fn_calculate_project_profitability     (00004)
--   B. fn_calculate_overhead_allocations      (00004)
--   C. fn_generate_monthly_snapshot           (00004) — both project and
--                                                       shared overhead
--                                                       aggregates
--   D. fn_generate_red_flags                  (00005) — overspending
--                                                       LEFT JOIN ON clause
--   E. variance_summary_by_project (view)     (00009) — LEFT JOIN ON clause
--
-- Not touched (intentional):
--   * variance_summary_company (00009)            — derived from E,
--                                                   inherits the fix
--   * lagged_revenue_by_project_month keyset      — per product decision
--     in Fix 2a (zero-expense rows for voided-only projects are correct
--     semantics)
--   * fn_month_closure_warnings orphan-expense    — integrity check that
--     check (00004:494)                              must see all expenses;
--                                                    audit misclassified
--                                                    this as an aggregate.
--
-- For each object the body is copied byte-for-byte from
-- pg_get_functiondef / pg_get_viewdef on the live database, with the
-- single mutation being:
--   * Functions A, B, C: append `AND lifecycle_status = 'confirmed'`
--     to the expense aggregate's WHERE clause
--   * Function D and view E: extend the
--     `LEFT JOIN expenses e ON ...` predicate with
--     `AND e.lifecycle_status = 'confirmed'` (in the ON clause, not a
--     new WHERE — preserves LEFT JOIN semantics so budgets/projects
--     with zero confirmed expenses still appear in the result with 0.)
--
-- Function signatures and view column shapes are preserved exactly,
-- so CREATE OR REPLACE is safe and the dependent variance_summary_company
-- view does not need to be touched.
--
-- Note on snapshot retroactivity: A, B, C write to result tables
-- (project_profitability, overhead_allocations, monthly_financial_snapshots).
-- After this migration, only FUTURE invocations of fn_close_month produce
-- corrected snapshot rows. Previously closed months retain their old
-- values until reopened and re-closed.
-- =========================================================


-- ---------------------------------------------------------
-- A. fn_calculate_project_profitability
-- ---------------------------------------------------------

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
  -- Revenue from invoices (accrual basis: by billing_period)
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_revenue_usd, v_revenue_kes
  FROM invoices
  WHERE project_id = p_project_id AND billing_period = p_year_month;

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


-- ---------------------------------------------------------
-- B. fn_calculate_overhead_allocations
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_calculate_overhead_allocations(p_year_month text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_method allocation_method;
  v_rev_weight NUMERIC(5,2);
  v_hc_weight NUMERIC(5,2);
  v_total_revenue NUMERIC(16,4);
  v_total_agents INTEGER;
  v_total_overhead_usd NUMERIC(16,4);
  v_total_overhead_kes NUMERIC(16,2);
  r RECORD;
BEGIN
  -- Get allocation rule for this month
  SELECT method, revenue_weight, headcount_weight
  INTO v_method, v_rev_weight, v_hc_weight
  FROM allocation_rules
  WHERE year_month = p_year_month;

  IF v_method IS NULL THEN
    v_method := 'revenue_based';
    v_rev_weight := 100;
    v_hc_weight := 0;
  END IF;

  -- Total revenue across all projects for this month
  SELECT COALESCE(SUM(amount_usd), 0)
  INTO v_total_revenue
  FROM invoices WHERE billing_period = p_year_month;

  -- Total agents across all projects for this month
  SELECT COALESCE(SUM(agent_count), 0)
  INTO v_total_agents
  FROM agent_counts WHERE year_month = p_year_month;

  -- Total shared overhead for this month
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_total_overhead_usd, v_total_overhead_kes
  FROM expenses
  WHERE year_month = p_year_month AND expense_type = 'shared_expense'
    AND lifecycle_status = 'confirmed';

  -- For each active project, calculate allocation share
  FOR r IN SELECT p.id AS project_id,
                  COALESCE((SELECT SUM(amount_usd) FROM invoices WHERE project_id = p.id AND billing_period = p_year_month), 0) AS proj_revenue,
                  COALESCE((SELECT agent_count FROM agent_counts WHERE project_id = p.id AND year_month = p_year_month), 0) AS proj_agents
           FROM projects p WHERE p.is_active = true
  LOOP
    DECLARE
      v_rev_pct NUMERIC(8,4) := 0;
      v_hc_pct NUMERIC(8,4) := 0;
      v_final_pct NUMERIC(8,4) := 0;
      v_alloc_usd NUMERIC(16,4) := 0;
      v_alloc_kes NUMERIC(16,2) := 0;
    BEGIN
      IF v_total_revenue > 0 THEN
        v_rev_pct := (r.proj_revenue / v_total_revenue) * 100;
      END IF;
      IF v_total_agents > 0 THEN
        v_hc_pct := (r.proj_agents::NUMERIC / v_total_agents) * 100;
      END IF;
      CASE v_method
        WHEN 'revenue_based' THEN v_final_pct := v_rev_pct;
        WHEN 'headcount_based' THEN v_final_pct := v_hc_pct;
        WHEN 'hybrid' THEN v_final_pct := (v_rev_pct * v_rev_weight / 100) + (v_hc_pct * v_hc_weight / 100);
      END CASE;
      v_alloc_usd := v_total_overhead_usd * v_final_pct / 100;
      v_alloc_kes := v_total_overhead_kes * v_final_pct / 100;
      INSERT INTO overhead_allocations (
        project_id, year_month, allocation_method,
        revenue_share_pct, headcount_share_pct, final_share_pct,
        allocated_amount_usd, allocated_amount_kes
      )
      VALUES (
        r.project_id, p_year_month, v_method,
        v_rev_pct, v_hc_pct, v_final_pct,
        v_alloc_usd, v_alloc_kes
      )
      ON CONFLICT (project_id, year_month) DO UPDATE SET
        allocation_method = EXCLUDED.allocation_method,
        revenue_share_pct = EXCLUDED.revenue_share_pct,
        headcount_share_pct = EXCLUDED.headcount_share_pct,
        final_share_pct = EXCLUDED.final_share_pct,
        allocated_amount_usd = EXCLUDED.allocated_amount_usd,
        allocated_amount_kes = EXCLUDED.allocated_amount_kes;
    END;
  END LOOP;
END;
$function$;


-- ---------------------------------------------------------
-- C. fn_generate_monthly_snapshot
-- ---------------------------------------------------------

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
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_rev_usd, v_rev_kes
  FROM invoices WHERE billing_period = p_year_month;

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


-- ---------------------------------------------------------
-- D. fn_generate_red_flags
--    The lifecycle filter is added to the LEFT JOIN's ON clause
--    (NOT a new WHERE) so budgets with zero confirmed expenses
--    still appear in the subquery with actual_total = 0 and simply
--    don't trip the overspending threshold.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_generate_red_flags(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_overdue_days INTEGER;
  v_spike_pct INTEGER;
  v_budget_warn_pct INTEGER;
  v_flag_count INTEGER := 0;
BEGIN
  -- Load configurable thresholds
  SELECT value::INTEGER INTO v_overdue_days FROM system_settings WHERE key = 'overdue_invoice_days';
  SELECT value::INTEGER INTO v_spike_pct FROM system_settings WHERE key = 'expense_spike_threshold_percent';
  SELECT value::INTEGER INTO v_budget_warn_pct FROM system_settings WHERE key = 'budget_warning_threshold_percent';

  v_overdue_days := COALESCE(v_overdue_days, 30);
  v_spike_pct := COALESCE(v_spike_pct, 30);
  v_budget_warn_pct := COALESCE(v_budget_warn_pct, 90);

  -- Clear existing unresolved flags for this month (to regenerate)
  DELETE FROM red_flags WHERE year_month = p_year_month AND is_resolved = false;

  -- 1. Budgets pending approval
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT 'budget_pending_approval', 'high',
         'Budget pending approval for ' || COALESCE(p.name, d.name, 'Unknown'),
         'Budget version ' || bv.version_number || ' has been pending since ' || bv.submitted_at::date,
         b.project_id, p_year_month, b.id, 'budgets'
  FROM budgets b
  JOIN budget_versions bv ON bv.budget_id = b.id AND bv.version_number = b.current_version
  LEFT JOIN projects p ON p.id = b.project_id
  LEFT JOIN departments d ON d.id = b.department_id
  WHERE b.year_month = p_year_month
    AND bv.status IN ('submitted', 'under_review');

  GET DIAGNOSTICS v_flag_count = ROW_COUNT;

  -- 2. Overspending vs approved budget
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT 'overspending',
         CASE WHEN (actual_total / budget_total * 100) > 100 THEN 'critical' ELSE 'high' END::red_flag_severity,
         'Budget overspend: ' || COALESCE(p.name, d.name, 'Unknown'),
         'Spent ' || ROUND(actual_total, 2) || ' USD of ' || ROUND(budget_total, 2) || ' USD budget (' || ROUND(actual_total / NULLIF(budget_total, 0) * 100, 1) || '%)',
         b.project_id, p_year_month, b.id, 'budgets'
  FROM (
    SELECT b.id AS budget_id, b.project_id, b.department_id,
           COALESCE(bv.total_amount_usd, 0) AS budget_total,
           COALESCE(SUM(e.amount_usd), 0) AS actual_total
    FROM budgets b
    JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'
    LEFT JOIN expenses e ON e.budget_id = b.id AND e.year_month = p_year_month AND e.lifecycle_status = 'confirmed'
    WHERE b.year_month = p_year_month
    GROUP BY b.id, b.project_id, b.department_id, bv.total_amount_usd
  ) sub
  JOIN budgets b ON b.id = sub.budget_id
  LEFT JOIN projects p ON p.id = b.project_id
  LEFT JOIN departments d ON d.id = b.department_id
  WHERE sub.budget_total > 0
    AND (sub.actual_total / sub.budget_total * 100) >= v_budget_warn_pct;

  -- 3. Overdue invoices
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT 'invoice_overdue', 'high',
         'Overdue invoice: ' || i.invoice_number,
         'Invoice for ' || p.name || ' is ' || (CURRENT_DATE - i.due_date) || ' days overdue',
         i.project_id, p_year_month, i.id, 'invoices'
  FROM invoices i
  JOIN projects p ON p.id = i.project_id
  WHERE i.status NOT IN ('paid', 'cancelled')
    AND i.due_date IS NOT NULL
    AND i.due_date < CURRENT_DATE - v_overdue_days
    AND i.billing_period = p_year_month;

  -- 4. Missing agent counts
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month)
  SELECT 'missing_agent_counts', 'medium',
         'Missing agent count: ' || p.name,
         'No agent count entered for ' || p.name || ' in ' || p_year_month,
         p.id, p_year_month
  FROM projects p
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM agent_counts ac WHERE ac.project_id = p.id AND ac.year_month = p_year_month
    );

  -- 5. Missing forex entries for withdrawals
  INSERT INTO red_flags (flag_type, severity, title, description, year_month, reference_id, reference_table)
  SELECT 'missing_forex', 'high',
         'Missing forex log for withdrawal',
         'Withdrawal of ' || w.amount_usd || ' USD on ' || w.withdrawal_date || ' has no forex log',
         p_year_month, w.id, 'withdrawals'
  FROM withdrawals w
  WHERE w.year_month = p_year_month
    AND NOT EXISTS (
      SELECT 1 FROM forex_logs fl WHERE fl.withdrawal_id = w.id
    );

  SELECT COUNT(*) INTO v_flag_count FROM red_flags WHERE year_month = p_year_month AND is_resolved = false;

  RETURN v_flag_count;
END;
$function$;


-- ---------------------------------------------------------
-- E. variance_summary_by_project (view)
--    Same LEFT-JOIN-ON treatment as D so projects with zero confirmed
--    expenses still show up with actual_kes = 0.
--    variance_summary_company is a downstream aggregate and inherits
--    automatically; it is intentionally not redefined here.
-- ---------------------------------------------------------

CREATE OR REPLACE VIEW public.variance_summary_by_project AS
 SELECT b.project_id,
    p.name AS project_name,
    b.year_month,
    COALESCE(bv.total_amount_kes, 0::numeric) AS budget_kes,
    COALESCE(sum(e.amount_kes), 0::numeric) AS actual_kes,
    COALESCE(bv.total_amount_kes, 0::numeric) - COALESCE(sum(e.amount_kes), 0::numeric) AS variance_kes
   FROM budgets b
     LEFT JOIN projects p ON p.id = b.project_id
     LEFT JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'::budget_status
     LEFT JOIN expenses e ON e.project_id = b.project_id AND e.year_month = b.year_month AND e.lifecycle_status = 'confirmed'
  WHERE b.project_id IS NOT NULL
  GROUP BY b.project_id, p.name, b.year_month, bv.total_amount_kes;
