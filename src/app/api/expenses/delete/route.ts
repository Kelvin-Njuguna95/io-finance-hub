import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: dbUser } = await admin.from('users').select('*').eq('id', user.id).single();
  return dbUser;
}

export async function POST(request: Request) {
  const dbUser = await getAuthUser(request);
  if (!dbUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  // Only CFO can delete expenses
  if (dbUser.role !== 'cfo') {
    return NextResponse.json({ success: false, error: 'Only CFO can delete expenses' }, { status: 403 });
  }

  const { expense_id, reason } = await request.json();
  if (!expense_id) {
    return NextResponse.json({ success: false, error: 'expense_id required' }, { status: 400 });
  }
  if (!reason?.trim()) {
    return NextResponse.json({ success: false, error: 'Deletion reason required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Get the expense before deleting (for audit log)
  const { data: expense, error: fetchErr } = await admin
    .from('expenses')
    .select('*')
    .eq('id', expense_id)
    .single();

  if (fetchErr || !expense) {
    return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
  }

  // If this expense was linked from a pending_expense, reset that link
  const { data: linkedPE } = await admin
    .from('pending_expenses')
    .select('id')
    .eq('expense_id', expense_id)
    .maybeSingle();

  if (linkedPE) {
    await admin.from('pending_expenses').update({
      status: 'pending_auth',
      actual_amount_kes: null,
      confirmed_by: null,
      confirmed_at: null,
      expense_id: null,
    }).eq('id', linkedPE.id);
  }

  // Delete the expense
  const { error: delErr } = await admin
    .from('expenses')
    .delete()
    .eq('id', expense_id);

  if (delErr) {
    return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });
  }

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: dbUser.id,
    action: 'expense_deleted',
    table_name: 'expenses',
    record_id: expense_id,
    old_values: expense,
    new_values: null,
    reason,
  });

  return NextResponse.json({ success: true });
}
