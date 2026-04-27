import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { autoPopulateExpenses } from '@/lib/expense-lifecycle';
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

    const roleErr = assertRole(profile, ['cfo']);
    if (roleErr) {
      return NextResponse.json({ error: 'Only CFO can approve/reject budgets' }, { status: roleErr.status });
    }

    const body = await request.json();
    const { budget_id, action, reason, auto_reject_siblings, sibling_budget_ids } = body;

    if (!budget_id || !action) {
      return NextResponse.json({ error: 'budget_id and action required' }, { status: 400 });
    }
    if (!['approve', 'reject', 'mark_under_review'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_cfo_approve', {
      p_budget_id: budget_id,
      p_cfo_id: user.id,
      p_action: action,
      p_reason: reason ?? null,
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message, code: 'CFO_APPROVE_FAILED' }, { status: 400 });
    }

    const newStatus = (newVersion as { status: string }).status;
    const newVersionId = (newVersion as { id: string }).id;

    const { data: budget } = await admin
      .from('budgets')
      .select('project_id, created_by')
      .eq('id', budget_id)
      .single();
    const { data: project } = await admin
      .from('projects')
      .select('name')
      .eq('id', (budget as { project_id: string } | null)?.project_id)
      .single();

    if (action === 'approve') {
      if (auto_reject_siblings && sibling_budget_ids?.length > 0) {
        for (const sibId of sibling_budget_ids) {
          await admin.rpc('fn_budget_cfo_approve', {
            p_budget_id: sibId,
            p_cfo_id: user.id,
            p_action: 'reject',
            p_reason: 'Auto-rejected: another budget approved for this project/month.',
          });
        }
      }

      const populateResult = await autoPopulateExpenses(
        { budget_id, budget_version_id: newVersionId },
        { id: user.id, role: profile.role },
        admin,
      );
      if (!populateResult.success) {
        console.error('Expense auto-populate failed after CFO approval:', populateResult.error);
      }

      const tlId = (budget as { created_by: string } | null)?.created_by;
      if (tlId) {
        await createNotification(admin, {
          userId: tlId,
          title: 'Budget approved by CFO',
          message: `Your budget for ${project?.name || 'project'} has been approved.`,
          link: '/budgets/' + budget_id,
        });
      }

      return NextResponse.json({ success: true, new_status: newStatus });
    }

    if (action === 'reject') {
      const tlId = (budget as { created_by: string } | null)?.created_by;
      if (tlId) {
        await createNotification(admin, {
          userId: tlId,
          title: 'Budget rejected by CFO',
          message: `Your budget for ${project?.name || 'project'} was rejected. Reason: ${reason}`,
          link: '/budgets/' + budget_id,
        });
      }

      return NextResponse.json({ success: true, new_status: newStatus });
    }

    // mark_under_review
    return NextResponse.json({ success: true, new_status: newStatus });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process CFO budget action.', 'CFO_APPROVE_ERROR');
  }
}
