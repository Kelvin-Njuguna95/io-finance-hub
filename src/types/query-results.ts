export interface InvoiceWithPayments {
  id: string;
  invoice_number: string;
  project_id: string;
  invoice_date: string;
  due_date: string | null;
  billing_period: string;
  amount_usd: number;
  amount_kes?: number | null;
  status: string;
  description?: string | null;
  projects?: { name?: string | null } | null;
  payments?: { id?: string; amount_usd?: number | null; payment_date?: string | null; payment_method?: string | null; reference?: string | null }[];
}

export interface ExpenseRecord {
  id: string;
  budget_id?: string | null;
  project_id?: string | null;
  amount_kes: number;
  year_month: string;
  expense_date?: string | null;
  lifecycle_status?: string | null;
}
