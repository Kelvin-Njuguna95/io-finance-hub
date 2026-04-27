import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole, assertMonthOpen } from '@/lib/supabase/admin';
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

    const roleErr = assertRole(profile, ['cfo']);
    if (roleErr) {
      return NextResponse.json({ error: 'Only CFO can revert budgets' }, { status: roleErr.status });
    }

    const body = await request.json();
    const { budget_id, action, reason } = body;

    if (!budget_id || !action) {
      return NextResponse.json({ error: 'budget_id and action required' }, { status: 400 });
    }
    if (!reason?.trim()) {
      return NextResponse.json({ error: 'Reason required' }, { status: 400 });
    }

    if (action === 'send_back') {
      const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_cfo_revert', {
        p_budget_id: budget_id,
        p_cfo_id: user.id,
        p_reason: reason,
      });

      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message, code: 'CFO_REVERT_FAILED' }, { status: 400 });
      }

      const { data: budget } = await admin
        .from('budgets')
        .select('project_id, created_by, year_month')
        .eq('id', budget_id)
        .single();
      const { data: project } = await admin
        .from('projects')
        .select('name')
        .eq('id', (budget as { project_id: string } | null)?.project_id)
        .single();

      const { count: expCount } = await admin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('budget_id', budget_id)
        .eq('budget_approval_revoked', true);

      const tlId = (budget as { created_by: string } | null)?.created_by;
      if (tlId) {
        await createNotification(admin, {
          userId: tlId,
          title: 'Budget sent back by CFO',
          message: `Your approved budget for ${project?.name} has been sent back by the CFO. Review their comments and resubmit.`,
          link: '/budgets/' + budget_id,
        });
      }

      if ((expCount || 0) > 0) {
        await admin.from('red_flags').insert({
          flag_type: 'expense_not_linked',
          severity: 'high',
          title: `Budget for ${project?.name} reverted after approval`,
          description: `${expCount} linked expenses are now suspended pending re-approval.`,
          project_id: (budget as { project_id: string } | null)?.project_id,
          year_month: (budget as { year_month: string } | null)?.year_month,
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Budget sent back to TL',
        new_version_id: (newVersion as { id: string }).id,
      });
    }

    if (action === 'delete') {
      // Destructive deletion — left in-place per F-07 Phase 2 decision (the
      // audit-trail concern doesn't apply to deletion of the entire budget).
      const { data: budget } = await admin.from('budgets').select('*, budget_versions(*)').eq('id', budget_id).single();
      if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

      const monthErr = await assertMonthOpen(admin, (budget as { year_month: string }).year_month);
      if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

      const { count: expCount } = await admin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('budget_id', budget_id);
      const { data: project } = await admin
        .from('projects')
        .select('name')
        .eq('id', (budget as { project_id: string }).project_id)
        .single();

      const versions = (budget as { budget_versions?: Array<{ id: string }> }).budget_versions || [];

      const snapshot = {
        budget_id,
        project: project?.name,
        year_month: (budget as { year_month: string }).year_month,
        pm_approved_total: (budget as { pm_approved_total?: number }).pm_approved_total,
        reason,
        linked_expenses: expCount,
        deleted_at: new Date().toISOString(),
      };

      if ((expCount || 0) > 0) {
        await admin.from('expenses').update({ budget_approval_revoked: true }).eq('budget_id', budget_id);
      }

      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'cfo_budget_deleted',
        table_name: 'budgets',
        record_id: budget_id,
        old_values: snapshot,
        reason,
      });

      await admin.from('pending_expenses').delete().eq('budget_id', budget_id);
      await admin.from('budget_withdrawal_log').delete().eq('budget_id', budget_id);
      for (const v of versions) {
        await admin.from('budget_items').delete().eq('budget_version_id', v.id);
        await admin.from('budget_approvals').delete().eq('budget_version_id', v.id);
      }
      await admin.from('budget_versions').delete().eq('budget_id', budget_id);
      await admin.from('budgets').delete().eq('id', budget_id);

      if ((expCount || 0) > 0) {
        await admin.from('red_flags').insert({
          flag_type: 'expense_not_linked',
          severity: 'critical',
          title: `Budget for ${project?.name} deleted by CFO`,
          description: `${expCount} expenses have no approved budget. Reassign them.`,
          project_id: (budget as { project_id: string }).project_id,
          year_month: (budget as { year_month: string }).year_month,
        });
      }

      const tlId = (budget as { created_by: string }).created_by;
      if (tlId) {
        await createNotification(admin, {
          userId: tlId,
          title: 'Budget deleted by CFO',
          message: `Your budget for ${project?.name} has been deleted by the CFO. Create a new budget.`,
        });
      }

      return NextResponse.json({ success: true, message: 'Budget deleted' });
    }

    return NextResponse.json({ error: 'Invalid action', code: 'BAD_REQUEST' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process CFO budget action.', 'CFO_REVERT_ERROR');
  }
}
