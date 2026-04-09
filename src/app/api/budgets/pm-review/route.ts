import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const PM_ROLES = ['project_manager', 'cfo'] as const;

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  if (!PM_ROLES.includes(profile.role as (typeof PM_ROLES)[number])) {
    return NextResponse.json({ error: 'Only PMs can review TL budgets' }, { status: 403 });
  }

  const body = await request.json();
  const { budget_id, action, comments } = body;

  if (!budget_id || !action) return NextResponse.json({ error: 'budget_id and action required' }, { status: 400 });
  if (!['approve', 'return', 'reject'].includes(action)) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  // Get budget
  const { data: budget } = await admin.from('budgets').select('*, budget_versions(*)').eq('id', budget_id).single();
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

  // Month lock enforcement
  const monthErr = await assertMonthOpen(admin, (budget as any).year_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

  // Verify PM owns this project
  const { data: assignment } = await admin.from('user_project_assignments')
    .select('id').eq('user_id', user.id).eq('project_id', (budget as any).project_id).single();
  if (!assignment && profile?.role !== 'cfo') return NextResponse.json({ error: 'Not your project' }, { status: 403 });

  // Misc gate check — PM must have submitted previous month's misc report to approve
  if (action === 'approve' && profile?.role === 'project_manager') {
    const budgetMonth = (budget as any).year_month;
    const prevDate = new Date(parseInt(budgetMonth.split('-')[0]), parseInt(budgetMonth.split('-')[1]) - 2, 1);
    const prevMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

    const { data: gateSetting } = await admin.from('system_settings').select('value').eq('key', 'misc_gate_start_month').single();
    const gateStart = gateSetting?.value || '2026-04';

    if (prevMonth >= gateStart) {
      const { data: miscReport } = await admin.from('misc_reports')
        .select('status')
        .eq('project_id', (budget as any).project_id)
        .eq('period_month', prevMonth)
        .single();

      if (!miscReport || miscReport.status === 'draft') {
        return NextResponse.json({
          error: 'Cannot approve this budget. The misc expenditure report for ' + prevMonth + ' has not been submitted. Submit your misc report first.',
          gate: 'MISC_REPORT_GATE_BLOCKED',
          prev_month: prevMonth,
        }, { status: 422 });
      }
    }
  }

  // Get current version
  const versions = (budget as any).budget_versions || [];
  const currentVersion = versions.find((v: any) => v.version_number === (budget as any).current_version);
  if (!currentVersion) return NextResponse.json({ error: 'No current version' }, { status: 400 });

  if (currentVersion.status !== 'pm_review') {
    return NextResponse.json({ error: `Budget is in '${currentVersion.status}' status, not pm_review` }, { status: 400 });
  }

  // Mark PM review opened
  await admin.from('budgets').update({
    pm_review_opened_at: (budget as any).pm_review_opened_at || new Date().toISOString(),
    pm_reviewer_id: user.id,
  }).eq('id', budget_id);

  let newStatus = '';
  const versionUpdate: any = {
    pm_reviewed_by: user.id,
    pm_reviewed_at: new Date().toISOString(),
  };

  if (action === 'approve') {
    newStatus = 'pm_approved';
  } else if (action === 'return') {
    if (!comments?.trim()) return NextResponse.json({ error: 'Comments required when returning' }, { status: 400 });
    newStatus = 'returned_to_tl';
    versionUpdate.pm_return_reason = comments;
  } else if (action === 'reject') {
    if (!comments?.trim()) return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
    newStatus = 'pm_rejected';
    versionUpdate.pm_rejection_reason = comments;
  }

  // Update version status
  versionUpdate.status = newStatus;
  await admin.from('budget_versions').update(versionUpdate).eq('id', currentVersion.id);

  // Get project and submitter info for notifications
  const { data: project } = await admin.from('projects').select('name').eq('id', (budget as any).project_id).single();
  const submitterId = (budget as any).created_by;
  const isAccountantBudget = (budget as any).submitted_by_role === 'accountant';

  // Notify the submitter (TL or Accountant)
  if (submitterId) {
    let notifTitle = '';
    let notifMsg = '';
    if (action === 'approve') {
      notifTitle = 'Budget approved by PM';
      notifMsg = `Your budget for ${project?.name} has been approved by ${profile?.full_name} and is now with the CFO for final approval.`;
    } else if (action === 'return') {
      notifTitle = 'Budget returned for changes';
      notifMsg = `Your budget for ${project?.name} was returned by ${profile?.full_name}. Review their comments and resubmit.`;
    } else if (action === 'reject') {
      notifTitle = 'Budget rejected by PM';
      notifMsg = `Your budget for ${project?.name} was rejected by ${profile?.full_name}. ${isAccountantBudget ? 'Create a new budget.' : 'Create a new budget.'}`;
    }
    await admin.from('notifications').insert({
      user_id: submitterId,
      title: notifTitle,
      message: notifMsg,
      link: '/budgets/' + budget_id,
    });
  }

  // If PM approved, notify CFO
  if (action === 'approve') {
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await admin.from('notifications').insert({
        user_id: cfo.id,
        title: 'Budget ready for approval',
        message: `The budget for ${project?.name} has been PM-approved and is ready for your review.`,
        link: '/budgets/' + budget_id,
      });
    }
  }

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: `pm_budget_${action === 'return' ? 'returned' : action + 'ed'}`,
    table_name: 'budget_versions',
    record_id: currentVersion.id,
    old_values: { status: 'pm_review' },
    new_values: { status: newStatus, comments },
  });

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process PM budget review.', 'PM_REVIEW_ERROR');
  }
}
