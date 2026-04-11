-- Fix submitted_by_role constraint to include all valid roles
ALTER TABLE budgets
  DROP CONSTRAINT IF EXISTS budgets_submitted_by_role_check;

ALTER TABLE budgets
  ADD CONSTRAINT budgets_submitted_by_role_check
  CHECK (submitted_by_role IN (
    'team_leader',
    'accountant',
    'project_manager',
    'cfo',
    'department_head'
  ));
