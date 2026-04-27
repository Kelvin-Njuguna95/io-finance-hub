import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { createNotification } from '@/lib/notifications';

const PM_ROLES = ['project_manager', 'cfo'] as const;

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    if (!PM_ROLES.includes(profile.role as (typeof PM_ROLES)[number])) {
      return NextResponse.json({ error: 'Only PMs can review TL budgets' }, { status: 403 });
    }

    const body = await request.json();
    const { budget_id, action, comments } = body;

    if (!budget_id || !action) {
      return NextResponse.json({ error: 'budget_id and action required' }, { status: 400 });
    }
    if (!['approve', 'return', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Misc gate check — PM must have submitted previous month's misc report to approve
    if (action === 'approve' && profile?.role === 'project_manager') {
      const { data: budget } = await admin
        .from('budgets')
        .select('year_month, project_id')
        .eq('id', budget_id)
        .single();
      if (budget) {
        const budgetMonth = (budget as { year_month: string }).year_month;
        const prevDate = new Date(parseInt(budgetMonth.split('-')[0]), parseInt(budgetMonth.split('-')[1]) - 2, 1);
        const prevMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

        const { data: gateSetting } = await admin.from('system_settings').select('value').eq('key', 'misc_gate_start_month').single();
        const gateStart = gateSetting?.value || '2026-04';

        if (prevMonth >= gateStart) {
          const { data: miscReport } = await admin
            .from('misc_reports')
            .select('status')
            .eq('project_id', (budget as { project_id: string }).project_id)
            .eq('period_month', prevMonth)
            .single();

          if (!miscReport || miscReport.status === 'draft') {
            return NextResponse.json(
              {
                error: `Cannot approve this budget. The misc expenditure report for ${prevMonth} has not been submitted. Submit your misc report first.`,
                gate: 'MISC_REPORT_GATE_BLOCKED',
                prev_month: prevMonth,
              },
              { status: 422 },
            );
          }
        }
      }
    }

    const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_pm_review', {
      p_budget_id: budget_id,
      p_pm_id: user.id,
      p_action: action,
      p_comments: comments ?? null,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message, code: 'PM_REVIEW_FAILED' }, { status: 400 });
    }

    const newStatus = (newVersion as { status: string }).status;

    const { data: budget } = await admin
      .from('budgets')
      .select('project_id, created_by, submitted_by_role')
      .eq('id', budget_id)
      .single();
    const { data: project } = await admin.from('projects').select('name').eq('id', (budget as { project_id: string } | null)?.project_id).single();
    const submitterId = (budget as { created_by: string } | null)?.created_by;

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
        notifMsg = `Your budget for ${project?.name} was rejected by ${profile?.full_name}. Create a new budget.`;
      }
      await createNotification(admin, {
        userId: submitterId,
        title: notifTitle,
        message: notifMsg,
        link: '/budgets/' + budget_id,
      });
    }

    if (action === 'approve') {
      const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
      for (const cfo of cfos || []) {
        await createNotification(admin, {
          userId: cfo.id,
          title: 'Budget ready for approval',
          message: `The budget for ${project?.name} has been PM-approved and is ready for your review.`,
          link: '/budgets/' + budget_id,
        });
      }
    }

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process PM budget review.', 'PM_REVIEW_ERROR');
  }
}
