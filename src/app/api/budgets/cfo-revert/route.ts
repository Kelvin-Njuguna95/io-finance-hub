import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  const roleErr = assertRole(profile, ['cfo']);
  if (roleErr) return NextResponse.json({ error: 'Only CFO can revert budgets' }, { status: roleErr.status });

  const body = await request.json();
  const { budget_id, action, reason } = body;

  if (!budget_id || !action) return NextResponse.json({ error: 'budget_id and action required' }, { status: 400 });
  if (!reason?.trim()) return NextResponse.json({ error: 'Reason required' }, { status: 400 });

  const { data: budget } = await admin.from('budgets').select('*, budget_versions(*)').eq('id', budget_id).single();
  if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

  // Find current version
  const versions = (budget as /* // */ any).budget_versions || [];
  const currentVersion = versions.find((v: /* // */ any) => v.version_number === budget.current_version);
  if (!currentVersion || currentVersion.status !== 'approved') {
    return NextResponse.json({ error: 'Only approved budgets can be reverted' }, { status: 400 });
  }

  // Month lock enforcement
  const monthErr = await assertMonthOpen(admin, budget.year_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

  // Count linked expenses and withdrawals
  const { count: expCount } = await admin.from('expenses').select('id', { count: 'exact', head: true }).eq('budget_id', budget_id);
  const { data: project } = await admin.from('projects').select('name').eq('id', budget.project_id).single();

  if (action === 'send_back') {
    // Revert to returned_to_tl
    await admin.from('budget_versions').update({ status: 'returned_to_tl' }).eq('id', currentVersion.id);
    await admin.from('budgets').update({
      cfo_return_reason: reason,
      pm_approved_total: null,
    }).eq('id', budget_id);

    // Flag linked expenses
    if ((expCount || 0) > 0) {
      await admin.from('expenses').update({ budget_approval_revoked: true }).eq('budget_id', budget_id);
    }

    // Notify TL
    const { data: tlUser } = await admin.from('users').select('id').eq('id', budget.created_by).single();
    if (tlUser) {
      await admin.from('notifications').insert({
        user_id: tlUser.id,
        title: 'Budget sent back by CFO',
        message: `Your approved budget for ${project?.name} has been sent back by the CFO. Review their comments and resubmit.`,
        link: '/budgets/' + budget_id,
      });
    }

    // Red flag if expenses affected
    if ((expCount || 0) > 0) {
      await admin.from('red_flags').insert({
        flag_type: 'expense_not_linked',
        severity: 'high',
        title: `Budget for ${project?.name} reverted after approval`,
        description: `${expCount} linked expenses are now suspended pending re-approval.`,
        project_id: budget.project_id,
        year_month: budget.year_month,
      });
    }

    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'cfo_budget_reverted_to_tl',
      table_name: 'budgets',
      record_id: budget_id,
      old_values: { status: 'approved', pm_approved_total: budget.pm_approved_total },
      new_values: { status: 'returned_to_tl', cfo_comments: reason },
      reason,
    });

    return NextResponse.json({ success: true, message: 'Budget sent back to TL' });
  }

  if (action === 'delete') {
    // Snapshot before deletion
    const snapshot = {
      budget_id,
      project: project?.name,
      year_month: budget.year_month,
      pm_approved_total: budget.pm_approved_total,
      reason,
      linked_expenses: expCount,
      deleted_at: new Date().toISOString(),
    };

    // Unlink expenses
    if ((expCount || 0) > 0) {
      await admin.from('expenses').update({ budget_approval_revoked: true }).eq('budget_id', budget_id);
    }

    // Audit log BEFORE deletion
    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'cfo_budget_deleted',
      table_name: 'budgets',
      record_id: budget_id,
      old_values: snapshot,
      reason,
    });

    // Delete
    await admin.from('pending_expenses').delete().eq('budget_id', budget_id);
    await admin.from('budget_withdrawal_log').delete().eq('budget_id', budget_id);
    for (const v of versions) {
      await admin.from('budget_items').delete().eq('budget_version_id', v.id);
      await admin.from('budget_approvals').delete().eq('budget_version_id', v.id);
    }
    await admin.from('budget_versions').delete().eq('budget_id', budget_id);
    await admin.from('budgets').delete().eq('id', budget_id);

    // Red flag
    if ((expCount || 0) > 0) {
      await admin.from('red_flags').insert({
        flag_type: 'expense_not_linked',
        severity: 'critical',
        title: `Budget for ${project?.name} deleted by CFO`,
        description: `${expCount} expenses have no approved budget. Reassign them.`,
        project_id: budget.project_id,
        year_month: budget.year_month,
      });
    }

    // Notify TL
    const { data: tlUser } = await admin.from('users').select('id').eq('id', budget.created_by).single();
    if (tlUser) {
      await admin.from('notifications').insert({
        user_id: tlUser.id,
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
