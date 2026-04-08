import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// This endpoint is called by a cron job (Vercel Cron or external scheduler)
// It checks if auto-send is enabled, if activity exists, and sends if needed

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET() {
  const admin = createAdminClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

  // Check if auto-send is enabled + trigger sources
  const { data: settings } = await admin
    .from('system_settings')
    .select('key, value')
    .in('key', [
      'eod_auto_send_enabled',
      'eod_auto_send_on_expense',
      'eod_auto_send_on_withdrawal',
      'eod_auto_send_on_cash_received',
    ]);

  const map = new Map((settings || []).map((s: { key: string; value: string }) => [s.key, s.value]));
  const enabled = map.get('eod_auto_send_enabled') === 'true';
  const sendOnExpense = map.get('eod_auto_send_on_expense') !== 'false';
  const sendOnWithdrawal = map.get('eod_auto_send_on_withdrawal') !== 'false';
  const sendOnCashReceived = map.get('eod_auto_send_on_cash_received') !== 'false';

  if (!enabled) {
    return NextResponse.json({ skipped: true, reason: 'Auto-send disabled' });
  }

  // Check if already sent today
  const { data: existing } = await admin
    .from('eod_reports')
    .select('id')
    .eq('report_date', today)
    .single();

  if (existing) {
    return NextResponse.json({ skipped: true, reason: 'Report already sent today' });
  }

  // Check for qualifying activity
  const [expRes, wdRes, payRes] = await Promise.all([
    admin.from('expenses').select('id', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
    admin.from('withdrawals').select('id', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
    admin.from('payments').select('id', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
  ]);

  const expenseCount = expRes.count || 0;
  const withdrawalCount = wdRes.count || 0;
  const cashReceivedCount = payRes.count || 0;
  const hasActivity = (sendOnExpense && expenseCount > 0)
    || (sendOnWithdrawal && withdrawalCount > 0)
    || (sendOnCashReceived && cashReceivedCount > 0);

  if (!hasActivity) {
    return NextResponse.json({
      skipped: true,
      reason: 'No qualifying activity today',
      trigger_config: { sendOnExpense, sendOnWithdrawal, sendOnCashReceived },
      counts: { expenseCount, withdrawalCount, cashReceivedCount },
    });
  }

  // Trigger the EOD report via the main endpoint
  const appUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://io-finance-hub.vercel.app';

  try {
    const res = await fetch(`${appUrl}/api/eod`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_type: 'auto' }),
    });

    const result = await res.json();
    return NextResponse.json({ sent: true, result });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
