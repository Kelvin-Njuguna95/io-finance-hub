import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfirmedExpensesByMonth } from './expenses';
import { getOutstandingInvoices } from './invoices';

export async function getCoreFinancialInputs(supabase: SupabaseClient, yearMonth: string) {
  const [expenseRes, outstandingRes] = await Promise.all([
    getConfirmedExpensesByMonth(supabase, yearMonth),
    getOutstandingInvoices(supabase),
  ]);

  return { expenseRes, outstandingRes };
}
