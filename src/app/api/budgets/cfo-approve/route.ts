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
      .select('project_id, created_by, year_month, pm_review_summary')
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

      // Bypass-approval PM notification.
      // Only fires when:
      //   1. action === 'approve' (we are inside that branch)
      //   2. budget is project-scoped (department budgets have no PM)
      //   3. pm_review_skipped is true — i.e. source status was not
      //      'pm_approved'. The RPC sets this on budgets.pm_review_summary
      //      at 00042 §2d line 629; we read it back from there rather than
      //      re-deriving from a pre-RPC source-status read.
      const projectId = (budget as { project_id: string | null } | null)?.project_id ?? null;
      const pmSummary = (budget as { pm_review_summary: { pm_review_skipped?: boolean } | null } | null)?.pm_review_summary;
      const pmReviewSkipped = pmSummary?.pm_review_skipped === true;

      if (projectId && pmReviewSkipped) {
        // Resolve assigned PMs via user_project_assignments + role filter.
        // Same pattern as src/app/api/budgets/accountant-submit-notify/route.ts:73–91.
        const { data: assignments } = await admin
          .from('user_project_assignments')
          .select('user_id, users!inner(id, role)')
          .eq('project_id', projectId)
          .eq('users.role', 'project_manager');

        const pmIds = new Set<string>(
          (assignments ?? []).map((a: { user_id: string }) => a.user_id),
        );

        // Fold in projects.director_user_id if that user is a PM (matches
        // the accountant-submit-notify resolution).
        const { data: projectRow } = await admin
          .from('projects')
          .select('director_user_id')
          .eq('id', projectId)
          .maybeSingle();
        const directorUserId = (projectRow as { director_user_id: string | null } | null)?.director_user_id ?? null;
        if (directorUserId && !pmIds.has(directorUserId)) {
          const { data: maybePm } = await admin
            .from('users')
            .select('id, role')
            .eq('id', directorUserId)
            .eq('role', 'project_manager')
            .maybeSingle();
          if (maybePm) pmIds.add(directorUserId);
        }

        const yearMonth = (budget as { year_month: string } | null)?.year_month ?? '';
        for (const pmId of pmIds) {
          await createNotification(admin, {
            userId: pmId,
            title: 'CFO approved a budget without PM review',
            message: `${project?.name || 'A project'} budget for ${yearMonth} was approved directly by the CFO.`,
            link: '/budgets/' + budget_id,
          });
        }
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
