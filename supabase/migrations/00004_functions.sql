-- ============================================================
-- IO Finance Hub — Database Functions & Triggers
-- ============================================================

-- -----------------------------------------------
-- AUDIT LOG TRIGGER (generic)
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to key tables
CREATE TRIGGER audit_budgets AFTER INSERT OR UPDATE OR DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_budget_versions AFTER INSERT OR UPDATE OR DELETE ON budget_versions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_budget_items AFTER INSERT OR UPDATE OR DELETE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_withdrawals AFTER INSERT OR UPDATE OR DELETE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_month_closures AFTER INSERT OR UPDATE ON month_closures
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_profit_share AFTER INSERT OR UPDATE ON profit_share_records
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_agent_counts AFTER INSERT OR UPDATE ON agent_counts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- -----------------------------------------------
-- UPDATED_AT TRIGGER (generic)
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_departments BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_projects BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_budgets BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_budget_versions BEFORE UPDATE ON budget_versions FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_budget_items BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_expenses BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_invoices BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_payments BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_withdrawals BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_month_closures BEFORE UPDATE ON month_closures FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_agent_counts BEFORE UPDATE ON agent_counts FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_overhead_allocations BEFORE UPDATE ON overhead_allocations FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_project_profitability BEFORE UPDATE ON project_profitability FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_profit_share BEFORE UPDATE ON profit_share_records FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_monthly_snapshots BEFORE UPDATE ON monthly_financial_snapshots FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER set_updated_at_red_flags BEFORE UPDATE ON red_flags FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- -----------------------------------------------
-- VALIDATION: Expense must link to APPROVED budget
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_validate_expense_budget()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM budget_versions
    WHERE id = NEW.budget_version_id
      AND budget_id = NEW.budget_id
      AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Expenses can only be linked to APPROVED budget versions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_expense_budget
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION fn_validate_expense_budget();

-- -----------------------------------------------
-- VALIDATION: Lock agent counts after month closure
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_lock_agent_count()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD IS NOT NULL AND OLD.is_locked = true AND NEW.is_locked = true THEN
    -- Allow CFO override
    IF NOT is_cfo() THEN
      RAISE EXCEPTION 'Agent counts are locked for this month';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lock_agent_count
  BEFORE UPDATE ON agent_counts
  FOR EACH ROW EXECUTE FUNCTION fn_lock_agent_count();

-- -----------------------------------------------
-- VALIDATION: Prevent director change after first invoice
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_protect_director_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.director_user_id IS DISTINCT FROM NEW.director_user_id THEN
    IF EXISTS (SELECT 1 FROM invoices WHERE project_id = NEW.id LIMIT 1) THEN
      -- Only CFO can override, and must provide reason via audit log
      IF NOT is_cfo() THEN
        RAISE EXCEPTION 'Director assignment cannot be changed after invoices exist. CFO override required.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER protect_director_assignment
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION fn_protect_director_assignment();

-- -----------------------------------------------
-- FUNCTION: Calculate project profitability for a month
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_calculate_project_profitability(
  p_project_id UUID,
  p_year_month TEXT
)
RETURNS VOID AS $$
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
    AND expense_type = 'project_expense';

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Calculate overhead allocations for a month
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_calculate_overhead_allocations(p_year_month TEXT)
RETURNS VOID AS $$
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
  WHERE year_month = p_year_month AND expense_type = 'shared_expense';

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Generate profit share records for a month
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_generate_profit_shares(p_year_month TEXT)
RETURNS VOID AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pp.project_id, pp.distributable_profit_usd, pp.distributable_profit_kes,
           p.director_tag, p.director_user_id
    FROM project_profitability pp
    JOIN projects p ON p.id = pp.project_id
    WHERE pp.year_month = p_year_month
      AND pp.distributable_profit_usd > 0
  LOOP
    INSERT INTO profit_share_records (
      project_id, year_month, director_tag, director_user_id,
      distributable_profit_usd, distributable_profit_kes,
      director_share_usd, director_share_kes,
      company_share_usd, company_share_kes,
      status
    )
    VALUES (
      r.project_id, p_year_month, r.director_tag, r.director_user_id,
      r.distributable_profit_usd, r.distributable_profit_kes,
      ROUND(r.distributable_profit_usd * 0.70, 4),
      ROUND(r.distributable_profit_kes * 0.70, 2),
      ROUND(r.distributable_profit_usd * 0.30, 4),
      ROUND(r.distributable_profit_kes * 0.30, 2),
      'pending_review'
    )
    ON CONFLICT (project_id, year_month) DO UPDATE SET
      distributable_profit_usd = EXCLUDED.distributable_profit_usd,
      distributable_profit_kes = EXCLUDED.distributable_profit_kes,
      director_share_usd = EXCLUDED.director_share_usd,
      director_share_kes = EXCLUDED.director_share_kes,
      company_share_usd = EXCLUDED.company_share_usd,
      company_share_kes = EXCLUDED.company_share_kes,
      status = 'pending_review';
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Generate monthly financial snapshot
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_generate_monthly_snapshot(p_year_month TEXT)
RETURNS VOID AS $$
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
  FROM expenses WHERE year_month = p_year_month AND expense_type = 'project_expense';

  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_overhead_usd, v_overhead_kes
  FROM expenses WHERE year_month = p_year_month AND expense_type = 'shared_expense';

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Month closure checks (returns warnings)
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_month_closure_warnings(p_year_month TEXT)
RETURNS TABLE(warning_type TEXT, warning_message TEXT, severity TEXT) AS $$
BEGIN
  -- Unapproved budgets
  RETURN QUERY
  SELECT 'unapproved_budgets'::TEXT,
         'There are ' || COUNT(*)::TEXT || ' budgets not yet approved'::TEXT,
         'high'::TEXT
  FROM budgets b
  JOIN budget_versions bv ON bv.budget_id = b.id AND bv.version_number = b.current_version
  WHERE b.year_month = p_year_month AND bv.status != 'approved'
  HAVING COUNT(*) > 0;

  -- Missing agent counts
  RETURN QUERY
  SELECT 'missing_agent_counts'::TEXT,
         'Missing agent counts for project: ' || p.name,
         'medium'::TEXT
  FROM projects p
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM agent_counts ac WHERE ac.project_id = p.id AND ac.year_month = p_year_month
    );

  -- Expenses without budget link (should not happen with constraint, but check)
  RETURN QUERY
  SELECT 'unlinked_expenses'::TEXT,
         COUNT(*)::TEXT || ' expenses found without approved budget link',
         'critical'::TEXT
  FROM expenses e
  WHERE e.year_month = p_year_month
    AND NOT EXISTS (
      SELECT 1 FROM budget_versions bv WHERE bv.id = e.budget_version_id AND bv.status = 'approved'
    )
  HAVING COUNT(*) > 0;

  -- Missing forex entries after withdrawals
  RETURN QUERY
  SELECT 'missing_forex'::TEXT,
         'Withdrawal on ' || w.withdrawal_date::TEXT || ' has no forex log entry',
         'high'::TEXT
  FROM withdrawals w
  WHERE w.year_month = p_year_month
    AND NOT EXISTS (
      SELECT 1 FROM forex_logs fl WHERE fl.withdrawal_id = w.id
    );

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Close a month (CFO only, called from Edge Function)
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_close_month(
  p_year_month TEXT,
  p_warnings_acknowledged JSONB DEFAULT '[]'
)
RETURNS VOID AS $$
BEGIN
  IF NOT is_cfo() THEN
    RAISE EXCEPTION 'Only CFO can close months';
  END IF;

  -- Calculate overhead allocations
  PERFORM fn_calculate_overhead_allocations(p_year_month);

  -- Calculate profitability for each project
  PERFORM fn_calculate_project_profitability(p.id, p_year_month)
  FROM projects p WHERE p.is_active = true;

  -- Generate profit share records
  PERFORM fn_generate_profit_shares(p_year_month);

  -- Generate monthly snapshot
  PERFORM fn_generate_monthly_snapshot(p_year_month);

  -- Lock agent counts
  UPDATE agent_counts SET is_locked = true WHERE year_month = p_year_month;

  -- Lock allocations
  UPDATE overhead_allocations SET is_locked = true WHERE year_month = p_year_month;

  -- Lock profitability
  UPDATE project_profitability SET is_locked = true WHERE year_month = p_year_month;

  -- Update month closure record
  INSERT INTO month_closures (year_month, status, warnings_acknowledged, closed_by, closed_at)
  VALUES (p_year_month, 'closed', p_warnings_acknowledged, auth.uid(), now())
  ON CONFLICT (year_month) DO UPDATE SET
    status = 'closed',
    warnings_acknowledged = p_warnings_acknowledged,
    closed_by = auth.uid(),
    closed_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------
-- FUNCTION: Reopen a month (CFO only, with reason)
-- -----------------------------------------------

CREATE OR REPLACE FUNCTION fn_reopen_month(
  p_year_month TEXT,
  p_reason TEXT
)
RETURNS VOID AS $$
BEGIN
  IF NOT is_cfo() THEN
    RAISE EXCEPTION 'Only CFO can reopen months';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required to reopen a month';
  END IF;

  UPDATE month_closures SET
    status = 'open',
    reopened_by = auth.uid(),
    reopened_at = now(),
    reopen_reason = p_reason
  WHERE year_month = p_year_month;

  -- Unlock records
  UPDATE agent_counts SET is_locked = false WHERE year_month = p_year_month;
  UPDATE overhead_allocations SET is_locked = false WHERE year_month = p_year_month;
  UPDATE project_profitability SET is_locked = false WHERE year_month = p_year_month;
  UPDATE profit_share_records SET is_locked = false WHERE year_month = p_year_month;
  UPDATE monthly_financial_snapshots SET is_locked = false WHERE year_month = p_year_month;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
