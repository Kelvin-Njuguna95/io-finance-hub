import type { SupabaseClient } from '@supabase/supabase-js';

export async function getMiscDrawsByProjectAndPeriod(supabase: SupabaseClient, projectId: string, periodDate: string) {
  return supabase
    .from('misc_draws')
    .select('id, draw_type, amount_approved, status, project_id, period_month')
    .eq('project_id', projectId)
    .eq('period_month', periodDate);
}

export async function getPendingPmMiscDrawsByProjectAndPeriod(supabase: SupabaseClient, projectId: string, periodDate: string) {
  return supabase
    .from('misc_draws')
    .select('id, amount_approved, status')
    .eq('project_id', projectId)
    .eq('period_month', periodDate)
    .eq('status', 'pending_pm_approval');
}

export async function getMiscReportByProjectAndPeriod(supabase: SupabaseClient, projectId: string, periodMonth: string) {
  return supabase
    .from('misc_reports')
    .select('*')
    .eq('project_id', projectId)
    .eq('period_month', periodMonth)
    .single();
}
