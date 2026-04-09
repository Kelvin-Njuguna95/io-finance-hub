import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  const body = await request.json();
  const { budget_id } = body;
  if (!budget_id) return NextResponse.json({ error: 'budget_id required' }, { status: 400 });

  // Get the budget and its current version
  const { data: budget } = await admin.from('budgets').select('*, budget_versions(*)').eq('id', budget_id).single();
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

  // Month lock enforcement
  const monthErr = await assertMonthOpen(admin, budget.year_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

  // Verify ownership
  if (profile.role === 'team_leader') {
    const { data: assignment } = await admin
      .from('user_project_assignments')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', budget.project_id)
      .single();
    if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
  } else if (profile.role === 'accountant') {
    // Accountant can only withdraw their own accountant-submitted budgets
    if (budget.created_by !== user.id || budget.submitted_by_role !== 'accountant') {
      return NextResponse.json({ error: 'Can only withdraw your own budget submissions' }, { status: 403 });
    }
  } else if (profile.role !== 'cfo') {
    return NextResponse.json({ error: 'Only TL, Accountant, or CFO can withdraw budgets' }, { status: 403 });
  }

  // Find current version
  const currentVersion = (budget.budget_versions || []).find(
    (v: any) => v.version_number === budget.current_version
  );
  if (!currentVersion) return NextResponse.json({ error: 'No current version found' }, { status: 400 });

  // Validate status — can withdraw from 'submitted' or 'pm_review' (if PM hasn't opened it)
  if (currentVersion.status === 'pm_review' && budget.pm_review_opened_at) {
    return NextResponse.json({
      error: 'PM has already opened this budget for review. Recall is no longer available.'
    }, { status: 400 });
  }
  if (!['submitted', 'pm_review'].includes(currentVersion.status)) {
    return NextResponse.json({
      error: `Cannot withdraw a budget with status '${currentVersion.status}'.`
    }, { status: 400 });
  }

  // Check withdrawal limit for TLs
  if (profile.role === 'team_leader') {
    const { data: limitSetting } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'tl_max_budget_withdrawals_per_month')
      .single();
    const maxWithdrawals = parseInt(limitSetting?.value || '3');

    const yearMonth = budget.year_month;
    const { count } = await admin
      .from('budget_withdrawal_log')
      .select('id', { count: 'exact', head: true })
      .eq('withdrawn_by', user.id)
      .eq('year_month', yearMonth);

    if ((count || 0) >= maxWithdrawals) {
      // Create red flag
      await admin.from('red_flags').insert({
        flag_type: 'expense_spike',
        severity: 'high',
        title: `${profile.full_name} has withdrawn ${count} budgets this month`,
        description: `Team Leader ${profile.full_name} has exceeded the withdrawal limit for ${yearMonth}. Further withdrawals are blocked.`,
        project_id: budget.project_id,
        year_month: yearMonth,
      });
      return NextResponse.json({
        error: `Withdrawal limit reached (${maxWithdrawals} per month). Contact your CFO.`
      }, { status: 400 });
    }
  }

  // Perform withdrawal — set status back to draft and clear PM review
  await admin.from('budget_versions').update({ status: 'draft' }).eq('id', currentVersion.id);
  await admin.from('budgets').update({ pm_review_opened_at: null, pm_reviewer_id: null }).eq('id', budget_id);

  // Log withdrawal
  await admin.from('budget_withdrawal_log').insert({
    budget_id,
    withdrawn_by: user.id,
    year_month: budget.year_month,
  });

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'budget_withdrawn',
    table_name: 'budget_versions',
    record_id: currentVersion.id,
    old_values: { status: 'submitted' },
    new_values: { status: 'draft' },
    reason: profile.role === 'accountant' ? 'Accountant withdrew budget back to draft' : 'TL withdrew budget back to draft',
  });

    return NextResponse.json({ success: true, message: 'Budget withdrawn to draft' });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to withdraw budget.', 'BUDGET_WITHDRAW_ERROR');
  }
}
