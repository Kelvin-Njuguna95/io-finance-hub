import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function currentPeriodInEAT(): { yearMonth: string; periodDate: string; day: number } {
  const now = new Date();
  const eatDate = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
  const year = eatDate.getFullYear();
  const month = String(eatDate.getMonth() + 1).padStart(2, '0');
  return {
    yearMonth: `${year}-${month}`,
    periodDate: `${year}-${month}-01`,
    day: eatDate.getDate(),
  };
}

// Cron endpoint: create standing misc draws on 1st day of month.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { yearMonth, periodDate, day } = currentPeriodInEAT();
  if (day !== 1) {
    return NextResponse.json({ skipped: true, reason: 'Not first day of month', yearMonth });
  }

  const { data: allocations, error: allocErr } = await admin
    .from('misc_allocations')
    .select('id, project_id, pm_user_id, monthly_amount')
    .eq('is_active', true);

  if (allocErr) {
    return NextResponse.json({ error: allocErr.message }, { status: 500 });
  }

  let created = 0;
  let skipped = 0;

  for (const alloc of allocations || []) {
    const { data: existing } = await admin
      .from('misc_draws')
      .select('id')
      .eq('project_id', alloc.project_id)
      .eq('period_month', periodDate)
      .eq('draw_type', 'standing')
      .limit(1);

    if (existing && existing.length > 0) {
      skipped++;
      continue;
    }

    const { error } = await admin.from('misc_draws').insert({
      project_id: alloc.project_id,
      pm_user_id: alloc.pm_user_id || null,
      period_month: periodDate,
      draw_type: 'standing',
      amount_requested: alloc.monthly_amount,
      amount_approved: alloc.monthly_amount,
      status: 'approved',
      requested_by: alloc.pm_user_id || null,
    });
    if (!error) created++;
  }

  return NextResponse.json({ success: true, yearMonth, created, skipped });
}
