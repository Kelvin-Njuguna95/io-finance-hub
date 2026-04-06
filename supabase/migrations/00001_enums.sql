-- ============================================================
-- IO Finance Hub — Enum Types
-- ============================================================

-- User roles
CREATE TYPE user_role AS ENUM (
  'cfo',
  'accountant',
  'team_leader',
  'project_manager'
);

-- The 5 originating directors (controlled, not free text)
CREATE TYPE director_enum AS ENUM (
  'kelvin',
  'evans',
  'dan',
  'gidraph',
  'victor'
);

-- Budget lifecycle
CREATE TYPE budget_status AS ENUM (
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected'
);

-- Expense classification
CREATE TYPE expense_type AS ENUM (
  'project_expense',
  'shared_expense'
);

-- Overhead allocation method
CREATE TYPE allocation_method AS ENUM (
  'revenue_based',
  'headcount_based',
  'hybrid'
);

-- Month closure lifecycle
CREATE TYPE month_status AS ENUM (
  'open',
  'under_review',
  'closed',
  'locked'
);

-- Profit share approval status
CREATE TYPE profit_share_status AS ENUM (
  'pending_review',
  'approved',
  'disputed'
);

-- Invoice status
CREATE TYPE invoice_status AS ENUM (
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled'
);

-- Red flag severity
CREATE TYPE red_flag_severity AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

-- Red flag type
CREATE TYPE red_flag_type AS ENUM (
  'budget_pending_approval',
  'overspending',
  'expense_not_linked',
  'expense_spike',
  'withdrawal_exceeds_budget',
  'missing_forex',
  'forex_mismatch',
  'missing_expense_classification',
  'profit_share_before_closure',
  'invoice_overdue',
  'missing_agent_counts'
);

-- Currency
CREATE TYPE currency_code AS ENUM (
  'USD',
  'KES'
);
