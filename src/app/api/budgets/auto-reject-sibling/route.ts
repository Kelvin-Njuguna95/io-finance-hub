import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'cfo') return NextResponse.json({ error: 'CFO only' }, { status: 403 });

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
