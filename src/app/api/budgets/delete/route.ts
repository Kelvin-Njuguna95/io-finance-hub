import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const auth = await getAuthUserProfile(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  const { user, profile, admin } = auth;

  // CFO, TL, PM, and Accountant (own drafts only) can delete
  if (!['cfo', 'team_leader', 'project_manager', 'accountant'].includes(profile.role)) {
    return NextResponse.json({ error: 'Not authorized to delete budgets' }, { status: 403 });
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

  // Verify ownership for non-CFO
  if (profile.role === 'accountant') {
    // Accountant can only delete their own budget submissions
    if (budget.created_by !== user.id) {
      return NextResponse.json({ error: 'Can only delete your own budget submissions' }, { status: 403 });
    }
  } else if (profile.role !== 'cfo' && budget.project_id) {
    const { data: assignment } = await admin
      .from('user_project_assignments')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', budget.project_id)
      .single();
    if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
  }

  // Check status — only draft budgets can be deleted
  const versions = (budget as any).budget_versions || [];
  const currentVersion = versions.find((v: any) => v.version_number === budget.current_version);
  const currentStatus = currentVersion?.status ?? 'draft';

  if (currentStatus !== 'draft') {
    return NextResponse.json({
      error: `Cannot delete a budget with status '${currentStatus}'. Only draft budgets can be deleted.`
    }, { status: 400 });
  }

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
  };

  // Delete: withdrawal logs → items → approvals → versions → budget
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

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'budget_deleted',
    table_name: 'budgets',
    record_id: budget_id,
    old_values: snapshot,
    new_values: null,
    reason: `${profile.full_name} permanently deleted draft budget`,
  });

  return NextResponse.json({ success: true, message: 'Budget deleted permanently' });
}
