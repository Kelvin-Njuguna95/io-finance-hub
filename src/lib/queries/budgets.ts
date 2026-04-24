import type { SupabaseClient } from '@supabase/supabase-js';

export async function getBudgetsByMonth(supabase: SupabaseClient, yearMonth: string) {
  return supabase
    .from('budgets')
    .select('id, year_month, current_version, project_id, department_id, created_by, submitted_by_role, projects(name), departments(name), budget_versions(status, total_amount_usd, total_amount_kes, version_number, submitted_at)')
    .eq('year_month', yearMonth)
    .order('created_at', { ascending: false });
}

export async function getPmReviewQueueCount(supabase: SupabaseClient, projectIds?: string[]) {
  let query = supabase
    .from('budget_versions')
    .select('id, budget_id, budgets(project_id)', { count: 'exact', head: true })
    .eq('status', 'pm_review');

  if (projectIds && projectIds.length > 0) {
    query = query.in('budgets.project_id', projectIds);
  }

  return query;
}
