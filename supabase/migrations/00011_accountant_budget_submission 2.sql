-- ============================================================
-- Migration 00011: Accountant Budget Submission Rights (Appendix Q)
-- Grants accountant ability to submit project budgets
-- ============================================================

-- 1. Add submitted_by_role column to budgets table
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS
  submitted_by_role TEXT DEFAULT 'team_leader'
  CHECK (submitted_by_role IN ('team_leader', 'accountant', 'project_manager', 'cfo', 'department_head'));

-- 2. Extend budgets INSERT policy to allow accountant
DROP POLICY IF EXISTS budgets_insert ON budgets;
CREATE POLICY budgets_insert ON budgets FOR INSERT WITH CHECK (
  is_cfo() OR
  (get_user_role() = 'team_leader' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
  (get_user_role() = 'project_manager' AND department_id IS NOT NULL AND has_department_access(department_id)) OR
  (get_user_role() = 'accountant' AND project_id IS NOT NULL)
);

-- 3. Extend budget_versions INSERT policy for accountant
DROP POLICY IF EXISTS bv_insert ON budget_versions;
CREATE POLICY bv_insert ON budget_versions FOR INSERT WITH CHECK (
  is_cfo() OR
  EXISTS (
    SELECT 1 FROM budgets b WHERE b.id = budget_id AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id)) OR
      (get_user_role() = 'accountant' AND b.project_id IS NOT NULL)
    )
  )
);

-- 4. Extend budget_items INSERT policy for accountant
-- (already includes is_accountant() — no change needed)

-- 5. Add budget_items DELETE policy (was missing entirely)
CREATE POLICY bi_delete ON budget_items FOR DELETE USING (
  is_cfo() OR
  EXISTS (
    SELECT 1 FROM budget_versions bv
    JOIN budgets b ON b.id = bv.budget_id
    WHERE bv.id = budget_version_id AND bv.status = 'draft' AND (
      (get_user_role() = 'team_leader' AND b.project_id IS NOT NULL AND has_project_access(b.project_id)) OR
      (get_user_role() = 'project_manager' AND b.department_id IS NOT NULL AND has_department_access(b.department_id)) OR
      (get_user_role() = 'accountant' AND b.created_by = auth.uid())
    )
  )
);

-- Note: Existing SELECT and UPDATE policies for budgets, budget_versions,
-- and budget_items already include is_accountant() checks.
-- The budget_withdrawal_log and audit_logs are handled via API routes (admin client).
