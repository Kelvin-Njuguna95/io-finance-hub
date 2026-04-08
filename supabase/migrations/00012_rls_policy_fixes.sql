-- ============================================================
-- Migration 00012: RLS Policy Repair
--
-- Context:
--   Migration 00011 added the submitted_by_role column successfully,
--   but the RLS policy DROP/CREATE statements partially failed in
--   production. This left the budgets and budget_versions INSERT
--   policies missing the accountant role, and the budget_items
--   DELETE policy potentially uncreated.
--
--   As a workaround, budget creation was moved to a server-side
--   API route (api/budgets/create) using the admin client.
--   This migration repairs the RLS policies so that direct
--   client-side operations also work correctly for accountants.
--
-- Approach:
--   DROP IF EXISTS + CREATE for each affected policy.
--   This is safe regardless of current state:
--   - If the old policy (from 00003) survived → we replace it
--   - If 00011 partially created it → we replace it
--   - If the policy is missing entirely → we create it
--
-- Tables affected: budgets, budget_versions, budget_items
-- Policies affected: budgets_insert, bv_insert, bi_delete
-- ============================================================

-- -----------------------------------------------
-- 1. REPAIR: budgets INSERT policy
--
-- Original (00003): allowed cfo, team_leader, project_manager
-- Target   (00011): adds accountant for project-scoped budgets
-- -----------------------------------------------

DROP POLICY IF EXISTS budgets_insert ON budgets;
CREATE POLICY budgets_insert ON budgets FOR INSERT WITH CHECK (
  is_cfo() OR
  (get_user_role() = 'team_leader' AND project_id IS NOT NULL AND has_project_access(project_id)) OR
  (get_user_role() = 'project_manager' AND department_id IS NOT NULL AND has_department_access(department_id)) OR
  (get_user_role() = 'accountant' AND project_id IS NOT NULL)
);

-- -----------------------------------------------
-- 2. REPAIR: budget_versions INSERT policy
--
-- Original (00003): allowed cfo, team_leader, project_manager
-- Target   (00011): adds accountant for project-linked budgets
-- -----------------------------------------------

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

-- -----------------------------------------------
-- 3. REPAIR: budget_items DELETE policy
--
-- This policy was entirely missing before 00011.
-- 00011 attempted to CREATE it but may have failed.
-- Allows deletion of items in draft budgets only.
-- -----------------------------------------------

DROP POLICY IF EXISTS bi_delete ON budget_items;
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

-- -----------------------------------------------
-- VERIFICATION NOTES
--
-- The following policies already include accountant access
-- and do NOT need repair:
--
--   budgets_select   → has is_accountant()  (00003 line 141)
--   budgets_update   → has is_accountant()  (00003 line 153)
--   bv_select        → has is_accountant()  (00003 line 164)
--   bv_update        → has is_accountant()  (00003 line 184)
--   bi_select        → has is_accountant()  (00003 line 199)
--   bi_insert        → has is_accountant()  (00003 line 211)
--   bi_update        → has is_accountant()  (00003 line 223)
--
-- The submitted_by_role column (added by 00011) is confirmed
-- present in production — only the policy changes failed.
-- ============================================================
