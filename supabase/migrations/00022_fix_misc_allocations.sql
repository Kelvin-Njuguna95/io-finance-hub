-- Fix misc_allocations: add period_month support, constraints, and baseline RLS.

-- 1) Add missing period_month column.
ALTER TABLE misc_allocations
  ADD COLUMN IF NOT EXISTS period_month TEXT;

-- 2) Backfill existing rows using created_at month.
UPDATE misc_allocations
SET period_month = to_char(created_at, 'YYYY-MM')
WHERE period_month IS NULL;

-- 3) Enforce NOT NULL.
ALTER TABLE misc_allocations
  ALTER COLUMN period_month SET NOT NULL;

-- 4) Enforce one allocation row per project per month.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_misc_alloc_project_month'
  ) THEN
    ALTER TABLE misc_allocations
      ADD CONSTRAINT uq_misc_alloc_project_month UNIQUE (project_id, period_month);
  END IF;
END $$;

-- 5) Index for project+month lookups.
CREATE INDEX IF NOT EXISTS idx_misc_alloc_project_month
  ON misc_allocations(project_id, period_month);

-- 6) RLS baseline policies.
ALTER TABLE misc_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'misc_allocations'
      AND policyname = 'Users can view misc allocations'
  ) THEN
    CREATE POLICY "Users can view misc allocations"
      ON misc_allocations FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'misc_allocations'
      AND policyname = 'Users can create misc allocations'
  ) THEN
    CREATE POLICY "Users can create misc allocations"
      ON misc_allocations FOR INSERT TO authenticated WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'misc_allocations'
      AND policyname = 'Users can update misc allocations'
  ) THEN
    CREATE POLICY "Users can update misc allocations"
      ON misc_allocations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'misc_allocations'
      AND policyname = 'Service role full access misc allocations'
  ) THEN
    CREATE POLICY "Service role full access misc allocations"
      ON misc_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
