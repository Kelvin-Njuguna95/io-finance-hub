-- ============================================================
-- IO Finance Hub — Seed Data
-- ============================================================
-- NOTE: Run this AFTER creating auth users in Supabase dashboard.
-- Replace UUIDs below with actual auth.users UUIDs.

-- Example: Insert the 5 directors + 2 CFOs + accountant + team leaders
-- (Replace these placeholder UUIDs with real ones from your Supabase Auth setup)

/*
INSERT INTO users (id, email, full_name, role, director_tag) VALUES
  ('UUID_CFO_1', 'cfo1@impactoutsourcing.co.ke', 'Kelvin Mwangi', 'cfo', 'kelvin'),
  ('UUID_CFO_2', 'cfo2@impactoutsourcing.co.ke', 'Evans Ochieng', 'cfo', 'evans'),
  ('UUID_DIR_DAN', 'dan@impactoutsourcing.co.ke', 'Dan Kimani', 'team_leader', 'dan'),
  ('UUID_DIR_GIDRAPH', 'gidraph@impactoutsourcing.co.ke', 'Gidraph Wanjiru', 'team_leader', 'gidraph'),
  ('UUID_DIR_VICTOR', 'victor@impactoutsourcing.co.ke', 'Victor Otieno', 'team_leader', 'victor'),
  ('UUID_ACCOUNTANT', 'accountant@impactoutsourcing.co.ke', 'Jane Accountant', 'accountant', NULL),
  ('UUID_TL_1', 'tl1@impactoutsourcing.co.ke', 'Team Leader 1', 'team_leader', NULL),
  ('UUID_PM_1', 'pm1@impactoutsourcing.co.ke', 'Project Manager 1', 'project_manager', NULL);

-- Example projects
INSERT INTO projects (name, client_name, director_user_id, director_tag, description) VALUES
  ('Project Alpha', 'Client A', 'UUID_CFO_1', 'kelvin', 'Main outsourcing project for Client A'),
  ('Project Beta', 'Client B', 'UUID_CFO_2', 'evans', 'Support services for Client B'),
  ('Project Gamma', 'Client C', 'UUID_DIR_DAN', 'dan', 'Data entry project for Client C'),
  ('Project Delta', 'Client D', 'UUID_DIR_GIDRAPH', 'gidraph', 'Customer service for Client D'),
  ('Project Epsilon', 'Client E', 'UUID_DIR_VICTOR', 'victor', 'Technical support for Client E');

-- Example departments
INSERT INTO departments (name, owner_user_id) VALUES
  ('Human Resources', 'UUID_PM_1'),
  ('Operations', 'UUID_PM_1'),
  ('Finance', 'UUID_ACCOUNTANT');

-- Example overhead categories
INSERT INTO overhead_categories (name, description, default_allocation_method) VALUES
  ('Office Rent', 'Monthly office space rental', 'headcount_based'),
  ('Internet & Utilities', 'Internet, electricity, water', 'headcount_based'),
  ('Software Licenses', 'SaaS subscriptions and tools', 'revenue_based'),
  ('Management Overhead', 'Management team costs', 'hybrid'),
  ('Insurance', 'Business insurance premiums', 'revenue_based');

-- Example expense categories
INSERT INTO expense_categories (name, description) VALUES
  ('Salaries & Wages', 'Employee compensation'),
  ('Equipment', 'Hardware and office equipment'),
  ('Training', 'Staff training and development'),
  ('Travel', 'Business travel expenses'),
  ('Supplies', 'Office supplies and consumables'),
  ('Professional Services', 'Consulting and legal fees'),
  ('Marketing', 'Marketing and advertising');
*/
