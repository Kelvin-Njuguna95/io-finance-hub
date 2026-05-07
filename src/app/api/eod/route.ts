import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createNotification } from '@/lib/notifications';
import { buildEodSections, type TodayActivity } from '@/lib/eod/sections';
import { renderEodSlackMessage } from '@/lib/eod/render-slack';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatKES(amount: number): string {
  return 'KES ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function formatUSD(amount: number): string {
  return `USD ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

async function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  return user;
}

/** Fetch all of today's financial activity */
async function fetchTodayActivity(admin: /* // */ any, today: string) {
  const [expRes, wdByCreated, wdByDate, cashByCreated, cashByDate, budRes] = await Promise.all([
    // Expenses created today
    admin.from('expenses').select('id, description, amount_kes, expense_type, project_id, projects(name), expense_categories(name)')
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
    // Withdrawals created today
    admin.from('withdrawals').select('id, director_tag, amount_usd, exchange_rate, amount_kes, forex_bureau, withdrawal_date')
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
    // Withdrawals with withdrawal_date = today (catches entries recorded for today regardless of created_at)
    admin.from('withdrawals').select('id, director_tag, amount_usd, exchange_rate, amount_kes, forex_bureau, withdrawal_date')
      .eq('withdrawal_date', today),
    // Cash received (payments) created today
    admin.from('payments').select('id, amount_usd, amount_kes, payment_date, reference, invoices(invoice_number, projects(name))')
      .gte('created_at', `${today}T00:00:00+03:00`)
      .lt('created_at', `${today}T23:59:59+03:00`),
    // Cash received with payment_date = today (captures backfilled entries)
    admin.from('payments').select('id, amount_usd, amount_kes, payment_date, reference, invoices(invoice_number, projects(name))')
      .eq('payment_date', today),
    // Budget actions today
    admin.from('budget_versions').select('id, status, budget_id, budgets(project_id, department_id, projects(name), departments(name))')
      .in('status', ['submitted', 'under_review'])
      .gte('updated_at', `${today}T00:00:00+03:00`)
      .lt('updated_at', `${today}T23:59:59+03:00`),
  ]);

  // Merge withdrawals from both queries, dedup by id
  const allWd = [...(wdByCreated.data || []), ...(wdByDate.data || [])];
  const seenIds = new Set<string>();
  const withdrawals = allWd.filter((w: /* // */ any) => {
    if (seenIds.has(w.id)) return false;
    seenIds.add(w.id);
    return true;
  });

  const allPayments = [...(cashByCreated.data || []), ...(cashByDate.data || [])];
  const seenPaymentIds = new Set<string>();
  const cashReceipts = allPayments.filter((p: /* // */ any) => {
    if (seenPaymentIds.has(p.id)) return false;
    seenPaymentIds.add(p.id);
    return true;
  });

  return {
    expenses: expRes.data || [],
    withdrawals,
    cashReceipts,
    budgetActions: budRes.data || [],
  };
}

/** Build the Slack message text via the shared section builder + renderer.
 * Output is byte-identical with the prior inline implementation; verified by
 * scripts/verify-eod-parity.mts. */
function buildMessage(
  activity: TodayActivity,
  senderName: string,
  dateFormatted: string,
  timeEAT: string,
): string {
  const payload = buildEodSections(activity, {
    reportDate: '',
    reportDateFormatted: dateFormatted,
    preparedBy: senderName,
  });
  return renderEodSlackMessage(payload, senderName, timeEAT);
}

// GET — check today's EOD status and activity
export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const today = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('/').reverse().join('-');

  const { data: existing } = await admin
    .from('eod_reports')
    .select('*')
    .eq('report_date', today)
    .single();

  const { expenses, withdrawals, cashReceipts, budgetActions } = await fetchTodayActivity(admin, today);

  const totalExpenseKes = expenses.reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
  const hasActivity = expenses.length > 0 || withdrawals.length > 0 || cashReceipts.length > 0 || budgetActions.length > 0;

  return NextResponse.json({
    report_date: today,
    already_sent: !!existing,
    existing_report: existing,
    has_activity: hasActivity,
    summary: {
      expense_count: expenses.length,
      expense_total_kes: totalExpenseKes,
      withdrawal_count: withdrawals.length,
      cash_received_count: cashReceipts.length,
      budget_action_count: budgetActions.length,
    },
  });
}

// POST — send the EOD report (or resend with fresh data)
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const triggerType = body.trigger_type || 'manual';
  const forceResend = body.resend === true;

  let authUser: /* // */ any = null;
  if (triggerType === 'manual') {
    authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await admin.from('users').select('role, full_name').eq('id', authUser.id).single();
    if (!profile || !['cfo', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'Only CFO or Accountant can send EOD reports' }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const today = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('/').reverse().join('-');

  const { data: existing } = await admin.from('eod_reports').select('id').eq('report_date', today).single();
  if (existing && !forceResend) {
    return NextResponse.json({ error: 'EOD report already sent today. Pass resend: true to update and resend.', report_id: existing.id }, { status: 409 });
  }

  const activity = await fetchTodayActivity(admin, today);
  const { expenses, withdrawals, cashReceipts, budgetActions } = activity;
  const hasActivity = expenses.length > 0 || withdrawals.length > 0 || cashReceipts.length > 0 || budgetActions.length > 0;

  if (!hasActivity) {
    return NextResponse.json({ error: 'No qualifying activity today', has_activity: false });
  }

  let senderName = 'System (Auto)';
  if (authUser) {
    const { data: profile } = await admin.from('users').select('full_name').eq('id', authUser.id).single();
    senderName = profile?.full_name || 'Unknown';
  }

  const now = new Date();
  const timeEAT = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const dateFormatted = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  const msg = buildMessage(activity, senderName, dateFormatted, timeEAT);

  // Send to Slack
  const webhookUrl = process.env.EOD_SLACK_WEBHOOK_URL;
  let slackStatus: 'success' | 'failed' = 'success';
  let errorMessage: string | null = null;

  if (webhookUrl) {
    try {
      const slackRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg }),
      });
      if (!slackRes.ok) {
        slackStatus = 'failed';
        errorMessage = `Slack returned ${slackRes.status}: ${await slackRes.text()}`;
      }
    } catch (err) {
      slackStatus = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  } else {
    slackStatus = 'failed';
    errorMessage = 'EOD_SLACK_WEBHOOK_URL not configured';
  }

  const payload = { expenses, withdrawals, cash_receipts: cashReceipts, budget_actions: budgetActions, message: msg };

  // Atomic DB write: eod_reports upsert + conditional red_flag insert in one transaction.
  // Slack delivery already happened above; slack_status / errorMessage carry the result.
  // Audit log is inserted internally by the RPC with full p_sent_by attribution
  // (NULL accepted on the auto-send cron path — system-generated reports legitimately
  // have no user attribution).
  const { data: report, error: rpcErr } = await admin.rpc('fn_eod_report_send', {
    p_report_date: today,
    p_sent_by: authUser?.id || null,
    p_trigger_type: triggerType,
    p_slack_status: slackStatus,
    p_error_message: errorMessage,
    p_payload: payload,
    p_expense_count: expenses.length,
    p_withdrawal_count: withdrawals.length,
    p_cash_received_count: cashReceipts.length,
    p_budget_action_count: budgetActions.length,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message, code: 'EOD_REPORT_SEND_FAILED' }, { status: 500 });
  }

  // Notifications post-RPC (mirrors 00042's notifications-post-RPC pattern).
  if (slackStatus === 'failed') {
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await createNotification(admin, {
        userId: cfo.id,
        title: 'EOD Report delivery failed',
        message: errorMessage || 'Slack delivery failed. Check webhook configuration.',
        link: '/red-flags',
      });
    }
  } else if (slackStatus === 'success') {
    const { data: accountants } = await admin.from('users').select('id').eq('role', 'accountant');
    for (const acc of accountants || []) {
      await createNotification(admin, {
        userId: acc.id,
        title: 'EOD Report sent successfully',
        message: `EOD report for ${dateFormatted} sent to Slack.`,
      });
    }
  }

  return NextResponse.json({
    success: true,
    report_id: (report as { id: string }).id,
    slack_status: slackStatus,
    error_message: errorMessage,
    resent: !!existing,
    preview: msg,
  });
}
