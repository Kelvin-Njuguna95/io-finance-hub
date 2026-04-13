import type { SupabaseClient } from '@supabase/supabase-js';
import { assertMonthOpen, createAdminClient } from '@/lib/supabase/admin';

type LifecycleActor = {
  id: string;
  role: string;
};

export type AutoPopulateParams = {
  budget_version_id?: string;
  budget_id?: string;
};

export type AutoPopulateResult = {
  success: boolean;
  status: number;
  error?: string;
  data?: any[];
  message?: string;
  misc_logged?: number;
};

function isMiscBudgetItem(item: { category?: string | null; description?: string | null }) {
  const category = (item.category || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  return category.includes('misc') || description.includes('misc');
}

async function autoLogBudgetMiscDraws(
  admin: SupabaseClient,
  actor: LifecycleActor,
  budget: any,
  budgetItems: any[],
) {
  if (!budget?.project_id || !budget?.year_month || !budgetItems.length) return 0;

  const miscItems = budgetItems
    .filter((item: any) => isMiscBudgetItem(item))
    .filter((item: any) => Number(item.pm_approved_amount != null ? item.pm_approved_amount : item.amount_kes) > 0);

  if (!miscItems.length) return 0;

  const { data: existingDraws } = await admin
    .from('misc_draws')
    .select('budget_item_id')
    .in('budget_item_id', miscItems.map((item: any) => item.id));
  const existing = new Set((existingDraws || []).map((d: any) => d.budget_item_id).filter(Boolean));

  const { data: assignment } = await admin
    .from('user_project_assignments')
    .select('user_id')
    .eq('project_id', budget.project_id)
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const rows = miscItems
    .filter((item: any) => !existing.has(item.id))
    .map((item: any) => {
      const amount = Number(item.pm_approved_amount != null ? item.pm_approved_amount : item.amount_kes);
      return {
        project_id: budget.project_id,
        period_month: `${budget.year_month}-01`,
        draw_type: 'top_up',
        amount_requested: amount,
        amount_approved: amount,
        purpose: `Budget-approved misc line: ${item.description}`,
        status: 'approved',
        budget_item_id: item.id,
        requested_by: assignment?.user_id || actor.id,
        pm_user_id: assignment?.user_id || null,
        raised_by: actor.id,
        raised_by_role: actor.role,
        pm_approval_status: 'approved',
        pm_approved_by: actor.id,
        pm_actioned_at: now,
        accountant_notes: 'Auto-created from approved budget miscellaneous line item.',
      };
    });

  if (!rows.length) return 0;
  const { data: inserted, error } = await admin.from('misc_draws').insert(rows).select('id');
  if (error) throw error;

  return inserted?.length || 0;
}

export async function autoPopulateExpenses(
  params: AutoPopulateParams,
  actor: LifecycleActor,
  adminClient?: SupabaseClient,
): Promise<AutoPopulateResult> {
  const admin = adminClient || createAdminClient();
  const { budget_version_id, budget_id } = params;

  if (!budget_version_id && !budget_id) {
    return { success: false, status: 400, error: 'budget_version_id or budget_id required' };
  }

  let budgetVersion: any = null;
  if (budget_version_id) {
    const { data } = await admin
      .from('budget_versions')
      .select('*, budget_items(*)')
      .eq('id', budget_version_id)
      .single();
    budgetVersion = data;
  } else {
    const { data } = await admin
      .from('budget_versions')
      .select('*, budget_items(*)')
      .eq('budget_id', budget_id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    budgetVersion = data;
  }

  if (!budgetVersion) {
    return { success: false, status: 404, error: 'Budget version not found' };
  }

  const { data: budget } = await admin
    .from('budgets')
    .select('*')
    .eq('id', budgetVersion.budget_id)
    .single();

  if (!budget) {
    return { success: false, status: 404, error: 'Budget not found' };
  }

  const monthErr = await assertMonthOpen(admin, budget.year_month);
  if (monthErr) return { success: false, status: monthErr.status, error: monthErr.message };

  const allItems = budgetVersion.budget_items || [];
  const hasPmLineReview = allItems.some((item: any) => ['approved', 'adjusted', 'removed'].includes(item.pm_status));
  const eligibleItems = hasPmLineReview
    ? allItems.filter((item: any) => ['approved', 'adjusted'].includes(item.pm_status))
    : allItems;

  if (eligibleItems.length === 0) {
    return { success: false, status: 400, error: 'No eligible budget items found' };
  }

  const existingItemIds = new Set<string>();
  const { data: existingPE } = await admin
    .from('pending_expenses')
    .select('budget_item_id')
    .eq('budget_id', budget.id);
  (existingPE || []).forEach((pe: any) => existingItemIds.add(pe.budget_item_id));

  const newItems = eligibleItems.filter((item: any) => !existingItemIds.has(item.id));
  if (newItems.length === 0) {
    return { success: true, status: 200, data: [], message: 'All items already populated' };
  }

  const pendingRows = newItems.map((item: any) => {
    const budgetedAmountKes = item.pm_status === 'adjusted'
      ? item.pm_approved_amount
      : item.amount_kes;

    return {
      budget_id: budget.id,
      budget_version_id: budgetVersion.id,
      budget_item_id: item.id,
      project_id: budget.project_id,
      department_id: budget.department_id,
      year_month: budget.year_month,
      description: item.description,
      category: item.category,
      budgeted_amount_kes: budgetedAmountKes,
      actual_amount_kes: null,
      status: 'pending_auth',
    };
  });

  const { data: inserted, error: insertErr } = await admin
    .from('pending_expenses')
    .insert(pendingRows)
    .select();

  if (insertErr) {
    return { success: false, status: 500, error: insertErr.message };
  }

  let miscLogged = 0;
  try {
    miscLogged = await autoLogBudgetMiscDraws(admin, actor, budget, newItems);
  } catch (miscErr: any) {
    console.error('Failed to auto-log misc items from budget:', miscErr?.message || miscErr);
  }

  return { success: true, status: 200, data: inserted || [], misc_logged: miscLogged };
}
