import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentYearMonth, getPrevYearMonth } from '@/lib/format';

// Cron endpoint: ensure carry-forward rows from previous month were rolled into current month queue.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const previousMonth = getPrevYearMonth();
  const currentMonth = getCurrentYearMonth();

  const { data: carriedRows, error } = await admin
    .from('pending_expenses')
    .select('*')
    .eq('status', 'carried_forward')
    .eq('year_month', previousMonth);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let created = 0;
  let skipped = 0;

  for (const row of carriedRows || []) {
    const { data: existing } = await admin
      .from('pending_expenses')
      .select('id')
      .eq('budget_item_id', row.budget_item_id)
      .eq('year_month', currentMonth)
      .eq('carry_from_month', previousMonth)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error: insertErr } = await admin.from('pending_expenses').insert({
      budget_id: row.budget_id,
      budget_version_id: row.budget_version_id,
      budget_item_id: row.budget_item_id,
      project_id: row.project_id,
      department_id: row.department_id,
      year_month: currentMonth,
      description: row.description,
      category: row.category,
      budgeted_amount_kes: row.budgeted_amount_kes,
      status: 'pending_auth',
      carry_from_month: previousMonth,
      carry_reason: row.carry_reason || 'Auto rollover cron',
    });
    if (!insertErr) created++;
  }

  return NextResponse.json({ success: true, previousMonth, currentMonth, created, skipped });
}
