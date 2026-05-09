import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';
import { verifyCronSecret } from '@/lib/cron-auth';

// This endpoint is called by a cron job (Vercel Cron or external scheduler)
// It checks if auto-send is enabled, if activity exists, and sends if needed

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Add one day to a YYYY-MM-DD string. Africa/Nairobi has no DST so
 *  UTC arithmetic is safe for incrementing the calendar day. Mirrors
 *  the helper in /api/eod/route.ts. */
function nextDayYmd(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const fail = verifyCronSecret(request);
  if (fail) return fail;

  try {
    const admin = createAdminClient();
    const today = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).split('/').reverse().join('-');

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

  // EOD-6: bound is next-day midnight, not 23:59:59 — Postgres timestamptz
  // is microsecond precision and the old upper bound dropped any row in
  // the final second of the day.
  const tomorrow = nextDayYmd(today);
  const dayStart = `${today}T00:00:00+03:00`;
  const dayEnd = `${tomorrow}T00:00:00+03:00`;

  // Check for qualifying activity
  const [
    expRes,
    wdRes,
    payRes,
    predatedPayoutRes,
    predatedCompanyShareRes,
  ] = await Promise.all([
    admin.from('expenses').select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    admin.from('withdrawals').select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    admin.from('payments').select('id', { count: 'exact', head: true })
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    // PRED-5: predated payouts (70%) recorded today should also trigger
    // auto-send. No settings flag — predated payouts are a deliberate
    // CFO/Accountant action, always significant for the daily digest.
    // PRED-8: deleted_at IS NULL filter hides soft-deleted rows so a
    // record deleted today doesn't trigger tonight's auto-send.
    admin.from('predated_payouts').select('id', { count: 'exact', head: true })
      .gte('recorded_at', dayStart)
      .lt('recorded_at', dayEnd)
      .is('deleted_at', null),
    // PRED-5: predated 30% company-pool distributions, same logic.
    // PRED-8: deleted_at IS NULL filter hides soft-deleted rows.
    admin.from('predated_company_share_distributions')
      .select('id', { count: 'exact', head: true })
      .gte('recorded_at', dayStart)
      .lt('recorded_at', dayEnd)
      .is('deleted_at', null),
  ]);

  // EOD-7: surface section query failures rather than silently treating
  // them as zero counts. A failed query previously rolled out as count=0
  // and auto-send would skip with "no qualifying activity today" —
  // indistinguishable from a real no-activity day.
  for (const [name, res] of [
    ['expenses', expRes],
    ['withdrawals', wdRes],
    ['payments', payRes],
    ['predated_payouts', predatedPayoutRes],
    ['predated_company_shares', predatedCompanyShareRes],
  ] as const) {
    if (res.error) {
      return NextResponse.json(
        {
          error: `EOD auto-send count query "${name}" failed: ${res.error.message}`,
          code: 'EOD_AUTO_SEND_QUERY_FAILED',
        },
        { status: 500 },
      );
    }
  }

  const expenseCount = expRes.count || 0;
  const withdrawalCount = wdRes.count || 0;
  const cashReceivedCount = payRes.count || 0;
  const predatedPayoutCount = predatedPayoutRes.count || 0;
  const predatedCompanyShareCount = predatedCompanyShareRes.count || 0;
  const hasActivity =
    (sendOnExpense && expenseCount > 0)
    || (sendOnWithdrawal && withdrawalCount > 0)
    || (sendOnCashReceived && cashReceivedCount > 0)
    || predatedPayoutCount > 0
    || predatedCompanyShareCount > 0;

  if (!hasActivity) {
    return NextResponse.json({
      skipped: true,
      reason: 'No qualifying activity today',
      trigger_config: { sendOnExpense, sendOnWithdrawal, sendOnCashReceived },
      counts: {
        expenseCount,
        withdrawalCount,
        cashReceivedCount,
        predatedPayoutCount,
        predatedCompanyShareCount,
      },
    });
  }

    // Trigger the EOD report via the main endpoint. Forward the cron
    // secret so /api/eod's 'auto' branch (which used to be unauthenticated
    // — see EOD-1) accepts the call. CRON_SECRET is the same env var
    // verifyCronSecret read above; the inner /api/eod call will 401 if
    // it's missing.
    //
    // EOD-11: fail-closed on missing VERCEL_URL. The previous fallback to
    // the hardcoded prod URL meant a misconfigured preview / non-Vercel
    // runtime would silently fire EOD against production. If we ever need
    // to support a non-Vercel deployment, add a deliberate
    // EOD_SELF_BASE_URL env var as an opt-in — don't add it speculatively.
    if (!process.env.VERCEL_URL) {
      return NextResponse.json(
        {
          success: false,
          error: 'EOD self-URL not configured (VERCEL_URL missing)',
          code: 'EOD_CONFIG_MISSING',
        },
        { status: 500 },
      );
    }
    const appUrl = `https://${process.env.VERCEL_URL}`;

    const cronSecret = process.env.CRON_SECRET;
    const res = await fetch(`${appUrl}/api/eod`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {}),
      },
      body: JSON.stringify({ trigger_type: 'auto' }),
    });

    // EOD-12: surface inner failures rather than always returning 200.
    // 502 because the upstream (the inner /api/eod call) failed; cron
    // monitors typically flag on 5xx, so this surfaces the failure
    // correctly. Distinguishes "auto-send itself broke" (500, via the
    // outer try/catch) from "auto-send worked but inner call failed"
    // (502 here). The inner route returns { error, code, ... } on
    // failure — we passthrough both.
    const result = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            (result as { error?: string } | null)?.error ||
            `Inner EOD call failed (status ${res.status})`,
          code:
            (result as { code?: string } | null)?.code || 'EOD_INNER_FAILED',
          inner_status: res.status,
          inner_result: result,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to run EOD auto-send.', 'EOD_AUTO_SEND_ERROR');
  }
}
