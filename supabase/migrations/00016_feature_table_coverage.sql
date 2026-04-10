-- ============================================================
-- Tier 1 schema coverage for active feature tables
-- ============================================================

CREATE TABLE IF NOT EXISTS budget_withdrawal_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  withdrawn_by UUID NOT NULL REFERENCES users(id),
  year_month TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS misc_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  pm_user_id UUID REFERENCES users(id),
  monthly_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS misc_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  period_month TEXT NOT NULL,
  submitted_by UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  total_allocated NUMERIC(16,2) DEFAULT 0,
  total_drawn NUMERIC(16,2) DEFAULT 0,
  total_claimed NUMERIC(16,2) DEFAULT 0,
  variance NUMERIC(16,2) DEFAULT 0,
  cfo_reviewed_by UUID REFERENCES users(id),
  cfo_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS misc_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  misc_report_id UUID NOT NULL REFERENCES misc_reports(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  expense_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accountant_misc_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES users(id),
  period_month DATE NOT NULL,
  purpose TEXT NOT NULL,
  amount_requested NUMERIC(16,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cfo_decision_by UUID REFERENCES users(id),
  cfo_decision_at TIMESTAMPTZ,
  cfo_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accountant_misc_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month DATE NOT NULL UNIQUE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  total_requested NUMERIC(16,2) DEFAULT 0,
  total_itemised NUMERIC(16,2) DEFAULT 0,
  variance NUMERIC(16,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accountant_misc_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accountant_misc_report_id UUID NOT NULL REFERENCES accountant_misc_report(id) ON DELETE CASCADE,
  accountant_misc_request_id UUID REFERENCES accountant_misc_requests(id),
  description TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL,
  expense_date DATE NOT NULL,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by UUID REFERENCES users(id),
  file_name TEXT,
  period_month TEXT,
  total_rows INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  flagged_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eod_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date TEXT NOT NULL,
  sent_by UUID REFERENCES users(id),
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  slack_status TEXT NOT NULL DEFAULT 'failed',
  payload JSONB,
  expense_count INTEGER DEFAULT 0,
  withdrawal_count INTEGER DEFAULT 0,
  cash_received_count INTEGER DEFAULT 0,
  budget_action_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_date)
);

CREATE TABLE IF NOT EXISTS project_health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  period_month DATE NOT NULL,
  score INTEGER NOT NULL,
  score_band TEXT NOT NULL,
  biggest_drag TEXT,
  budget_score NUMERIC(5,2) DEFAULT 0,
  margin_score NUMERIC(5,2) DEFAULT 0,
  misc_score NUMERIC(5,2) DEFAULT 0,
  timeliness_score NUMERIC(5,2) DEFAULT 0,
  agent_score NUMERIC(5,2) DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, period_month)
);
