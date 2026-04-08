import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const auth = await getAuthUserProfile(request);
  if ('error' in auth) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
  const { user: _user, profile: dbUser, admin } = auth;

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

  // Get the expense before deleting (for audit log)
  const { data: expense, error: fetchErr } = await admin
    .from('expenses')
    .select('*')
    .eq('id', expense_id)
    .single();

  if (fetchErr || !expense) {
    return NextResponse.json({ success: false, error: 'Expense not found' }, { status: 404 });
  }

  // Month lock enforcement
  if (expense.year_month) {
    const monthErr = await assertMonthOpen(admin, expense.year_month);
    if (monthErr) return NextResponse.json({ success: false, error: monthErr.message }, { status: monthErr.status });
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
