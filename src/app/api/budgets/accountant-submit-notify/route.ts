import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  const body = await request.json();
  const { budget_id, project_id, project_name, year_month, total_kes, submitted_by_role, existing_tl_budget } = body;

  // Count existing budgets for this project/month
  const { count: budgetCount } = await admin
    .from('budgets')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project_id)
    .eq('year_month', year_month);

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: submitted_by_role === 'accountant' ? 'budget_submitted_by_accountant' : 'budget_submitted',
    table_name: 'budgets',
    record_id: budget_id,
    new_values: {
      project_id,
      period_month: year_month,
      total_amount: total_kes,
      submitted_by_role,
      tl_budget_exists: existing_tl_budget || false,
      version_number: 1,
    },
  });

  // Notify PM(s) for this project
  const { data: pmAssignments } = await admin
    .from('user_project_assignments')
    .select('user_id, users(role)')
    .eq('project_id', project_id);

  const pmUserIds = (pmAssignments || [])
    .filter((a: any) => a.users?.role === 'project_manager')
    .map((a: any) => a.user_id);

  // Also get any PM who is a director for this project
  const { data: project } = await admin.from('projects').select('director_user_id').eq('id', project_id).single();
  if (project?.director_user_id) {
    const { data: dirProfile } = await admin.from('users').select('role').eq('id', project.director_user_id).single();
    if (dirProfile?.role === 'project_manager' && !pmUserIds.includes(project.director_user_id)) {
      pmUserIds.push(project.director_user_id);
    }
  }

  const pendingLabel = (budgetCount || 0) > 1
    ? `${budgetCount} total budgets pending review.`
    : '';

  for (const pmId of pmUserIds) {
    await admin.from('notifications').insert({
      user_id: pmId,
      title: 'Budget Submitted by Accountant',
      message: `${profile.full_name} submitted a budget for ${project_name} ${year_month}. ${pendingLabel}`,
      link: `/budgets`,
    });
  }

  // Notify CFO (awareness)
  const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
  for (const cfo of cfos || []) {
    if (cfo.id === user.id) continue; // Don't notify self
    await admin.from('notifications').insert({
      user_id: cfo.id,
      title: 'Accountant Budget Submission',
      message: `${profile.full_name} submitted a project budget for ${project_name} ${year_month}.`,
      link: `/budgets`,
    });
  }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to send budget notifications.', 'BUDGET_NOTIFY_ERROR');
  }
}
