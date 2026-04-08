import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const auth = await getAuthUserProfile(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  const { user, profile, admin } = auth;

  if (profile.role !== 'cfo') return NextResponse.json({ error: 'CFO only' }, { status: 403 });

  const body = await request.json();
  const { approved_budget_id, sibling_budget_ids, approved_submitted_by_role } = body;

  for (const siblingId of sibling_budget_ids) {
    // Get sibling budget details
    const { data: sibling } = await admin
      .from('budgets')
      .select('id, project_id, year_month, submitted_by_role, created_by, budget_versions(id, status, version_number)')
      .eq('id', siblingId)
      .single();

    if (!sibling) continue;

    // Month lock enforcement (check once per sibling — year_month may differ)
    const monthErr = await assertMonthOpen(admin, sibling.year_month);
    if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

    // Reject all non-final versions
    const versions = (sibling.budget_versions || []) as any[];
    for (const v of versions) {
      if (['rejected', 'approved'].includes(v.status)) continue;

      await admin.from('budget_versions').update({
        status: 'rejected',
        rejection_reason: `Budget settled — a different version was approved as the official budget for this period.`,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', v.id);
    }

    // Notify the submitter
    const { data: submitterProfile } = await admin.from('users').select('full_name').eq('id', sibling.created_by).single();
    await admin.from('notifications').insert({
      user_id: sibling.created_by,
      title: 'Budget Closed',
      message: `Your ${sibling.year_month} budget was closed. The CFO approved a different version for this period.`,
      link: `/budgets/${siblingId}`,
    });

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'budget_auto_rejected_on_cfo_approval',
      table_name: 'budgets',
      record_id: siblingId,
      new_values: {
        rejected_budget_id: siblingId,
        approved_budget_id,
        rejected_submitted_by_role: sibling.submitted_by_role,
        approved_submitted_by_role,
      },
    });
  }

  return NextResponse.json({ success: true });
}
