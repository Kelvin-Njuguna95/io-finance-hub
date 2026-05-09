import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createNotification } from '@/lib/notifications';
import { verifyCronSecret } from '@/lib/cron-auth';
import {
  buildEodSections,
  activityFromPersistedPayload,
  type TodayActivity,
} from '@/lib/eod/sections';
import { renderEodSlackMessage } from '@/lib/eod/render-slack';

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
  return user;
}

/** Add one day to a YYYY-MM-DD string. Africa/Nairobi has no DST so
 *  UTC arithmetic is safe for incrementing the calendar day. */
function nextDayYmd(ymd: string): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

/** Fetch all of today's financial activity.
 *
 * EOD-6: upper bound is next-day midnight (`tomorrow T00:00:00+03:00`),
 * not `today T23:59:59+03:00`. Postgres timestamptz precision is
 * microseconds and the old `<23:59:59` bound silently dropped any row
 * landing in the final second of the day.
 *
 * EOD-7: section-query failures are now thrown rather than rolled out
 * to `[]`. A failed query previously rendered as "no expenses today"
 * indistinguishable from a real no-activity day; that masked schema
 * drift, RLS denials, and network blips.
 */
async function fetchTodayActivity(admin: /* // */ any, today: string) {
  const tomorrow = nextDayYmd(today);
  const dayStart = `${today}T00:00:00+03:00`;
  const dayEnd = `${tomorrow}T00:00:00+03:00`;

  const [
    expRes,
    wdByCreated,
    wdByDate,
    cashByCreated,
    cashByDate,
    budRes,
    predatedPayoutRes,
    predatedCompanyShareRes,
  ] = await Promise.all([
    // Expenses created today
    admin.from('expenses').select('id, description, amount_kes, expense_type, project_id, projects(name), expense_categories(name)')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    // Withdrawals created today
    admin.from('withdrawals').select('id, director_tag, amount_usd, exchange_rate, amount_kes, forex_bureau, withdrawal_date')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    // Withdrawals with withdrawal_date = today (catches entries recorded for today regardless of created_at)
    admin.from('withdrawals').select('id, director_tag, amount_usd, exchange_rate, amount_kes, forex_bureau, withdrawal_date')
      .eq('withdrawal_date', today),
    // Cash received (payments) created today
    admin.from('payments').select('id, amount_usd, amount_kes, payment_date, reference, invoices(invoice_number, projects(name))')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd),
    // Cash received with payment_date = today (captures backfilled entries)
    admin.from('payments').select('id, amount_usd, amount_kes, payment_date, reference, invoices(invoice_number, projects(name))')
      .eq('payment_date', today),
    // Budget actions today
    admin.from('budget_versions').select('id, status, budget_id, budgets(project_id, department_id, projects(name), departments(name))')
      .in('status', ['submitted', 'under_review'])
      .gte('updated_at', dayStart)
      .lt('updated_at', dayEnd),
    // PRED-5: predated payouts (70% project share) recorded today.
    // recorded_at filter mirrors the dayStart/dayEnd bound the rest of
    // the route uses; project FK joins through to projects(name). The
    // director_user_id and recorded_by columns both FK to users — we
    // resolve the director name in a wave-2 fetch below to avoid the
    // multi-FK disambiguation pitfall in the embedded select syntax.
    // PRED-8: deleted_at IS NULL filter hides soft-deleted rows.
    admin.from('predated_payouts')
      .select('id, director_user_id, project_id, year_month, amount_kes, payment_method, recorded_at, projects(name)')
      .gte('recorded_at', dayStart)
      .lt('recorded_at', dayEnd)
      .is('deleted_at', null),
    // PRED-5: predated 30% company-pool distributions recorded today.
    // PRED-8: deleted_at IS NULL filter hides soft-deleted rows.
    admin.from('predated_company_share_distributions')
      .select('id, director_user_id, year_month, amount_kes, payment_method, recorded_at')
      .gte('recorded_at', dayStart)
      .lt('recorded_at', dayEnd)
      .is('deleted_at', null),
  ]);

  const sectionResults: Array<readonly [string, { error?: { message?: string } | null }]> = [
    ['expenses', expRes],
    ['withdrawals_by_created', wdByCreated],
    ['withdrawals_by_date', wdByDate],
    ['payments_by_created', cashByCreated],
    ['payments_by_date', cashByDate],
    ['budget_actions', budRes],
    ['predated_payouts', predatedPayoutRes],
    ['predated_company_shares', predatedCompanyShareRes],
  ];
  for (const [name, res] of sectionResults) {
    if (res.error) {
      throw new Error(
        `EOD section query "${name}" failed: ${res.error.message ?? 'unknown error'}`,
      );
    }
  }

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

  // PRED-5: resolve director_user_id → full_name for both predated
  // streams in a single users-by-id round trip. Cleaner than the
  // embedded multi-FK select syntax (predated tables FK to users twice
  // — director_user_id and recorded_by — disambiguation requires
  // constraint names that vary by environment).
  type PredatedPayoutRaw = {
    id: string;
    director_user_id: string;
    project_id: string;
    year_month: string;
    amount_kes: number | string | null;
    payment_method: string;
    projects?: { name: string | null } | null;
  };
  type PredatedCompanyShareRaw = {
    id: string;
    director_user_id: string;
    year_month: string;
    amount_kes: number | string | null;
    payment_method: string;
  };
  const predatedPayoutsRaw = (predatedPayoutRes.data || []) as PredatedPayoutRaw[];
  const predatedCompanySharesRaw = (predatedCompanyShareRes.data || []) as PredatedCompanyShareRaw[];

  const predatedDirectorIds = new Set<string>();
  for (const r of predatedPayoutsRaw) predatedDirectorIds.add(r.director_user_id);
  for (const r of predatedCompanySharesRaw) predatedDirectorIds.add(r.director_user_id);

  const predatedDirectorNameById = new Map<string, string>();
  if (predatedDirectorIds.size > 0) {
    const { data: dirUsers, error: dirErr } = await admin
      .from('users')
      .select('id, full_name')
      .in('id', Array.from(predatedDirectorIds));
    if (dirErr) {
      throw new Error(
        `EOD section query "predated_directors" failed: ${dirErr.message ?? 'unknown error'}`,
      );
    }
    for (const u of dirUsers ?? []) {
      if (u.id) predatedDirectorNameById.set(u.id, u.full_name ?? 'Unknown director');
    }
  }

  const predatedPayouts = predatedPayoutsRaw.map((r) => ({
    id: r.id,
    director_name:
      predatedDirectorNameById.get(r.director_user_id) ?? 'Unknown director',
    project_name: r.projects?.name ?? null,
    year_month: r.year_month,
    amount_kes: r.amount_kes,
    payment_method: r.payment_method,
  }));

  const predatedCompanyShares = predatedCompanySharesRaw.map((r) => ({
    id: r.id,
    director_name:
      predatedDirectorNameById.get(r.director_user_id) ?? 'Unknown director',
    year_month: r.year_month,
    amount_kes: r.amount_kes,
    payment_method: r.payment_method,
  }));

  return {
    expenses: expRes.data || [],
    withdrawals,
    cashReceipts,
    budgetActions: budRes.data || [],
    predatedPayouts,
    predatedCompanyShares,
  };
}

function formatLongDate(reportDate: string): string {
  // Anchor YYYY-MM-DD at Nairobi midnight so en-KE long-form formatting lands
  // on the same calendar day regardless of server timezone.
  const d = new Date(`${reportDate}T00:00:00+03:00`);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
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

  // Live activity drives `summary` and `has_activity` (used by the panel's
  // new-activity-since-send callout). EOD-7: surface section-query
  // failures as 500 instead of falsely rendering "no activity today".
  let liveActivity: TodayActivity;
  try {
    liveActivity = await fetchTodayActivity(admin, today);
  } catch (err) {
    console.error('EOD GET: section query failed', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load EOD activity',
        code: 'EOD_SECTION_QUERY_FAILED',
      },
      { status: 500 },
    );
  }
  // Two-payload pattern (EOD route summary/sections drift fix):
  //   livePayload     — describes activity *right now*; drives summary
  //                     and has_activity. Always built from liveActivity.
  //   sectionsPayload — describes what was actually sent on a SENT day
  //                     (persisted snapshot) or live activity on a
  //                     not-yet-sent day. Drives the response's
  //                     `sections` field.
  // On a not-yet-sent day the two are reference-equal — no double build.
  // The split exists because the panel's "new activity since send"
  // callout (eod-panel.tsx:141-153) compares summary.* (live) against
  // existing_report.*_count (persisted); collapsing them would silence
  // that callout on a sent day with new activity.
  const reportDateFormatted = formatLongDate(today);
  const livePayload = buildEodSections(liveActivity, {
    reportDate: today,
    reportDateFormatted,
    preparedBy: null,
  });

  let sectionsPayload = livePayload;
  if (existing && existing.payload) {
    let preparedBy: string | null = null;
    if (existing.sent_by) {
      const { data: senderProfile } = await admin
        .from('users')
        .select('full_name')
        .eq('id', existing.sent_by)
        .single();
      preparedBy = senderProfile?.full_name ?? null;
    }
    sectionsPayload = buildEodSections(
      activityFromPersistedPayload(existing.payload),
      { reportDate: today, reportDateFormatted, preparedBy },
    );
  }

  const [
    liveExpenses,
    liveWithdrawals,
    liveCashReceived,
    liveBudgetActions,
    livePredatedPayouts,
    livePredatedCompanyShares,
  ] = livePayload.sections;

  return NextResponse.json({
    report_date: today,
    already_sent: !!existing,
    existing_report: existing,
    has_activity: livePayload.sections.some((s) => s.rows.length > 0),
    summary: {
      expense_count: liveExpenses.rows.length,
      expense_total_kes: liveExpenses.totals.kes,
      withdrawal_count: liveWithdrawals.rows.length,
      cash_received_count: liveCashReceived.rows.length,
      budget_action_count: liveBudgetActions.rows.length,
      predated_payout_count: livePredatedPayouts.rows.length,
      predated_company_share_count: livePredatedCompanyShares.rows.length,
    },
    sections: sectionsPayload,
  });
}

// EOD-2: reserve today's eod_reports row before Slack so concurrent
// first-clicks can't double-deliver the Slack message.
//
// First send: INSERT a placeholder row with slack_status='pending'.
//   - Success → caller is the winner, returns ok=true.
//   - 23505  → another caller already reserved (or finished); on
//              forceResend we fall through to a status-guarded UPDATE,
//              otherwise we bail.
//
// Resend: the row already exists. We attempt a status-guarded UPDATE
// that flips slack_status away from 'pending' to 'pending' (matching
// only rows currently NOT in 'pending' state) so two concurrent resends
// can't both pass.
//
// On either success path the row's slack_status is 'pending' until the
// RPC UPSERT below overwrites it with the real result. The RPC's
// ON CONFLICT (report_date) DO UPDATE replaces every column from the
// EXCLUDED row, so the placeholder's null payload / zero counts are
// fully overwritten on the success path.
async function reserveEodSlot(
  admin: ReturnType<typeof createAdminClient>,
  today: string,
  sentBy: string | null,
  triggerType: string,
): Promise<
  | { ok: true }
  | { ok: false; existingId: string | null; existingStatus: string | null }
> {
  const { error: insertErr } = await admin.from('eod_reports').insert({
    report_date: today,
    sent_by: sentBy,
    trigger_type: triggerType,
    slack_status: 'pending',
    payload: null,
    expense_count: 0,
    withdrawal_count: 0,
    cash_received_count: 0,
    budget_action_count: 0,
    error_message: null,
  });

  if (!insertErr) return { ok: true };

  if (insertErr.code !== '23505') {
    // Unrelated insert error — surface as a failed reservation.
    return { ok: false, existingId: null, existingStatus: null };
  }

  // Row exists. Try to atomically claim it via status-guarded UPDATE.
  const { data: claimed } = await admin
    .from('eod_reports')
    .update({ slack_status: 'pending', error_message: null })
    .eq('report_date', today)
    .neq('slack_status', 'pending')
    .select('id')
    .maybeSingle();

  if (claimed) return { ok: true };

  // Another caller is already mid-flight in 'pending'. Bail.
  const { data: existingRow } = await admin
    .from('eod_reports')
    .select('id, slack_status')
    .eq('report_date', today)
    .maybeSingle();
  return {
    ok: false,
    existingId: existingRow?.id ?? null,
    existingStatus: existingRow?.slack_status ?? null,
  };
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
  } else if (triggerType === 'auto') {
    // EOD-1 fix: the 'auto' path was previously unauthenticated. Now it
    // requires `Authorization: Bearer ${CRON_SECRET}` — same gate the
    // /api/eod/auto-send cron route uses for itself. The cron caller in
    // auto-send/route.ts forwards the secret on its inner fetch.
    // CRON_SECRET must be set in Vercel env; verifyCronSecret returns
    // 500 if it isn't and 401 if the header doesn't match.
    const fail = verifyCronSecret(request);
    if (fail) return fail;
  } else {
    return NextResponse.json({ error: 'trigger_type must be manual or auto' }, { status: 400 });
  }

  const admin = createAdminClient();
  const today = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('/').reverse().join('-');

  // Fast path for the common "already sent today, not forcing a resend"
  // case. Avoids fetching activity unnecessarily.
  const { data: existing } = await admin.from('eod_reports').select('id').eq('report_date', today).single();
  if (existing && !forceResend) {
    return NextResponse.json({ error: 'EOD report already sent today. Pass resend: true to update and resend.', report_id: existing.id }, { status: 409 });
  }

  // EOD-7: bail with 500 on any section-query failure rather than ship a
  // Slack message that falsely claims "no activity today" when a query
  // actually errored. Reservation hasn't happened yet, so no compensating
  // write is needed.
  let activity: TodayActivity;
  try {
    activity = await fetchTodayActivity(admin, today);
  } catch (err) {
    console.error('EOD POST: section query failed (pre-reservation)', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load EOD activity',
        code: 'EOD_SECTION_QUERY_FAILED',
      },
      { status: 500 },
    );
  }
  const {
    expenses,
    withdrawals,
    cashReceipts,
    budgetActions,
    predatedPayouts,
    predatedCompanyShares,
  } = activity;
  const hasActivity =
    expenses.length > 0 ||
    withdrawals.length > 0 ||
    cashReceipts.length > 0 ||
    budgetActions.length > 0 ||
    predatedPayouts.length > 0 ||
    predatedCompanyShares.length > 0;

  if (!hasActivity) {
    return NextResponse.json({ error: 'No qualifying activity today', has_activity: false });
  }

  // EOD-2 fix: reserve the eod_reports row BEFORE Slack to make Slack
  // delivery race-safe. Two concurrent first-clicks would previously
  // both observe `existing=null` above, both POST to Slack, then the
  // RPC's atomic upsert would dedupe the row — but Slack got the
  // message twice. The reservation flips slack_status to 'pending' on
  // the row (using either INSERT for first send, or a status-guarded
  // UPDATE for forceResend) so the losing caller bails out with 409
  // before reaching Slack. The RPC UPSERT below then overwrites the
  // placeholder with the real status / payload / counts.
  const reserved = await reserveEodSlot(admin, today, authUser?.id ?? null, triggerType);
  if (!reserved.ok) {
    return NextResponse.json(
      {
        error: forceResend
          ? 'EOD report resend already in progress for today.'
          : 'EOD report send already in progress for today.',
        report_id: reserved.existingId,
        slack_status: reserved.existingStatus,
      },
      { status: 409 },
    );
  }

  let senderName = 'System (Auto)';
  if (authUser) {
    const { data: profile } = await admin.from('users').select('full_name').eq('id', authUser.id).single();
    senderName = profile?.full_name || 'Unknown';
  }

  const now = new Date();
  const timeEAT = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const dateFormatted = new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  // Single sections payload SoT: drives the Slack render AND the persisted
  // counts on the eod_reports row (RPC args + EOD-8 compensation UPDATE).
  // Sourcing both from one buildEodSections() call keeps the persisted
  // counts in lock-step with whatever Slack reported, so the GET handler's
  // hasNewActivity comparison (eod-panel.tsx:141-153) only fires when
  // reality has changed since send — never because the two reduction
  // sites disagreed.
  const sentPayload = buildEodSections(activity, {
    reportDate: today,
    reportDateFormatted: dateFormatted,
    preparedBy: senderName,
  });
  const [
    sentExpenses,
    sentWithdrawals,
    sentCashReceived,
    sentBudgetActions,
  ] = sentPayload.sections;
  const msg = renderEodSlackMessage(sentPayload, senderName, timeEAT);

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

  // PRED-5: persist predated sections under snake_case keys to match
  // activityFromPersistedPayload's reader. A resend of this day reads
  // back the same shape and reproduces both new sections faithfully.
  const payload = {
    expenses,
    withdrawals,
    cash_receipts: cashReceipts,
    budget_actions: budgetActions,
    predated_payouts: predatedPayouts,
    predated_company_shares: predatedCompanyShares,
    message: msg,
  };

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
    p_expense_count: sentExpenses.rows.length,
    p_withdrawal_count: sentWithdrawals.rows.length,
    p_cash_received_count: sentCashReceived.rows.length,
    p_budget_action_count: sentBudgetActions.rows.length,
  });

  let reportId: string | null = (report as { id?: string } | null)?.id ?? null;

  // EOD-8: if the RPC fails AFTER Slack already happened (or after the
  // reservation was placed), don't leave the row stuck at 'pending'
  // forever. Compensate with a direct UPDATE on the reserved row so
  // slack_status reflects the actual delivery outcome. The RPC's audit
  // and red_flag side effects are lost on this branch — log the gap
  // for forensic visibility but don't fail the user-facing send when
  // Slack already delivered.
  if (rpcErr) {
    console.error(
      `EOD-8: fn_eod_report_send failed (slack_status=${slackStatus}); ` +
      `compensating with direct UPDATE on eod_reports. Audit/red_flag ` +
      `side effects skipped. RPC error: ${rpcErr.message}`,
    );
    const { data: updated, error: updErr } = await admin
      .from('eod_reports')
      .update({
        sent_by: authUser?.id ?? null,
        trigger_type: triggerType,
        slack_status: slackStatus,
        error_message: errorMessage,
        payload,
        expense_count: sentExpenses.rows.length,
        withdrawal_count: sentWithdrawals.rows.length,
        cash_received_count: sentCashReceived.rows.length,
        budget_action_count: sentBudgetActions.rows.length,
      })
      .eq('report_date', today)
      .select('id')
      .maybeSingle();

    if (updErr || !updated) {
      // Compensation also failed. Surface the original RPC error and the
      // fact that the reserved row may be stuck at 'pending'. Slack
      // delivery state is still correct; only the audit row is the gap.
      return NextResponse.json(
        {
          error: `EOD send: ${rpcErr.message}`,
          code: 'EOD_REPORT_SEND_FAILED',
          slack_status: slackStatus,
          slack_message_sent: slackStatus === 'success',
          compensating_update_error: updErr?.message ?? 'row not found',
        },
        { status: 500 },
      );
    }
    reportId = updated.id;
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
    report_id: reportId,
    slack_status: slackStatus,
    error_message: errorMessage,
    resent: !!existing,
    preview: msg,
    ...(rpcErr ? { audit_log_skipped: true } : {}),
  });
}
