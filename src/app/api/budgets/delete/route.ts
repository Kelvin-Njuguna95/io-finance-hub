import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  // CFO only
  if (profile.role !== 'cfo') {
    return NextResponse.json({ error: 'Only CFO can delete budgets' }, { status: 403 });
  }

  const body = await request.json();
  const { budget_id } = body;
  if (!budget_id) return NextResponse.json({ error: 'budget_id required' }, { status: 400 });

  // Get the budget with versions
  const { data: budget, error: fetchError } = await admin
    .from('budgets')
    .select('*, budget_versions(*)')
    .eq('id', budget_id)
    .single();

  if (fetchError || !budget) {
    return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
  }

  // Month lock enforcement
  const monthErr = await assertMonthOpen(admin, budget.year_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

  // Check status
  const versions = (budget as /* // */ any).budget_versions || [];
  const currentVersion = versions.find((v: /* // */ any) => v.version_number === budget.current_version);
  const currentStatus = currentVersion?.status ?? 'draft';

  // Check if any expenses are linked to this budget (prevent orphans)
  const { count: expenseCount } = await admin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('budget_id', budget_id);

  if ((expenseCount || 0) > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${expenseCount} expense(s) are linked to this budget. Remove them first.`
    }, { status: 400 });
  }

  // Also load pending expense count (auto-generated queue rows)
  const { count: pendingCount } = await admin
    .from('pending_expenses')
    .select('id', { count: 'exact', head: true })
    .eq('budget_id', budget_id);

  // Get project name for audit
  let projectName = '—';
  if (budget.project_id) {
    const { data: project } = await admin.from('projects').select('name').eq('id', budget.project_id).single();
    projectName = project?.name || '—';
  } else if (budget.department_id) {
    const { data: dept } = await admin.from('departments').select('name').eq('id', budget.department_id).single();
    projectName = dept?.name || '—';
  }

  // Snapshot for audit (safe access)
  const snapshot = {
    project: projectName,
    year_month: budget.year_month,
    total_amount_kes: currentVersion?.total_amount_kes || 0,
    version_count: versions.length,
    status: currentStatus,
    pending_expense_count: pendingCount || 0,
  };

  // Audit log must succeed BEFORE delete.
  const { error: auditError } = await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'budget_deleted',
    table_name: 'budgets',
    record_id: budget_id,
    old_values: snapshot,
    new_values: null,
    reason: `${profile.full_name} permanently deleted ${currentStatus} budget`,
  });
  if (auditError) {
    return NextResponse.json({ error: `Audit log failed: ${auditError.message}` }, { status: 500 });
  }

  // Delete in FK-safe order:
  // pending_expenses -> withdrawal logs -> items/approvals -> versions -> budget
  await admin.from('pending_expenses').delete().eq('budget_id', budget_id);
  await admin.from('budget_withdrawal_log').delete().eq('budget_id', budget_id);
  for (const v of versions) {
    await admin.from('budget_items').delete().eq('budget_version_id', v.id);
    await admin.from('budget_approvals').delete().eq('budget_version_id', v.id);
  }
  await admin.from('budget_versions').delete().eq('budget_id', budget_id);

  const { error: deleteError } = await admin.from('budgets').delete().eq('id', budget_id);

  if (deleteError) {
    return NextResponse.json({ error: `Delete failed: ${deleteError.message}` }, { status: 500 });
  }

    return NextResponse.json({ success: true, message: 'Budget deleted permanently' });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to delete budget.', 'BUDGET_DELETE_ERROR');
  }
}
