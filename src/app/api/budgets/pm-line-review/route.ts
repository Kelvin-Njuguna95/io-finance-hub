import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { createNotification } from '@/lib/notifications';

const PM_ROLES = ['project_manager', 'cfo'] as const;

// POST — apply line-item decisions or submit final review.
// update_item / bulk_approve mutate budget_items in place during the
// pm_review working-draft state; submit_review (which is a status
// transition) routes through fn_budget_pm_line_review_submit which
// snapshots the line decisions into a new immutable version. F-07.
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
      return NextResponse.json({ error: 'Only PM or CFO can review line items' }, { status: 403 });
    }

    const body = await request.json();
    const { action, budget_id, items, item_id, pm_status, pm_approved_amount, reason } = body;

    if (budget_id) {
      const { data: budgetForLock } = await admin.from('budgets').select('year_month').eq('id', budget_id).single();
      if (budgetForLock) {
        const monthErr = await assertMonthOpen(admin, (budgetForLock as { year_month: string }).year_month);
        if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });
      }
    } else if (item_id) {
      const { data: bi } = await admin.from('budget_items').select('budget_version_id').eq('id', item_id).single();
      if (bi) {
        const { data: bv } = await admin.from('budget_versions').select('budget_id').eq('id', (bi as { budget_version_id: string }).budget_version_id).single();
        if (bv) {
          const { data: b } = await admin.from('budgets').select('year_month').eq('id', (bv as { budget_id: string }).budget_id).single();
          if (b) {
            const monthErr = await assertMonthOpen(admin, (b as { year_month: string }).year_month);
            if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });
          }
        }
      }
    }

    // Action: update single line item (in-place during pm_review working draft)
    if (action === 'update_item' && item_id) {
      if (!['approved', 'adjusted', 'removed', 'pending'].includes(pm_status)) {
        return NextResponse.json({ error: 'Invalid pm_status' }, { status: 400 });
      }
      if (['adjusted', 'removed'].includes(pm_status) && !reason?.trim()) {
        return NextResponse.json({ error: 'Reason required for adjust/remove' }, { status: 400 });
      }

      const update: Record<string, unknown> = {
        pm_status,
        pm_reviewed_by: user.id,
        pm_reviewed_at: new Date().toISOString(),
        pm_adjustment_reason: reason || null,
      };

      if (pm_status === 'approved') {
        const { data: item } = await admin.from('budget_items').select('amount_kes').eq('id', item_id).single();
        update.pm_approved_amount = (item as { amount_kes: number } | null)?.amount_kes || 0;
      } else if (pm_status === 'adjusted') {
        if (!pm_approved_amount || pm_approved_amount <= 0) {
          return NextResponse.json({ error: 'Approved amount must be > 0' }, { status: 400 });
        }
        if (profile?.role !== 'cfo') {
          const { data: item } = await admin.from('budget_items').select('amount_kes').eq('id', item_id).single();
          if (pm_approved_amount > Number((item as { amount_kes: number } | null)?.amount_kes)) {
            return NextResponse.json({ error: 'Cannot increase above submitted amount' }, { status: 400 });
          }
        }
        update.pm_approved_amount = pm_approved_amount;
      } else if (pm_status === 'removed') {
        update.pm_approved_amount = 0;
      } else if (pm_status === 'pending') {
        update.pm_approved_amount = null;
        update.pm_adjustment_reason = null;
        update.pm_reviewed_by = null;
        update.pm_reviewed_at = null;
      }

      await admin.from('budget_items').update(update).eq('id', item_id);

      if (budget_id) {
        const { data: itemRef } = await admin.from('budget_items').select('budget_version_id').eq('id', item_id).single();
        const { data: allItems } = await admin
          .from('budget_items')
          .select('pm_status, pm_approved_amount, amount_kes')
          .eq('budget_version_id', (itemRef as { budget_version_id: string } | null)?.budget_version_id);

        const approvedTotal = (allItems || [])
          .filter((i: { pm_status?: string }) => ['approved', 'adjusted'].includes(i.pm_status || ''))
          .reduce((s: number, i: { pm_approved_amount?: number }) => s + Number(i.pm_approved_amount || 0), 0);

        await admin.from('budgets').update({ pm_approved_total: approvedTotal }).eq('id', budget_id);
      }

      return NextResponse.json({ success: true });
    }

    // Action: bulk approve (in-place during pm_review working draft)
    if (action === 'bulk_approve' && items?.length > 0) {
      for (const id of items) {
        const { data: item } = await admin.from('budget_items').select('amount_kes, pm_status').eq('id', id).single();
        if ((item as { pm_status?: string } | null)?.pm_status === 'pending') {
          await admin.from('budget_items').update({
            pm_status: 'approved',
            pm_approved_amount: (item as { amount_kes: number }).amount_kes,
            pm_reviewed_by: user.id,
            pm_reviewed_at: new Date().toISOString(),
          }).eq('id', id);
        }
      }
      return NextResponse.json({ success: true, count: items.length });
    }

    // Action: submit final review — status transition; routes through RPC
    if (action === 'submit_review' && budget_id) {
      const { data: newVersion, error: rpcErr } = await admin.rpc('fn_budget_pm_line_review_submit', {
        p_budget_id: budget_id,
        p_pm_id: user.id,
      });

      if (rpcErr) {
        return NextResponse.json({ error: rpcErr.message, code: 'PM_LINE_REVIEW_SUBMIT_FAILED' }, { status: 400 });
      }

      const { data: budget } = await admin.from('budgets').select('project_id, pm_review_summary').eq('id', budget_id).single();
      const { data: project } = await admin.from('projects').select('name').eq('id', (budget as { project_id: string } | null)?.project_id).single();
      const summary = (budget as { pm_review_summary?: { adjusted_count?: number; removed_count?: number; original_total?: number; approved_total?: number } } | null)?.pm_review_summary || {};

      const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
      for (const cfo of cfos || []) {
        await createNotification(admin, {
          userId: cfo.id,
          title: 'Budget ready for approval',
          message: `${profile?.full_name} reviewed the budget for ${project?.name}. Original: KES ${(summary.original_total || 0).toLocaleString()}, Approved: KES ${(summary.approved_total || 0).toLocaleString()} (${summary.adjusted_count || 0} adjusted, ${summary.removed_count || 0} removed).`,
          link: '/budgets/' + budget_id,
        });
      }

      return NextResponse.json({
        success: true,
        summary,
        new_version_id: (newVersion as { id: string }).id,
      });
    }

    return NextResponse.json({ error: 'Invalid action', code: 'BAD_REQUEST' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process line-item review.', 'PM_LINE_REVIEW_ERROR');
  }
}
