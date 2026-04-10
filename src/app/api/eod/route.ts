import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatKES(amount: number): string {
  return `KES ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUSD(amount: number): string {
  return `USD ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/** Build the Slack message text */
function buildMessage(
  expenses: /* // */ /* // */ any[],
  withdrawals: /* // */ /* // */ any[],
  cashReceipts: /* // */ /* // */ any[],
  budgetActions: /* // */ /* // */ any[],
  senderName: string,
  dateFormatted: string,
  timeEAT: string,
): string {
  const totalExpenseKes = expenses.reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
  const totalCashUsd = cashReceipts.reduce((s: number, p: /* // */ any) => s + Number(p.amount_usd || 0), 0);
  const totalCashKes = cashReceipts.reduce((s: number, p: /* // */ any) => s + Number(p.amount_kes || 0), 0);

  let msg = `*IO Finance — End of Day Report*\n`;
  msg += `${dateFormatted} | Prepared by: ${senderName}\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `*Expenses Logged*\n`;
  if (expenses.length === 0) {
    msg += `_None logged today_\n`;
  } else {
    for (const e of expenses) {
      const scope = (e as /* // */ any).projects?.name || 'Shared';
      const cat = (e as /* // */ any).expense_categories?.name || '—';
      msg += `• ${scope} — ${cat} — ${formatKES(Number(e.amount_kes))} — ${e.description}\n`;
    }
    msg += `_Total: ${formatKES(totalExpenseKes)}_\n`;
  }
  msg += `\n`;

  msg += `*Withdrawals Recorded*\n`;
  if (withdrawals.length === 0) {
    msg += `_None recorded today_\n`;
  } else {
    const totalWdUsd = withdrawals.reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
    const totalWdKes = withdrawals.reduce((s: number, w: /* // */ any) => s + Number(w.amount_kes), 0);
    for (const w of withdrawals) {
      const dir = (w as /* // */ any).director_tag?.charAt(0).toUpperCase() + (w as /* // */ any).director_tag?.slice(1);
      msg += `• ${dir} — ${formatUSD(Number(w.amount_usd))} @ ${Number(w.exchange_rate).toFixed(2)} = ${formatKES(Number(w.amount_kes))} — ${w.forex_bureau || '—'}\n`;
    }
    msg += `_Total: ${formatUSD(totalWdUsd)} (${formatKES(totalWdKes)})_\n`;
  }
  msg += `\n`;

  msg += `*Cash Received*\n`;
  if (cashReceipts.length === 0) {
    msg += `_None recorded today_\n`;
  } else {
    for (const p of cashReceipts) {
      const invoiceNumber = (p as /* // */ any).invoices?.invoice_number || 'Unknown invoice';
      const project = (p as /* // */ any).invoices?.projects?.name || 'Unassigned project';
      msg += `• ${project} — ${invoiceNumber} — ${formatUSD(Number(p.amount_usd || 0))} (${formatKES(Number(p.amount_kes || 0))}) — Ref: ${p.reference || '—'}\n`;
    }
    msg += `_Total: ${formatUSD(totalCashUsd)} (${formatKES(totalCashKes)})_\n`;
  }
  msg += `\n`;

  msg += `*Budget Actions*\n`;
  if (budgetActions.length === 0) {
    msg += `_None today_\n`;
  } else {
    for (const b of budgetActions) {
      const scope = (b as /* // */ any).budgets?.projects?.name || (b as /* // */ any).budgets?.departments?.name || '—';
      const status = b.status === 'submitted' ? 'Submitted' : 'Under Review';
      msg += `• ${scope} — ${status}\n`;
    }
  }
  msg += `\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Sent by ${senderName} at ${timeEAT} EAT`;

  return msg;
}

// GET — check today's EOD status and activity
export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

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
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

  const { data: existing } = await admin.from('eod_reports').select('id').eq('report_date', today).single();
  if (existing && !forceResend) {
    return NextResponse.json({ error: 'EOD report already sent today. Pass resend: true to update and resend.', report_id: existing.id }, { status: 409 });
  }

  const { expenses, withdrawals, cashReceipts, budgetActions } = await fetchTodayActivity(admin, today);
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
  const timeEAT = now.toLocaleTimeString('en-US', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false });
  const dateFormatted = now.toLocaleDateString('en-US', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const msg = buildMessage(expenses, withdrawals, cashReceipts, budgetActions, senderName, dateFormatted, timeEAT);

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

  let report: /* // */ any;
  let dbError: /* // */ any;

  if (existing) {
    // Resend: update the existing record with fresh data
    const { data, error } = await admin.from('eod_reports').update({
      sent_by: authUser?.id || null,
      trigger_type: triggerType,
      slack_status: slackStatus,
      payload,
      expense_count: expenses.length,
      withdrawal_count: withdrawals.length,
      cash_received_count: cashReceipts.length,
      budget_action_count: budgetActions.length,
      error_message: errorMessage,
    }).eq('id', existing.id).select().single();
    report = data;
    dbError = error;
  } else {
    const { data, error } = await admin.from('eod_reports').insert({
      report_date: today,
      sent_by: authUser?.id || null,
      trigger_type: triggerType,
      slack_status: slackStatus,
      payload,
      expense_count: expenses.length,
      withdrawal_count: withdrawals.length,
      cash_received_count: cashReceipts.length,
      budget_action_count: budgetActions.length,
      error_message: errorMessage,
    }).select().single();
    report = data;
    dbError = error;
  }

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (slackStatus === 'failed') {
    await admin.from('red_flags').insert({
      flag_type: 'missing_expense_classification',
      severity: 'high',
      title: 'EOD Report Slack delivery failed',
      description: errorMessage,
      year_month: today.substring(0, 7),
    });
    // Notify CFO about failure
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await admin.from('notifications').insert({
        user_id: cfo.id,
        title: 'EOD Report delivery failed',
        message: errorMessage || 'Slack delivery failed. Check webhook configuration.',
        link: '/red-flags',
      });
    }
  }

  // Notify accountants on success
  if (slackStatus === 'success') {
    const { data: accountants } = await admin.from('users').select('id').eq('role', 'accountant');
    for (const acc of accountants || []) {
      await admin.from('notifications').insert({
        user_id: acc.id,
        title: 'EOD Report sent successfully',
        message: `EOD report for ${dateFormatted} sent to Slack.`,
      });
    }
  }

  // Audit log
  await admin.from('audit_logs').insert({
    user_id: authUser?.id || null,
    action: 'eod_report_sent',
    table_name: 'eod_reports',
    record_id: report?.id || null,
    new_values: { slack_status: slackStatus, expenses: expenses.length, withdrawals: withdrawals.length, cash_received: cashReceipts.length },
  });

  return NextResponse.json({
    success: true,
    report_id: report.id,
    slack_status: slackStatus,
    error_message: errorMessage,
    resent: !!existing,
    preview: msg,
  });
}
