-- ============================================================
-- IO Finance Hub — Core Tables
-- ============================================================

-- -----------------------------------------------
-- USERS & AUTH
-- -----------------------------------------------

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role user_role NOT NULL,
  director_tag director_enum,  -- only set for users who are directors
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN users.director_tag IS 'Set only for users who are one of the 5 originating directors';

-- -----------------------------------------------
-- DEPARTMENTS
-- -----------------------------------------------

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- PROJECTS
-- -----------------------------------------------

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  director_user_id UUID NOT NULL REFERENCES users(id),
  director_tag director_enum NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN projects.director_user_id IS 'FK to users table — must be one of the 5 originating directors';
COMMENT ON COLUMN projects.director_tag IS 'Denormalized director enum for fast lookups and strict enforcement';

-- -----------------------------------------------
-- ACCESS MAPPING TABLES
-- -----------------------------------------------

CREATE TABLE user_project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, project_id)
);

CREATE TABLE user_department_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, department_id)
);

-- -----------------------------------------------
-- MONTH CLOSURES
-- -----------------------------------------------

CREATE TABLE month_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL UNIQUE,  -- format: YYYY-MM
  status month_status NOT NULL DEFAULT 'open',
  warnings_acknowledged JSONB DEFAULT '[]',
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,
  reopened_by UUID REFERENCES users(id),
  reopened_at TIMESTAMPTZ,
  reopen_reason TEXT,
  locked_by UUID REFERENCES users(id),
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- AGENT COUNTS
-- -----------------------------------------------

CREATE TABLE agent_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  year_month TEXT NOT NULL,
  agent_count INTEGER NOT NULL CHECK (agent_count >= 0),
  entered_by UUID NOT NULL REFERENCES users(id),
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, year_month),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- BUDGETS (Header + Versions + Items)
-- -----------------------------------------------

CREATE TABLE budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  department_id UUID REFERENCES departments(id),
  year_month TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Budget must link to exactly one scope
  CONSTRAINT budget_scope_check CHECK (
    (project_id IS NOT NULL AND department_id IS NULL) OR
    (project_id IS NULL AND department_id IS NOT NULL)
  ),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE budget_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status budget_status NOT NULL DEFAULT 'draft',
  total_amount_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  total_amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  submitted_by UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(budget_id, version_number)
);

CREATE TABLE budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id UUID NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT,
  amount_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  unit_cost_usd NUMERIC(16, 4),
  unit_cost_kes NUMERIC(16, 2),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- BUDGET APPROVALS
-- -----------------------------------------------

CREATE TABLE budget_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id UUID NOT NULL REFERENCES budget_versions(id),
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected')),
  approved_by UUID NOT NULL REFERENCES users(id),
  reason TEXT,  -- required for rejections
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- EXPENSE & OVERHEAD CATEGORIES
-- -----------------------------------------------

CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE overhead_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_allocation_method allocation_method NOT NULL DEFAULT 'revenue_based',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- EXPENSES
-- -----------------------------------------------

CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id),
  budget_version_id UUID NOT NULL REFERENCES budget_versions(id),
  expense_type expense_type NOT NULL,
  project_id UUID REFERENCES projects(id),
  overhead_category_id UUID REFERENCES overhead_categories(id),
  expense_category_id UUID REFERENCES expense_categories(id),
  description TEXT NOT NULL,
  amount_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  expense_date DATE NOT NULL,
  year_month TEXT NOT NULL,
  vendor TEXT,
  receipt_reference TEXT,
  notes TEXT,
  entered_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Project expenses must have project_id; shared must have overhead_category_id
  CONSTRAINT expense_scope_check CHECK (
    (expense_type = 'project_expense' AND project_id IS NOT NULL AND overhead_category_id IS NULL) OR
    (expense_type = 'shared_expense' AND overhead_category_id IS NOT NULL)
  ),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- INVOICES & PAYMENTS
-- -----------------------------------------------

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_date DATE NOT NULL,
  due_date DATE,
  billing_period TEXT NOT NULL,  -- YYYY-MM format
  amount_usd NUMERIC(16, 4) NOT NULL,
  amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  status invoice_status NOT NULL DEFAULT 'draft',
  description TEXT,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_billing_period CHECK (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  payment_date DATE NOT NULL,
  amount_usd NUMERIC(16, 4) NOT NULL,
  amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- WITHDRAWALS & FOREX
-- -----------------------------------------------

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_date DATE NOT NULL,
  director_tag director_enum NOT NULL,
  director_user_id UUID NOT NULL REFERENCES users(id),
  amount_usd NUMERIC(16, 4) NOT NULL,
  exchange_rate NUMERIC(12, 4) NOT NULL,
  amount_kes NUMERIC(16, 2) NOT NULL,
  forex_bureau TEXT,
  reference_id TEXT,
  reference_rate NUMERIC(12, 4),
  variance_kes NUMERIC(16, 2),
  year_month TEXT NOT NULL,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE forex_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID REFERENCES withdrawals(id),
  rate_date DATE NOT NULL,
  rate_usd_to_kes NUMERIC(12, 4) NOT NULL,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- OVERHEAD ALLOCATIONS
-- -----------------------------------------------

CREATE TABLE allocation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL,
  method allocation_method NOT NULL,
  revenue_weight NUMERIC(5, 2) DEFAULT 50.00,
  headcount_weight NUMERIC(5, 2) DEFAULT 50.00,
  set_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(year_month),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT weights_sum_100 CHECK (
    method != 'hybrid' OR (revenue_weight + headcount_weight = 100.00)
  )
);

CREATE TABLE overhead_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  year_month TEXT NOT NULL,
  allocation_method allocation_method NOT NULL,
  revenue_share_pct NUMERIC(8, 4) DEFAULT 0,
  headcount_share_pct NUMERIC(8, 4) DEFAULT 0,
  final_share_pct NUMERIC(8, 4) NOT NULL DEFAULT 0,
  allocated_amount_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  allocated_amount_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, year_month),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- PROJECT PROFITABILITY & PROFIT SHARE
-- -----------------------------------------------

CREATE TABLE project_profitability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  year_month TEXT NOT NULL,
  revenue_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  revenue_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  direct_expenses_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  direct_expenses_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  allocated_overhead_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  allocated_overhead_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  gross_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  gross_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  distributable_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  distributable_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  margin_pct NUMERIC(8, 4) DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, year_month),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

CREATE TABLE profit_share_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  year_month TEXT NOT NULL,
  director_tag director_enum NOT NULL,
  director_user_id UUID NOT NULL REFERENCES users(id),
  distributable_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  distributable_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  director_share_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,  -- 70%
  director_share_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  company_share_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,   -- 30%
  company_share_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  status profit_share_status NOT NULL DEFAULT 'pending_review',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  dispute_reason TEXT,
  adjustment_notes TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, year_month),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- MONTHLY FINANCIAL SNAPSHOTS
-- -----------------------------------------------

CREATE TABLE monthly_financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL UNIQUE,
  total_revenue_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  total_revenue_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total_direct_costs_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  total_direct_costs_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  gross_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  gross_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total_shared_overhead_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  total_shared_overhead_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  operating_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  operating_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  forex_gain_loss_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  net_profit_usd NUMERIC(16, 4) NOT NULL DEFAULT 0,
  net_profit_kes NUMERIC(16, 2) NOT NULL DEFAULT 0,
  total_agents INTEGER NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$')
);

-- -----------------------------------------------
-- RED FLAGS / ALERTS
-- -----------------------------------------------

CREATE TABLE red_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_type red_flag_type NOT NULL,
  severity red_flag_severity NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  project_id UUID REFERENCES projects(id),
  year_month TEXT,
  reference_id UUID,  -- generic FK to relevant record
  reference_table TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolved_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- SYSTEM SETTINGS
-- -----------------------------------------------

CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
  ('overdue_invoice_days', '30', 'Number of days after which an unpaid invoice is flagged as overdue'),
  ('expense_spike_threshold_percent', '30', 'Percentage increase in expenses that triggers a spike alert'),
  ('budget_warning_threshold_percent', '90', 'Percentage of budget utilization that triggers a warning');

-- -----------------------------------------------
-- AUDIT LOGS
-- -----------------------------------------------

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  reason TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------
-- INDEXES
-- -----------------------------------------------

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_director_tag ON users(director_tag) WHERE director_tag IS NOT NULL;
CREATE INDEX idx_projects_director ON projects(director_user_id);
CREATE INDEX idx_user_project_user ON user_project_assignments(user_id);
CREATE INDEX idx_user_project_project ON user_project_assignments(project_id);
CREATE INDEX idx_user_dept_user ON user_department_assignments(user_id);
CREATE INDEX idx_user_dept_dept ON user_department_assignments(department_id);
CREATE INDEX idx_budgets_project ON budgets(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_budgets_department ON budgets(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX idx_budgets_year_month ON budgets(year_month);
CREATE INDEX idx_budget_versions_budget ON budget_versions(budget_id);
CREATE INDEX idx_budget_versions_status ON budget_versions(status);
CREATE INDEX idx_budget_items_version ON budget_items(budget_version_id);
CREATE INDEX idx_expenses_budget ON expenses(budget_id);
CREATE INDEX idx_expenses_project ON expenses(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_expenses_year_month ON expenses(year_month);
CREATE INDEX idx_expenses_type ON expenses(expense_type);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_billing_period ON invoices(billing_period);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_withdrawals_year_month ON withdrawals(year_month);
CREATE INDEX idx_withdrawals_director ON withdrawals(director_tag);
CREATE INDEX idx_overhead_allocations_project_month ON overhead_allocations(project_id, year_month);
CREATE INDEX idx_project_profitability_project_month ON project_profitability(project_id, year_month);
CREATE INDEX idx_profit_share_project_month ON profit_share_records(project_id, year_month);
CREATE INDEX idx_profit_share_status ON profit_share_records(status);
CREATE INDEX idx_red_flags_resolved ON red_flags(is_resolved);
CREATE INDEX idx_red_flags_type ON red_flags(flag_type);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_month_closures_status ON month_closures(status);
CREATE INDEX idx_agent_counts_project_month ON agent_counts(project_id, year_month);
