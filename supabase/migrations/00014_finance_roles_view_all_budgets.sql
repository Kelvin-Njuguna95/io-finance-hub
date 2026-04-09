-- ============================================================
-- Migration 00014: Finance roles can view all budgets
--
-- Ensures decision makers can view both project and department budgets,
-- including rows where department_id IS NOT NULL.
-- ============================================================

DROP POLICY IF EXISTS "Finance roles can view all budgets" ON public.budgets;
CREATE POLICY "Finance roles can view all budgets"
ON public.budgets FOR SELECT
USING (
  auth.uid() IN (
    SELECT id
    FROM public.users
    WHERE role IN ('cfo', 'accountant', 'project_manager', 'finance_manager')
      AND is_active = true
  )
);
