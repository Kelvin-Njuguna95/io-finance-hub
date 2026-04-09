import type { SupabaseClient } from '@supabase/supabase-js';

export async function getConfirmedExpensesByMonth(supabase: SupabaseClient, yearMonth: string) {
  return supabase
    .from('expenses')
    .select('id, budget_id, project_id, department_id, amount_kes, year_month, expense_date')
    .eq('year_month', yearMonth);
}

export async function getPendingExpensesByMonth(supabase: SupabaseClient, yearMonth: string) {
  return supabase
    .from('pending_expenses')
    .select('*, projects(name), departments(name)')
    .eq('year_month', yearMonth)
    .order('created_at');
}
