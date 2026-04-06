-- ============================================================
-- IO Finance Hub — Row Level Security Policies
-- ============================================================

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user is CFO
CREATE OR REPLACE FUNCTION is_cfo()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'cfo');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user is accountant
CREATE OR REPLACE FUNCTION is_accountant()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'accountant');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user has project assignment
CREATE OR REPLACE FUNCTION has_project_access(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_project_assignments
    WHERE user_id = auth.uid() AND project_id = p_project_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if user has department assignment
CREATE OR REPLACE FUNCTION has_department_access(p_department_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_department_assignments
    WHERE user_id = auth.uid() AND department_id = p_department_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- -----------------------------------------------
-- USERS TABLE
-- -----------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select ON users FOR SELECT USING (
  is_cfo() OR is_accountant() OR id = auth.uid()
);

CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY users_update ON users FOR UPDATE USING (is_cfo());

-- -----------------------------------------------
-- DEPARTMENTS
-- -----------------------------------------------
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY departments_select ON departments FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  get_user_role() = 'project_manager'
);

CREATE POLICY departments_insert ON departments FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY departments_update ON departments FOR UPDATE USING (is_cfo());
CREATE POLICY departments_delete ON departments FOR DELETE USING (is_cfo());

-- -----------------------------------------------
-- PROJECTS
-- -----------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_select ON projects FOR SELECT USING (
  is_cfo() OR is_accountant() OR has_project_access(id)
);

CREATE POLICY projects_insert ON projects FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY projects_update ON projects FOR UPDATE USING (is_cfo());

-- -----------------------------------------------
-- USER PROJECT ASSIGNMENTS
-- -----------------------------------------------
ALTER TABLE user_project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY upa_select ON user_project_assignments FOR SELECT USING (
  is_cfo() OR is_accountant() OR user_id = auth.uid()
);

CREATE POLICY upa_insert ON user_project_assignments FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY upa_delete ON user_project_assignments FOR DELETE USING (is_cfo());

-- -----------------------------------------------
-- USER DEPARTMENT ASSIGNMENTS
-- -----------------------------------------------
ALTER TABLE user_department_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY uda_select ON user_department_assignments FOR SELECT USING (
  is_cfo() OR is_accountant() OR user_id = auth.uid()
);

CREATE POLICY uda_insert ON user_department_assignments FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY uda_delete ON user_department_assignments FOR DELETE USING (is_cfo());

-- -----------------------------------------------
-- MONTH CLOSURES
-- -----------------------------------------------
ALTER TABLE month_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY mc_select ON month_closures FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY mc_insert ON month_closures FOR INSERT WITH CHECK (is_cfo());
CREATE POLICY mc_update ON month_closures FOR UPDATE USING (is_cfo());

-- -----------------------------------------------
-- AGENT COUNTS
-- -----------------------------------------------
ALTER TABLE agent_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ac_select ON agent_counts FOR SELECT USING (
  is_cfo() OR is_accountant() OR has_project_access(project_id)
);

CREATE POLICY ac_insert ON agent_counts FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant() OR
  (get_user_role() = 'team_leader' AND has_project_access(project_id))
);

CREATE POLICY ac_update ON agent_counts FOR UPDATE USING (
  (is_cfo() OR is_accountant() OR
   (get_user_role() = 'team_leader' AND has_project_access(project_id)))
  AND NOT is_locked
);

-- -----------------------------------------------
-- BUDGETS
-- -----------------------------------------------
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_select ON budgets FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  (project_id IS NOT NULL AND has_project_access(project_id)) OR
  (department_id IS NOT NULL AND has_department_access(department_id))
);

CREATE POLICY budgets_insert ON budgets FOR INSERT WITH CHECK (
  is_cfo() OR
  (get_user_role() = 'team_leader' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
  (get_user_role() = 'project_manager' AND department_id IS NOT NULL AND has_department_access(department_id))
);

CREATE POLICY budgets_update ON budgets FOR UPDATE USING (
  is_cfo() OR is_accountant() OR
  (get_user_role() = 'team_leader' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
  (get_user_role() = 'project_manager' AND department_id IS NOT NULL AND has_department_access(department_id))
);

-- -----------------------------------------------
-- BUDGET VERSIONS
-- -----------------------------------------------
ALTER TABLE budget_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bv_select ON budget_versions FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM budgets b WHERE b.id = budget_id AND (
      (b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

CREATE POLICY bv_insert ON budget_versions FOR INSERT WITH CHECK (
  is_cfo() OR
  EXISTS (
    SELECT 1 FROM budgets b WHERE b.id = budget_id AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

CREATE POLICY bv_update ON budget_versions FOR UPDATE USING (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM budgets b WHERE b.id = budget_id AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

-- -----------------------------------------------
-- BUDGET ITEMS
-- -----------------------------------------------
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bi_select ON budget_items FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM budget_versions bv
    JOIN budgets b ON b.id = bv.budget_id
    WHERE bv.id = budget_version_id AND (
      (b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

CREATE POLICY bi_insert ON budget_items FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM budget_versions bv
    JOIN budgets b ON b.id = bv.budget_id
    WHERE bv.id = budget_version_id AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

CREATE POLICY bi_update ON budget_items FOR UPDATE USING (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM budget_versions bv
    JOIN budgets b ON b.id = bv.budget_id
    WHERE bv.id = budget_version_id AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id))
    )
  )
);

-- -----------------------------------------------
-- BUDGET APPROVALS
-- -----------------------------------------------
ALTER TABLE budget_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY ba_select ON budget_approvals FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY ba_insert ON budget_approvals FOR INSERT WITH CHECK (is_cfo());

-- -----------------------------------------------
-- EXPENSES
-- -----------------------------------------------
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_select ON expenses FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  (project_id IS NOT NULL AND has_project_access(project_id))
);

CREATE POLICY expenses_insert ON expenses FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant()
);

CREATE POLICY expenses_update ON expenses FOR UPDATE USING (
  is_cfo() OR is_accountant()
);

-- -----------------------------------------------
-- EXPENSE & OVERHEAD CATEGORIES
-- -----------------------------------------------
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY ec_select ON expense_categories FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY ec_manage ON expense_categories FOR ALL USING (is_cfo());

ALTER TABLE overhead_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY oc_select ON overhead_categories FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY oc_manage ON overhead_categories FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- INVOICES
-- -----------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_select ON invoices FOR SELECT USING (
  is_cfo() OR is_accountant() OR has_project_access(project_id)
);

CREATE POLICY invoices_insert ON invoices FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant()
);

CREATE POLICY invoices_update ON invoices FOR UPDATE USING (
  is_cfo() OR is_accountant()
);

-- -----------------------------------------------
-- PAYMENTS
-- -----------------------------------------------
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select ON payments FOR SELECT USING (
  is_cfo() OR is_accountant() OR
  EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = invoice_id AND has_project_access(i.project_id)
  )
);

CREATE POLICY payments_insert ON payments FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant()
);

CREATE POLICY payments_update ON payments FOR UPDATE USING (
  is_cfo() OR is_accountant()
);

-- -----------------------------------------------
-- WITHDRAWALS
-- -----------------------------------------------
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawals_select ON withdrawals FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY withdrawals_insert ON withdrawals FOR INSERT WITH CHECK (
  is_cfo() OR is_accountant()
);

CREATE POLICY withdrawals_update ON withdrawals FOR UPDATE USING (
  is_cfo() OR is_accountant()
);

-- -----------------------------------------------
-- FOREX LOGS
-- -----------------------------------------------
ALTER TABLE forex_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY fl_select ON forex_logs FOR SELECT USING (is_cfo() OR is_accountant());
CREATE POLICY fl_insert ON forex_logs FOR INSERT WITH CHECK (is_cfo() OR is_accountant());

-- -----------------------------------------------
-- ALLOCATION RULES & OVERHEAD ALLOCATIONS
-- -----------------------------------------------
ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY ar_select ON allocation_rules FOR SELECT USING (is_cfo() OR is_accountant());
CREATE POLICY ar_manage ON allocation_rules FOR ALL USING (is_cfo());

ALTER TABLE overhead_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY oa_select ON overhead_allocations FOR SELECT USING (
  is_cfo() OR is_accountant() OR has_project_access(project_id)
);

CREATE POLICY oa_manage ON overhead_allocations FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- PROJECT PROFITABILITY
-- -----------------------------------------------
ALTER TABLE project_profitability ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_select ON project_profitability FOR SELECT USING (
  is_cfo() OR is_accountant() OR has_project_access(project_id)
);

CREATE POLICY pp_manage ON project_profitability FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- PROFIT SHARE RECORDS
-- -----------------------------------------------
ALTER TABLE profit_share_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY psr_select ON profit_share_records FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY psr_manage ON profit_share_records FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- MONTHLY FINANCIAL SNAPSHOTS
-- -----------------------------------------------
ALTER TABLE monthly_financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfs_select ON monthly_financial_snapshots FOR SELECT USING (
  is_cfo() OR is_accountant()
);

CREATE POLICY mfs_manage ON monthly_financial_snapshots FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- RED FLAGS
-- -----------------------------------------------
ALTER TABLE red_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY rf_select ON red_flags FOR SELECT USING (is_cfo());
CREATE POLICY rf_manage ON red_flags FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- SYSTEM SETTINGS
-- -----------------------------------------------
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ss_select ON system_settings FOR SELECT USING (is_cfo() OR is_accountant());
CREATE POLICY ss_manage ON system_settings FOR ALL USING (is_cfo());

-- -----------------------------------------------
-- AUDIT LOGS
-- -----------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY al_select ON audit_logs FOR SELECT USING (is_cfo());
CREATE POLICY al_insert ON audit_logs FOR INSERT WITH CHECK (true);  -- all roles can create audit entries
