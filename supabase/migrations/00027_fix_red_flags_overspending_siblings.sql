-- =========================================================
-- Fix F-29: fn_generate_red_flags overspending — sibling-budget aggregation fix
--
-- Background:
--   The overspending check in fn_generate_red_flags (Block B) previously
--   aggregated per `b.id` (per individual budget row). When a project had
--   multiple approved sibling budgets for the same year_month and
--   confirmed expenses were distributed unevenly across them via
--   expenses.budget_id, the check could fire a false CRITICAL flag on
--   the smaller sibling — even when the project was well within its
--   combined budget.
--
-- User business rule (confirmed 2026-04-24):
--   Multiple approved sibling budgets per (project_id, year_month) are
--   LEGITIMATE. They represent separate intentional submissions on
--   different days as new needs arise (initial month-start budget plus
--   mid-month supplementals). Overspending must be evaluated at the
--   project-month level (or department-month level), not per-budget.
--
-- Approach (matches the F-27 view fix pattern, migration 00026 / commit
-- 21adfbe):
--   * Outer aggregate groups by (project_id, department_id) so sibling
--     budgets sum cleanly into a single budget_total per scope+month.
--     The budget_scope_check constraint (00002:125-128) enforces exactly
--     one of project_id/department_id is NOT NULL per budget row, so
--     the grouping naturally separates project-scoped from
--     department-scoped budgets without merging them.
--   * actual_total is computed by a correlated subquery summing
--     confirmed expenses whose budget_id points to ANY sibling budget
--     in the same scope+month. Each expense has exactly one budget_id,
--     so this is a 1:1 join (no fan-out).
--
-- reference_id and reference_table are set NULL on the new flags. There
-- is no longer a single "owning" budget row to point at — the flag is
-- about the project-month aggregate. This matches the missing_agent_counts
-- precedent in the same function (which also omits reference_id /
-- reference_table). The red-flags UI does not follow these columns to
-- navigate, so there is no user-visible regression.
--
-- Out of scope for this fix (tracked in AUDIT_1_CORRECTNESS.md):
--   * F-30 (latent): once F-07 lands and budgets carry multiple historical
--     approved versions, both this function and the F-27 view will need
--     `bv.version_number = b.current_version` filtering. Does not fire
--     today because F-07 keeps each budget at exactly one approved
--     version.
--   * F-31 (informational): F-27 view and F-29 function use different
--     expense-matching paths to compute the same business quantity
--     (project_id+year_month vs budget_id). The F-29 function uses
--     budget_id linkage intentionally, because it must also support
--     department-scoped budgets (which the F-27 view does not cover at
--     all). They should agree on project-scoped totals if expense->budget
--     references are clean. Any divergence is a data-hygiene finding,
--     not a logic bug here.
--
-- Function signature, language, security, and ALL other blocks (DECLARE,
-- threshold loading, DELETE, Block A budget_pending_approval, Block C
-- invoice_overdue, Block D missing_agent_counts, Block E missing_forex,
-- final SELECT COUNT, RETURN) are preserved byte-for-byte from the live
-- definition (verified 2026-04-25 via pg_get_functiondef; no drift from
-- migration 00025 Block D).
-- =========================================================

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

  -- 2. Overspending vs approved budget (F-29 fix — aggregates sibling budgets per project-month)
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT
    'overspending',
    CASE WHEN (sub.actual_total / sub.budget_total * 100) > 100 THEN 'critical' ELSE 'high' END::red_flag_severity,
    'Budget overspend: ' || COALESCE(p.name, d.name, 'Unknown'),
    'Spent ' || ROUND(sub.actual_total, 2) || ' USD of ' || ROUND(sub.budget_total, 2) || ' USD budget (' || ROUND(sub.actual_total / NULLIF(sub.budget_total, 0) * 100, 1) || '%)',
    sub.project_id,
    p_year_month,
    NULL,
    NULL
  FROM (
    SELECT
      b.project_id,
      b.department_id,
      SUM(bv.total_amount_usd) AS budget_total,
      COALESCE((
        SELECT SUM(e.amount_usd)
        FROM expenses e
        JOIN budgets b2 ON b2.id = e.budget_id
        WHERE b2.year_month = p_year_month
          AND ((b.project_id IS NOT NULL AND b2.project_id = b.project_id)
            OR (b.department_id IS NOT NULL AND b2.department_id = b.department_id))
          AND e.lifecycle_status = 'confirmed'
      ), 0) AS actual_total
    FROM budgets b
    JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'
    WHERE b.year_month = p_year_month
    GROUP BY b.project_id, b.department_id
  ) sub
  LEFT JOIN projects p ON p.id = sub.project_id
  LEFT JOIN departments d ON d.id = sub.department_id
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
