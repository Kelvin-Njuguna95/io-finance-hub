-- ============================================================
-- Appendix K: PM Misc Autonomy — Schema Changes
-- Run this in the Supabase Dashboard SQL Editor
-- ============================================================

-- 1. Create misc_draws table
CREATE TABLE IF NOT EXISTS misc_draws (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  pm_user_id        UUID NOT NULL REFERENCES users(id),
  period_month      DATE NOT NULL,
  draw_type         TEXT NOT NULL CHECK (draw_type IN ('standing', 'top_up')),
  amount_requested  NUMERIC(12,2) NOT NULL CHECK (amount_requested > 0),
  amount_approved   NUMERIC(12,2) NOT NULL,
  purpose           TEXT NOT NULL,
  draw_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'accounted', 'flagged')),
  cfo_flagged       BOOLEAN DEFAULT FALSE,
  cfo_flag_reason   TEXT,
  cfo_flagged_by    UUID REFERENCES users(id),
  cfo_flagged_at    TIMESTAMPTZ,
  expense_id        UUID REFERENCES expenses(id),
  accountant_notified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_misc_draws_project_month
  ON misc_draws (project_id, period_month);
CREATE INDEX IF NOT EXISTS idx_misc_draws_pm_user
  ON misc_draws (pm_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_misc_draws_one_standing_per_month
  ON misc_draws (project_id, period_month)
  WHERE draw_type = 'standing';

-- 2. Add columns to misc_reports
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  total_drawn NUMERIC(12,2) DEFAULT 0;
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  standing_allocation_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  top_up_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  draw_count INTEGER DEFAULT 0;
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  accountant_recorded_at TIMESTAMPTZ;
ALTER TABLE misc_reports ADD COLUMN IF NOT EXISTS
  variance_explanation TEXT;

-- 3. Add draw linkage to misc_report_items
ALTER TABLE misc_report_items ADD COLUMN IF NOT EXISTS
  misc_draw_id UUID;

-- 4. RLS for misc_draws
ALTER TABLE misc_draws ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_for_authenticated"
  ON misc_draws FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_full_access"
  ON misc_draws FOR ALL TO service_role
  USING (true) WITH CHECK (true);
