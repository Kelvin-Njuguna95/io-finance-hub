import type { SupabaseClient } from '@supabase/supabase-js';

interface ConfirmedExpenseQueryRow {
  amount_kes: number | null;
  budgets: Array<{ project_id: string | null }> | null;
}

export async function getConfirmedExpensesByMonth(supabase: SupabaseClient, yearMonth: string) {
  const response = await supabase
    .from('expenses')
    .select('amount_kes, budgets(project_id)')
    .eq('year_month', yearMonth)
    .eq('lifecycle_status', 'confirmed');

  if (response.error || !response.data) {
    return response;
  }

  const data = (response.data as ConfirmedExpenseQueryRow[]).map((row) => ({
    amount_kes: Number(row.amount_kes || 0),
    project_id: row.budgets?.[0]?.project_id ?? null,
  }));

  return {
    ...response,
    data,
  };
}

export async function getPendingExpensesByMonth(supabase: SupabaseClient, yearMonth: string) {
  return supabase
    .from('pending_expenses')
    .select('*, projects(name), departments(name)')
    .eq('year_month', yearMonth)
    .order('created_at');
}
