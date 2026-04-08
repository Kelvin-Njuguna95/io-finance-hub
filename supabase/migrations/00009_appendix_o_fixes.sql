-- ============================================================
-- IO Finance Hub — Appendix O Diagnostic Fixes
-- Missing tables, columns, and views
-- ============================================================

-- -----------------------------------------------
-- 1. Create missing table: outstanding_receivables_snapshot
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS outstanding_receivables_snapshot (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month text NOT NULL,
  project_id uuid REFERENCES projects(id),
  client_name text,
  invoice_ref text,
  amount_usd numeric DEFAULT 0,
  amount_kes numeric DEFAULT 0,
  days_outstanding integer DEFAULT 0,
  status text DEFAULT 'outstanding',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outstanding_recv_year_month ON outstanding_receivables_snapshot(year_month);
CREATE INDEX IF NOT EXISTS idx_outstanding_recv_project ON outstanding_receivables_snapshot(project_id);

-- -----------------------------------------------
-- 2. Create missing table: forex_rates
-- -----------------------------------------------

CREATE TABLE IF NOT EXISTS forex_rates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rate_date date NOT NULL,
  currency_pair text DEFAULT 'USD/KES',
  rate numeric NOT NULL,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forex_rates_date ON forex_rates(rate_date);

-- -----------------------------------------------
-- 3. Add missing invoice columns
-- -----------------------------------------------

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total_paid numeric DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS balance_outstanding numeric DEFAULT 0;

-- -----------------------------------------------
-- 4. Add missing expense columns
-- -----------------------------------------------

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS period_month text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS imported_by uuid;

-- -----------------------------------------------
-- 5. Create missing views
-- -----------------------------------------------

CREATE OR REPLACE VIEW variance_summary_by_project AS
SELECT
  b.project_id,
  p.name as project_name,
  b.year_month,
  COALESCE(bv.total_amount_kes, 0) as budget_kes,
  COALESCE(SUM(e.amount_kes), 0) as actual_kes,
  COALESCE(bv.total_amount_kes, 0) - COALESCE(SUM(e.amount_kes), 0) as variance_kes
FROM budgets b
LEFT JOIN projects p ON p.id = b.project_id
LEFT JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'
LEFT JOIN expenses e ON e.project_id = b.project_id AND e.year_month = b.year_month
WHERE b.project_id IS NOT NULL
GROUP BY b.project_id, p.name, b.year_month, bv.total_amount_kes;

CREATE OR REPLACE VIEW variance_summary_company AS
SELECT
  year_month,
  SUM(budget_kes) as total_budget_kes,
  SUM(actual_kes) as total_actual_kes,
  SUM(variance_kes) as total_variance_kes
FROM variance_summary_by_project
GROUP BY year_month;

-- -----------------------------------------------
-- 6. Enable RLS on new tables
-- -----------------------------------------------

ALTER TABLE outstanding_receivables_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE forex_rates ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access
CREATE POLICY "Service role full access on outstanding_receivables_snapshot"
  ON outstanding_receivables_snapshot FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on forex_rates"
  ON forex_rates FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow authenticated users to read
CREATE POLICY "Authenticated read on outstanding_receivables_snapshot"
  ON outstanding_receivables_snapshot FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on forex_rates"
  ON forex_rates FOR SELECT
  USING (auth.role() = 'authenticated');
