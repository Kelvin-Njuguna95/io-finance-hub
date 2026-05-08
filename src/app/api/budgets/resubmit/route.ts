import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { createNotification } from '@/lib/notifications';

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

    const roleErr = assertRole(profile, ['team_leader', 'accountant', 'project_manager', 'cfo']);
    if (roleErr) {
      return NextResponse.json({ error: 'Not authorized to resubmit budgets' }, { status: roleErr.status });
    }

    const body = await request.json();
    const { budget_id } = body;
    if (!budget_id) {
      return NextResponse.json({ error: 'budget_id required' }, { status: 400 });
    }

    const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_resubmit', {
      p_budget_id: budget_id,
      p_resubmitter_id: user.id,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message, code: 'RESUBMIT_FAILED' }, { status: 400 });
    }

    const newStatus = (newVersion as { status: string }).status;

    if (newStatus === 'pm_review') {
      const { data: pmAssignments } = await admin
        .from('user_project_assignments')
        .select('user_id')
        .eq('project_id', (await admin.from('budgets').select('project_id').eq('id', budget_id).single()).data?.project_id)
        .eq('role', 'project_manager');

      if (pmAssignments && pmAssignments.length > 0) {
        const { data: budget } = await admin.from('budgets').select('project_id').eq('id', budget_id).single();
        const { data: project } = await admin.from('projects').select('name').eq('id', budget?.project_id).single();

        for (const pm of pmAssignments) {
          await createNotification(admin, {
            userId: (pm as { user_id: string }).user_id,
            title: 'Budget resubmitted for review',
            message: `A budget for ${project?.name || 'project'} has been resubmitted for PM review.`,
            link: '/budgets/' + budget_id,
          });
        }
      }
    } else if (newStatus === 'pm_approved') {
      const { data: cfoUsers } = await admin.from('users').select('id').eq('role', 'cfo');
      const { data: budget } = await admin.from('budgets').select('project_id').eq('id', budget_id).single();
      const { data: project } = await admin.from('projects').select('name').eq('id', budget?.project_id).single();

      for (const cfo of cfoUsers || []) {
        await createNotification(admin, {
          userId: cfo.id,
          title: 'Budget ready for CFO approval',
          message: `A budget for ${project?.name || 'project'} is ready for CFO approval.`,
          link: '/budgets/' + budget_id,
        });
      }
    }

    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to resubmit budget.', 'RESUBMIT_ERROR');
  }
}
