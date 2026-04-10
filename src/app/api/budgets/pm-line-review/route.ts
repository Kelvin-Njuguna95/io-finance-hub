import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const PM_ROLES = ['project_manager', 'cfo'] as const;

// POST — apply line-item decisions or submit final review
export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  if (!PM_ROLES.includes(profile.role as (typeof PM_ROLES)[number])) {
    return NextResponse.json({ error: 'Only PM or CFO can review line items' }, { status: 403 });
  }

  const body = await request.json();
  const { action, budget_id, items, item_id, pm_status, pm_approved_amount, reason } = body;

  // Month lock enforcement — look up year_month from the budget
  if (budget_id) {
    const { data: budgetForLock } = await admin.from('budgets').select('year_month').eq('id', budget_id).single();
    if (budgetForLock) {
      const monthErr = await assertMonthOpen(admin, budgetForLock.year_month);
      if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });
    }
  } else if (item_id) {
    // Derive year_month from the budget item's budget
    const { data: bi } = await admin.from('budget_items').select('budget_version_id').eq('id', item_id).single();
    if (bi) {
      const { data: bv } = await admin.from('budget_versions').select('budget_id').eq('id', bi.budget_version_id).single();
      if (bv) {
        const { data: b } = await admin.from('budgets').select('year_month').eq('id', bv.budget_id).single();
        if (b) {
          const monthErr = await assertMonthOpen(admin, b.year_month);
          if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });
        }
      }
    }
  }

  // Action: update single line item
  if (action === 'update_item' && item_id) {
    if (!['approved', 'adjusted', 'removed', 'pending'].includes(pm_status)) {
      return NextResponse.json({ error: 'Invalid pm_status' }, { status: 400 });
    }
    if (['adjusted', 'removed'].includes(pm_status) && !reason?.trim()) {
      return NextResponse.json({ error: 'Reason required for adjust/remove' }, { status: 400 });
    }

    const update: /* // */ any = {
      pm_status,
      pm_reviewed_by: user.id,
      pm_reviewed_at: new Date().toISOString(),
      pm_adjustment_reason: reason || null,
    };

    if (pm_status === 'approved') {
      // Get original amount
      const { data: item } = await admin.from('budget_items').select('amount_kes').eq('id', item_id).single();
      update.pm_approved_amount = item?.amount_kes || 0;
    } else if (pm_status === 'adjusted') {
      if (!pm_approved_amount || pm_approved_amount <= 0) {
        return NextResponse.json({ error: 'Approved amount must be > 0' }, { status: 400 });
      }
      // PMs cannot increase above submitted amount; CFOs can set any amount
      if (profile?.role !== 'cfo') {
        const { data: item } = await admin.from('budget_items').select('amount_kes').eq('id', item_id).single();
        if (pm_approved_amount > Number(item?.amount_kes)) {
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

    // Update budget pm_approved_total
    if (budget_id) {
      const { data: allItems } = await admin.from('budget_items')
        .select('pm_status, pm_approved_amount, amount_kes, budget_version_id')
        .eq('budget_version_id', (await admin.from('budget_items').select('budget_version_id').eq('id', item_id).single()).data?.budget_version_id);

      const approvedTotal = (allItems || [])
        .filter((i: /* // */ any) => ['approved', 'adjusted'].includes(i.pm_status))
        .reduce((s: number, i: /* // */ any) => s + Number(i.pm_approved_amount || 0), 0);

      await admin.from('budgets').update({ pm_approved_total: approvedTotal }).eq('id', budget_id);
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: `budget_item_${pm_status}`,
      table_name: 'budget_items',
      record_id: item_id,
      new_values: { pm_status, pm_approved_amount: update.pm_approved_amount, reason },
    });

    return NextResponse.json({ success: true });
  }

  // Action: bulk approve
  if (action === 'bulk_approve' && items?.length > 0) {
    for (const id of items) {
      const { data: item } = await admin.from('budget_items').select('amount_kes, pm_status').eq('id', id).single();
      if (item?.pm_status === 'pending') {
        await admin.from('budget_items').update({
          pm_status: 'approved',
          pm_approved_amount: item.amount_kes,
          pm_reviewed_by: user.id,
          pm_reviewed_at: new Date().toISOString(),
        }).eq('id', id);
      }
    }
    return NextResponse.json({ success: true, count: items.length });
  }

  // Action: submit final review
  if (action === 'submit_review' && budget_id) {
    // Get budget and check all items reviewed
    const { data: budget } = await admin.from('budgets').select('*, budget_versions(id, version_number, budget_items(*))').eq('id', budget_id).single();
    if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });

    const versions = (budget as /* // */ any).budget_versions || [];
    const currentVersion = versions.find((v: /* // */ any) => v.version_number === budget.current_version) || versions[0];
    const allItems = currentVersion?.budget_items || [];

    const pending = allItems.filter((i: /* // */ any) => !i.pm_status || i.pm_status === 'pending');
    if (pending.length > 0) {
      return NextResponse.json({ error: `${pending.length} line items still pending review` }, { status: 400 });
    }

    const approved = allItems.filter((i: /* // */ any) => i.pm_status === 'approved');
    const adjusted = allItems.filter((i: /* // */ any) => i.pm_status === 'adjusted');
    const removed = allItems.filter((i: /* // */ any) => i.pm_status === 'removed');
    const approvedTotal = [...approved, ...adjusted].reduce((s: number, i: /* // */ any) => s + Number(i.pm_approved_amount || 0), 0);
    const originalTotal = allItems.reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes || 0), 0);

    const summary = {
      approved_count: approved.length,
      adjusted_count: adjusted.length,
      removed_count: removed.length,
      original_total: originalTotal,
      approved_total: approvedTotal,
      variance: originalTotal - approvedTotal,
    };

    // Update budget
    await admin.from('budgets').update({
      pm_original_total: originalTotal,
      pm_approved_total: approvedTotal,
      pm_review_summary: summary,
    }).eq('id', budget_id);

    // Update version status to pm_approved
    await admin.from('budget_versions').update({
      status: 'pm_approved',
      pm_reviewed_by: user.id,
      pm_reviewed_at: new Date().toISOString(),
    }).eq('id', currentVersion.id);

    // Notify CFO
    const { data: project } = await admin.from('projects').select('name').eq('id', budget.project_id).single();
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await admin.from('notifications').insert({
        user_id: cfo.id,
        title: 'Budget ready for approval',
        message: `${profile?.full_name} reviewed the budget for ${project?.name}. Original: KES ${originalTotal.toLocaleString()}, Approved: KES ${approvedTotal.toLocaleString()} (${summary.adjusted_count} adjusted, ${summary.removed_count} removed).`,
        link: '/budgets/' + budget_id,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'pm_review_submitted',
      table_name: 'budgets',
      record_id: budget_id,
      new_values: summary,
    });

    return NextResponse.json({ success: true, summary });
  }

    return NextResponse.json({ error: 'Invalid action', code: 'BAD_REQUEST' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process line-item review.', 'PM_LINE_REVIEW_ERROR');
  }
}
