-- ============================================================
-- Appendix L: Budget-to-Expense Automation, Expense Lifecycle
-- & Variance Tracking — Schema Changes
-- Run this in the Supabase Dashboard SQL Editor
-- ============================================================

-- 1. Create pending_expenses table (auto-populated from approved budgets)
CREATE TABLE IF NOT EXISTS pending_expenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id         UUID NOT NULL REFERENCES budgets(id),
  budget_version_id UUID NOT NULL REFERENCES budget_versions(id),
  budget_item_id    UUID NOT NULL REFERENCES budget_items(id),
  project_id        UUID REFERENCES projects(id),
  department_id     UUID REFERENCES departments(id),
  year_month        TEXT NOT NULL,
  description       TEXT NOT NULL,
  category          TEXT,
  budgeted_amount_kes NUMERIC(12,2) NOT NULL,
  actual_amount_kes   NUMERIC(12,2),
  variance_kes        NUMERIC(12,2) GENERATED ALWAYS AS (
    COALESCE(actual_amount_kes, 0) - budgeted_amount_kes
  ) STORED,
  variance_pct        NUMERIC(8,2) GENERATED ALWAYS AS (
    CASE WHEN budgeted_amount_kes = 0 THEN 0
    ELSE ROUND(((COALESCE(actual_amount_kes, 0) - budgeted_amount_kes) / budgeted_amount_kes) * 100, 2)
    END
  ) STORED,
  status            TEXT NOT NULL DEFAULT 'pending_auth'
                    CHECK (status IN (
                      'pending_auth',
                      'confirmed',
                      'under_review',
                      'modified',
                      'voided',
                      'carried_forward'
                    )),
  confirmed_by      UUID REFERENCES users(id),
  confirmed_at      TIMESTAMPTZ,
  modified_reason   TEXT,
  void_reason       TEXT,
  voided_by         UUID REFERENCES users(id),
  voided_at         TIMESTAMPTZ,
  carry_from_month  TEXT,
  carry_reason      TEXT,
  expense_id        UUID REFERENCES expenses(id),
  review_notes      TEXT,
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_expenses_month
  ON pending_expenses (year_month);
CREATE INDEX IF NOT EXISTS idx_pending_expenses_project
  ON pending_expenses (project_id, year_month);
CREATE INDEX IF NOT EXISTS idx_pending_expenses_status
  ON pending_expenses (status);
CREATE INDEX IF NOT EXISTS idx_pending_expenses_budget_item
  ON pending_expenses (budget_item_id);

-- 2. Create expense_variances table (monthly aggregated variance tracking)
CREATE TABLE IF NOT EXISTS expense_variances (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month        TEXT NOT NULL,
  project_id        UUID REFERENCES projects(id),
  department_id     UUID REFERENCES departments(id),
  category          TEXT,
  budgeted_total_kes  NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_total_kes    NUMERIC(12,2) NOT NULL DEFAULT 0,
  variance_kes        NUMERIC(12,2) GENERATED ALWAYS AS (
    actual_total_kes - budgeted_total_kes
  ) STORED,
  variance_pct        NUMERIC(8,2) GENERATED ALWAYS AS (
    CASE WHEN budgeted_total_kes = 0 THEN 0
    ELSE ROUND(((actual_total_kes - budgeted_total_kes) / budgeted_total_kes) * 100, 2)
    END
  ) STORED,
  confirmed_count   INTEGER DEFAULT 0,
  pending_count     INTEGER DEFAULT 0,
  voided_count      INTEGER DEFAULT 0,
  modified_count    INTEGER DEFAULT 0,
  accuracy_score    NUMERIC(5,2),
  computed_at       TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_variances_unique
  ON expense_variances (year_month, COALESCE(project_id::text, ''), COALESCE(department_id::text, ''), COALESCE(category, ''));
CREATE INDEX IF NOT EXISTS idx_expense_variances_month
  ON expense_variances (year_month);

-- 3. RLS for pending_expenses
ALTER TABLE pending_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_for_authenticated_pending_expenses"
  ON pending_expenses FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_pending_expenses"
  ON pending_expenses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. RLS for expense_variances
ALTER TABLE expense_variances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_for_authenticated_expense_variances"
  ON expense_variances FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access_expense_variances"
  ON expense_variances FOR ALL TO service_role
  USING (true) WITH CHECK (true);
