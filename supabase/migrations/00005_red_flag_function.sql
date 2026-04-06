-- ============================================================
-- IO Finance Hub — Red Flag Generation
-- ============================================================

CREATE OR REPLACE FUNCTION fn_generate_red_flags(p_year_month TEXT)
RETURNS INTEGER AS $$
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
    LEFT JOIN expenses e ON e.budget_id = b.id AND e.year_month = p_year_month
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
