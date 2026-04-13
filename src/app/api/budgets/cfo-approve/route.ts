import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const CFO_APPROVABLE_STATUSES = ['submitted', 'pm_review', 'pm_approved'] as const;

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
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

    const { data: budget } = await admin
      .from('budgets')
      .select('*, budget_versions(*, budget_items(*))')
      .eq('id', budget_id)
      .single();

    if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

    const monthErr = await assertMonthOpen(admin, budget.year_month);
    if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

    const versions = (budget as any).budget_versions || [];
    const currentVersion = versions.find((v: any) => v.version_number === budget.current_version);
    if (!currentVersion) return NextResponse.json({ error: 'No current version found' }, { status: 400 });

    const { data: project } = await admin.from('projects').select('name').eq('id', budget.project_id).single();

    if (action === 'approve') {
      if (!CFO_APPROVABLE_STATUSES.includes(currentVersion.status)) {
        return NextResponse.json(
          {
            error: 'Budget must be submitted before CFO can approve. Current status: ' + currentVersion.status,
            code: 'STATUS_MISMATCH',
          },
          { status: 400 },
        );
      }

      const allItems = currentVersion.budget_items || [];
      const pmReviewSkipped = currentVersion.status !== 'pm_approved';
      const approvedItems = pmReviewSkipped
        ? allItems
        : allItems.filter((i: any) => ['approved', 'adjusted'].includes(i.pm_status));
      const removedItems = pmReviewSkipped
        ? []
        : allItems.filter((i: any) => i.pm_status === 'removed');

      const originalTotal = allItems.reduce((s: number, i: any) => s + Number(i.amount_kes || 0), 0);
      const approvedTotal = pmReviewSkipped
        ? originalTotal
        : approvedItems.reduce((s: number, i: any) => s + Number(i.pm_approved_amount ?? i.amount_kes ?? 0), 0);

      const approvalSummary = {
        approved_count: pmReviewSkipped
          ? allItems.length
          : approvedItems.filter((i: any) => i.pm_status === 'approved').length,
        adjusted_count: pmReviewSkipped
          ? 0
          : approvedItems.filter((i: any) => i.pm_status === 'adjusted').length,
        removed_count: pmReviewSkipped ? 0 : removedItems.length,
        original_total: originalTotal,
        approved_total: approvedTotal,
        variance: originalTotal - approvedTotal,
        pm_review_skipped: pmReviewSkipped,
      };

      await admin
        .from('budgets')
        .update({
          pm_original_total: originalTotal,
          pm_approved_total: approvedTotal,
          pm_review_summary: approvalSummary,
        })
        .eq('id', budget_id);

      const { error: updateErr } = await admin
        .from('budget_versions')
        .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq('id', currentVersion.id);

      if (updateErr) {
        return NextResponse.json({ error: 'Failed to update: ' + updateErr.message }, { status: 500 });
      }

      await admin.from('budget_approvals').insert({
        budget_version_id: currentVersion.id,
        action: 'approved',
        approved_by: user.id,
        pm_review_skipped: pmReviewSkipped,
      });

      if (auto_reject_siblings && sibling_budget_ids?.length > 0) {
        for (const sibId of sibling_budget_ids) {
          const { data: sib } = await admin
            .from('budgets')
            .select('*, budget_versions(id, version_number, status)')
            .eq('id', sibId)
            .single();
          if (sib) {
            const sv = (sib as any).budget_versions || [];
            const sc = sv.find((v: any) => v.version_number === sib.current_version);
            if (sc && !['rejected', 'draft'].includes(sc.status)) {
              await admin
                .from('budget_versions')
                .update({
                  status: 'rejected',
                  reviewed_by: user.id,
                  reviewed_at: new Date().toISOString(),
                  rejection_reason: 'Auto-rejected: another budget approved for this project/month.',
                })
                .eq('id', sc.id);
            }
          }
        }
      }

      try {
        await fetch(new URL('/api/expense-lifecycle', request.url).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') || '' },
          body: JSON.stringify({ budget_id, action: 'auto_populate' }),
        });
      } catch (e) {
        // no-op
      }

      const { data: tlUser } = await admin.from('users').select('id').eq('id', budget.created_by).single();
      if (tlUser) {
        await admin.from('notifications').insert({
          user_id: tlUser.id,
          title: 'Budget approved by CFO',
          message: 'Your budget for ' + (project?.name || 'project') + ' has been approved.',
          link: '/budgets/' + budget_id,
        });
      }

      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'cfo_budget_approved',
        table_name: 'budget_versions',
        record_id: currentVersion.id,
        old_values: { status: currentVersion.status },
        new_values: { status: 'approved', pm_review_skipped: pmReviewSkipped },
      });

      return NextResponse.json({ success: true, new_status: 'approved' });
    }

    if (action === 'reject') {
      if (!reason?.trim()) return NextResponse.json({ error: 'Rejection reason required' }, { status: 400 });
      if (!['pm_approved', 'pm_review', 'submitted', 'under_review'].includes(currentVersion.status)) {
        return NextResponse.json({ error: 'Cannot reject budget in status: ' + currentVersion.status }, { status: 400 });
      }

      const { error: updateErr } = await admin
        .from('budget_versions')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq('id', currentVersion.id);
      if (updateErr) return NextResponse.json({ error: 'Failed to reject: ' + updateErr.message }, { status: 500 });

      await admin.from('budget_approvals').insert({
        budget_version_id: currentVersion.id,
        action: 'rejected',
        approved_by: user.id,
        reason,
      });

      const { data: tlUser } = await admin.from('users').select('id').eq('id', budget.created_by).single();
      if (tlUser) {
        await admin.from('notifications').insert({
          user_id: tlUser.id,
          title: 'Budget rejected by CFO',
          message: 'Your budget for ' + (project?.name || 'project') + ' was rejected. Reason: ' + reason,
          link: '/budgets/' + budget_id,
        });
      }

      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'cfo_budget_rejected',
        table_name: 'budget_versions',
        record_id: currentVersion.id,
        old_values: { status: currentVersion.status },
        new_values: { status: 'rejected', reason },
      });

      return NextResponse.json({ success: true, new_status: 'rejected' });
    }

    if (action === 'mark_under_review') {
      const { error: updateErr } = await admin
        .from('budget_versions')
        .update({ status: 'under_review', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq('id', currentVersion.id);
      if (updateErr) return NextResponse.json({ error: 'Failed to update: ' + updateErr.message }, { status: 500 });
      return NextResponse.json({ success: true, new_status: 'under_review' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process CFO budget action.', 'CFO_APPROVE_ERROR');
  }
}
