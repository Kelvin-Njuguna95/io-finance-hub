// ============================================================
// IO Finance Hub — Database Types
// ============================================================

export type UserRole = 'cfo' | 'accountant' | 'team_leader' | 'project_manager' | 'department_head';
export type DirectorEnum = 'kelvin' | 'evans' | 'dan' | 'gidraph' | 'victor';
export type BudgetStatus = 'draft' | 'submitted' | 'under_review' | 'pm_review' | 'pm_approved' | 'pm_rejected' | 'returned_to_tl' | 'approved' | 'rejected';
export type ExpenseType = 'project_expense' | 'shared_expense';
export type AllocationMethod = 'revenue_based' | 'headcount_based' | 'hybrid';
export type MonthStatus = 'open' | 'under_review' | 'closed' | 'locked';
export type ProfitShareStatus = 'pending_review' | 'approved' | 'disputed';
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type RedFlagSeverity = 'low' | 'medium' | 'high' | 'critical';
export type CurrencyCode = 'USD' | 'KES';
export type WithdrawalType = 'operations' | 'director_payout';
export type PayoutType = 'full' | 'partial';
export type PayoutStatus = 'unpaid' | 'partial' | 'paid';

export const DIRECTORS: { value: DirectorEnum; label: string }[] = [
  { value: 'kelvin', label: 'Kelvin' },
  { value: 'evans', label: 'Evans' },
  { value: 'dan', label: 'Dan' },
  { value: 'gidraph', label: 'Gidraph' },
  { value: 'victor', label: 'Victor' },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  cfo: 'CFO',
  accountant: 'Accountant',
  team_leader: 'Team Leader',
  project_manager: 'Project Manager',
  department_head: 'Department Head',
};

// -----------------------------------------------
// Table Row Types
// -----------------------------------------------

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  director_tag: DirectorEnum | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  client_name: string;
  director_user_id: string;
  director_tag: DirectorEnum;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentCount {
  id: string;
  project_id: string;
  year_month: string;
  agent_count: number;
  entered_by: string;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface Budget {
  id: string;
  project_id: string | null;
  department_id: string | null;
  year_month: string;
  current_version: number;
  created_by: string;
  submitted_by_role: 'team_leader' | 'accountant' | 'project_manager' | 'cfo' | 'department_head' | null;
  pm_review_opened_at?: string | null;
  pm_reviewer_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetVersion {
  id: string;
  budget_id: string;
  version_number: number;
  status: BudgetStatus;
  total_amount_usd: number;
  total_amount_kes: number;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetItem {
  id: string;
  budget_version_id: string;
  description: string;
  category: string | null;
  amount_usd: number;
  amount_kes: number;
  quantity: number;
  unit_cost_usd: number | null;
  unit_cost_kes: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetApproval {
  id: string;
  budget_version_id: string;
  action: 'approved' | 'rejected';
  approved_by: string;
  reason: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  budget_id: string;
  budget_version_id: string;
  expense_type: ExpenseType;
  project_id: string | null;
  overhead_category_id: string | null;
  expense_category_id: string | null;
  description: string;
  amount_usd: number;
  amount_kes: number;
  expense_date: string;
  year_month: string;
  vendor: string | null;
  receipt_reference: string | null;
  notes: string | null;
  entered_by: string;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  project_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  billing_period: string;
  amount_usd: number;
  amount_kes: number;
  status: InvoiceStatus;
  description: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount_usd: number;
  amount_kes: number;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

export interface Withdrawal {
  id: string;
  withdrawal_date: string;
  withdrawal_type: WithdrawalType;
  director_tag: DirectorEnum;
  director_user_id: string;
  director_name: string | null;
  profit_share_record_id: string | null;
  payout_type: PayoutType | null;
  partial_payout_sequence: number | null;
  amount_usd: number;
  exchange_rate: number;
  amount_kes: number;
  forex_bureau: string | null;
  reference_id: string | null;
  reference_rate: number | null;
  variance_kes: number | null;
  year_month: string;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

export interface OverheadAllocation {
  id: string;
  project_id: string;
  year_month: string;
  allocation_method: AllocationMethod;
  revenue_share_pct: number;
  headcount_share_pct: number;
  final_share_pct: number;
  allocated_amount_usd: number;
  allocated_amount_kes: number;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectProfitability {
  id: string;
  project_id: string;
  year_month: string;
  revenue_usd: number;
  revenue_kes: number;
  direct_expenses_usd: number;
  direct_expenses_kes: number;
  allocated_overhead_usd: number;
  allocated_overhead_kes: number;
  gross_profit_usd: number;
  gross_profit_kes: number;
  distributable_profit_usd: number;
  distributable_profit_kes: number;
  margin_pct: number;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfitShareRecord {
  id: string;
  project_id: string;
  year_month: string;
  director_tag: DirectorEnum;
  director_user_id: string;
  distributable_profit_usd: number;
  distributable_profit_kes: number;
  director_share_usd: number;
  director_share_kes: number;
  company_share_usd: number;
  company_share_kes: number;
  status: ProfitShareStatus;
  approved_by: string | null;
  approved_at: string | null;
  dispute_reason: string | null;
  adjustment_notes: string | null;
  is_locked: boolean;
  total_paid_out: number | null;
  balance_remaining: number | null;
  payout_status: PayoutStatus | null;
  last_payout_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyFinancialSnapshot {
  id: string;
  year_month: string;
  total_revenue_usd: number;
  total_revenue_kes: number;
  total_direct_costs_usd: number;
  total_direct_costs_kes: number;
  gross_profit_usd: number;
  gross_profit_kes: number;
  total_shared_overhead_usd: number;
  total_shared_overhead_kes: number;
  operating_profit_usd: number;
  operating_profit_kes: number;
  forex_gain_loss_kes: number;
  net_profit_usd: number;
  net_profit_kes: number;
  total_agents: number;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface RedFlag {
  id: string;
  flag_type: string;
  severity: RedFlagSeverity;
  title: string;
  description: string | null;
  project_id: string | null;
  year_month: string | null;
  reference_id: string | null;
  reference_table: string | null;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolved_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface MonthClosure {
  id: string;
  year_month: string;
  status: MonthStatus;
  warnings_acknowledged: unknown[];
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OverheadCategory {
  id: string;
  name: string;
  description: string | null;
  default_allocation_method: AllocationMethod;
  is_active: boolean;
  created_at: string;
}

export type PendingExpenseStatus = 'pending_auth' | 'confirmed' | 'under_review' | 'modified' | 'voided' | 'carried_forward';

export interface PendingExpense {
  id: string;
  budget_id: string;
  budget_version_id: string;
  budget_item_id: string;
  project_id: string | null;
  department_id: string | null;
  year_month: string;
  description: string;
  category: string | null;
  budgeted_amount_kes: number;
  actual_amount_kes: number | null;
  variance_kes: number | null;
  variance_pct: number | null;
  status: PendingExpenseStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  modified_reason: string | null;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  carry_from_month: string | null;
  carry_reason: string | null;
  expense_id: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseVariance {
  id: string;
  year_month: string;
  project_id: string | null;
  department_id: string | null;
  category: string | null;
  budgeted_total_kes: number;
  actual_total_kes: number;
  variance_kes: number;
  variance_pct: number;
  confirmed_count: number;
  pending_count: number;
  voided_count: number;
  modified_count: number;
  accuracy_score: number | null;
  computed_at: string;
  created_at: string;
}

export interface AllocationRule {
  id: string;
  year_month: string;
  method: AllocationMethod;
  revenue_weight: number;
  headcount_weight: number;
  set_by: string;
  created_at: string;
}
