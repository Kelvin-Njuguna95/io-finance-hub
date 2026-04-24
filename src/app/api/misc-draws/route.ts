import { NextResponse } from 'next/server';
import { createAdminClient, getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { formatKES } from '@/lib/utils/currency';

/** Legacy helper kept for the GET handler which only needs the auth user */
async function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  return user;
}

/** Convert YYYY-MM to YYYY-MM-01 date string */
function toDateStr(periodMonth: string): string {
  return `${periodMonth}-01`;
}

/** Get previous month in YYYY-MM format */
function prevMonth(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function isProjectLeadRole(role: string): boolean {
  return role === 'project_manager' || role === 'team_leader';
}

// =============================================================
// GET — Misc overview for a project + month
// =============================================================
export async function GET(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const admin = createAdminClient();

  // Parse query params
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const periodMonth = searchParams.get('period_month'); // YYYY-MM

  if (!projectId || !periodMonth) {
    return NextResponse.json({ error: 'project_id and period_month required' }, { status: 400 });
  }

  const periodDate = toDateStr(periodMonth);

  // Get user profile
  const { data: profile } = await admin.from('users').select('role').eq('id', authUser.id).single();
  if (!profile) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });

  // Role check: PM/TL see assigned projects only, CFO/Accountant see all
  if (isProjectLeadRole(profile.role)) {
    const { data: assignment } = await admin.from('user_project_assignments')
      .select('id').eq('user_id', authUser.id).eq('project_id', projectId).single();
    if (!assignment) {
      return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    }
  } else if (!['cfo', 'accountant'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Fetch all data in parallel
  const [
    allocRes,
    drawsRes,
    limitCountRes,
    limitAmountRes,
    freezeRes,
    reportRes,
    prevReportRes,
  ] = await Promise.all([
    // Allocation for this project
    admin.from('misc_allocations')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .single(),
    // All draws for this project + period
    admin.from('misc_draws')
      .select('*')
      .eq('project_id', projectId)
      .eq('period_month', periodDate)
      .order('created_at', { ascending: true }),
    // System settings for limits
    admin.from('system_settings')
      .select('value')
      .eq('key', 'misc_topup_monthly_limit_count')
      .single(),
    admin.from('system_settings')
      .select('value')
      .eq('key', 'misc_topup_monthly_limit_kes')
      .single(),
    // Freeze check
    admin.from('system_settings')
      .select('value')
      .eq('key', `misc_freeze_${projectId}_${periodMonth}`)
      .single(),
    // Report for this month
    admin.from('misc_reports')
      .select('*')
      .eq('project_id', projectId)
      .eq('period_month', periodMonth)
      .single(),
    // Previous month report status
    admin.from('misc_reports')
      .select('status')
      .eq('project_id', projectId)
      .eq('period_month', prevMonth(periodMonth))
      .single(),
  ]);

  const allocation = allocRes.data;
  const draws = drawsRes.data || [];
  const monthlyAmount = allocation?.monthly_amount || 0;

  // Separate standing vs top_up
  const standingDraw = draws.find((d: /* // */ any) => d.draw_type === 'standing') || null;
  const topUps = draws.filter((d: /* // */ any) => d.draw_type === 'top_up');

  const totalDrawn = draws.reduce((s: number, d: /* // */ any) => s + Number(d.amount_approved || 0), 0);
  const remaining = monthlyAmount - totalDrawn;

  const topUpCount = topUps.length;
  const topUpTotal = topUps.reduce((s: number, d: /* // */ any) => s + Number(d.amount_approved || 0), 0);

  // Limits
  const topupLimitCount = parseInt(limitCountRes.data?.value || '3', 10);
  const topupLimitAmount = parseFloat(limitAmountRes.data?.value || '50000');
  const frozen = freezeRes.data?.value === 'true';

    return NextResponse.json({
      allocation: { monthly_amount: monthlyAmount },
      draws,
      standing_draw: standingDraw,
      top_ups: topUps,
      total_drawn: totalDrawn,
      remaining,
      top_up_count: topUpCount,
      top_up_total: topUpTotal,
      limits: {
        topup_limit_count: topupLimitCount,
        topup_limit_amount: topupLimitAmount,
        remaining_count: topupLimitCount - topUpCount,
        remaining_amount: topupLimitAmount - topUpTotal,
        frozen,
      },
      report: reportRes.data || null,
      prev_report_status: prevReportRes.data?.status || null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load misc overview.', 'MISC_GET_ERROR');
  }
}

// =============================================================
// POST — Create draws, flag, freeze/unfreeze
// =============================================================
export async function POST(request: Request) {
  try {
    const authUser = await getAuthUser(request);
    if (!authUser) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const admin = createAdminClient();
  const { data: profile } = await admin.from('users').select('role, full_name').eq('id', authUser.id).single();
  if (!profile) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });

  const body = await request.json();
  const { action, project_id, period_month } = body;

  if (!action || !project_id || !period_month) {
    return NextResponse.json({ error: 'action, project_id, and period_month required' }, { status: 400 });
  }

  const validActions = [
    'draw_standing', 'submit_topup', 'flag_draw', 'freeze_topups', 'unfreeze_topups',
    'accountant_raise', 'pm_approve_draw', 'pm_decline_draw', 'accountant_revise', 'pm_delete_draw', 'accountant_delete_draw',
  ];
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 });
  }

  const periodDate = toDateStr(period_month);

  // Month lock enforcement — block writes to closed/locked months
  const monthErr = await assertMonthOpen(admin, period_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });

  // Get project info for notifications
  const { data: project } = await admin.from('projects').select('name').eq('id', project_id).single();

  // -------------------------------------------------------
  // draw_standing
  // -------------------------------------------------------
  if (action === 'draw_standing') {
    // Only CFO or assigned PM/TL
    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin.from('user_project_assignments')
        .select('id').eq('user_id', authUser.id).eq('project_id', project_id).single();
      if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    } else if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only PM/TL or CFO can draw standing allocation' }, { status: 403 });
    }

    // Get allocation
    const { data: allocation } = await admin.from('misc_allocations')
      .select('*').eq('project_id', project_id).eq('is_active', true).single();
    if (!allocation) {
      return NextResponse.json({ error: 'No active misc allocation for this project' }, { status: 404 });
    }

    // Insert standing draw — rely on idx_misc_draws_one_standing_per_month
    // unique index for enforcement; surface 23505 violations as 409. (F-20)
    const { data: draw, error: drawErr } = await admin.from('misc_draws').insert({
      project_id,
      period_month: periodDate,
      draw_type: 'standing',
      amount_requested: allocation.monthly_amount,
      amount_approved: allocation.monthly_amount,
      status: 'approved',
      requested_by: authUser.id,
    }).select().single();

    if (drawErr) {
      if (drawErr.code === '23505') {
        return NextResponse.json({ error: 'Standing draw already exists for this period' }, { status: 409 });
      }
      return NextResponse.json({ error: drawErr.message }, { status: 500 });
    }

    // Notify PM(s) assigned to this project and Accountants
    const [pmRes, acctRes] = await Promise.all([
      admin.from('user_project_assignments')
        .select('user_id').eq('project_id', project_id),
      admin.from('users').select('id').eq('role', 'accountant'),
    ]);

    const notifyUsers = [
      ...(pmRes.data || []).map((a: /* // */ any) => a.user_id),
      ...(acctRes.data || []).map((a: /* // */ any) => a.id),
    ];

    for (const uid of notifyUsers) {
      await admin.from('notifications').insert({
        user_id: uid,
        title: 'Standing misc draw created',
        message: `Standing misc allocation of ${formatKES(allocation.monthly_amount)} drawn for ${project?.name} (${period_month}).`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    return NextResponse.json({ success: true, draw });
  }

  // -------------------------------------------------------
  // submit_topup
  // -------------------------------------------------------
  if (action === 'submit_topup') {
    const { amount, purpose, urgency } = body;

    if (!amount || !purpose) {
      return NextResponse.json({ error: 'amount and purpose required for top-up' }, { status: 400 });
    }

    // Only PM/TL or CFO
    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin.from('user_project_assignments')
        .select('id').eq('user_id', authUser.id).eq('project_id', project_id).single();
      if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    } else if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only PM/TL or CFO can submit top-ups' }, { status: 403 });
    }

    // Check frozen
    const { data: freezeSetting } = await admin.from('system_settings')
      .select('value').eq('key', `misc_freeze_${project_id}_${period_month}`).single();
    if (freezeSetting?.value === 'true') {
      return NextResponse.json({ error: 'Top-ups are frozen for this project/period by CFO' }, { status: 403 });
    }

    // Check limits
    const { data: existingTopUps } = await admin.from('misc_draws')
      .select('amount_approved')
      .eq('project_id', project_id)
      .eq('period_month', periodDate)
      .eq('draw_type', 'top_up');

    const topUpCount = (existingTopUps || []).length;
    const topUpTotal = (existingTopUps || []).reduce((s: number, d: /* // */ any) => s + Number(d.amount_approved || 0), 0);

    const [limitCountRes, limitAmountRes] = await Promise.all([
      admin.from('system_settings').select('value').eq('key', 'misc_topup_monthly_limit_count').single(),
      admin.from('system_settings').select('value').eq('key', 'misc_topup_monthly_limit_kes').single(),
    ]);

    const topupLimitCount = parseInt(limitCountRes.data?.value || '3', 10);
    const topupLimitAmount = parseFloat(limitAmountRes.data?.value || '50000');

    if (topUpCount >= topupLimitCount) {
      return NextResponse.json({
        error: `Monthly top-up count limit reached (${topupLimitCount}). Contact CFO.`,
        limit: 'count',
      }, { status: 422 });
    }

    if (topUpTotal + amount > topupLimitAmount) {
      return NextResponse.json({
        error: `Top-up would exceed monthly amount limit of ${topupLimitAmount}. Remaining: ${topupLimitAmount - topUpTotal}.`,
        limit: 'amount',
        remaining: topupLimitAmount - topUpTotal,
      }, { status: 422 });
    }

    // Insert top-up draw (self-approved)
    const { data: draw, error: drawErr } = await admin.from('misc_draws').insert({
      project_id,
      period_month: periodDate,
      draw_type: 'top_up',
      amount_requested: amount,
      amount_approved: amount,
      purpose,
      urgency: urgency || 'normal',
      status: 'approved',
      requested_by: authUser.id,
    }).select().single();

    if (drawErr) return NextResponse.json({ error: drawErr.message }, { status: 500 });

    // Notify CFO retrospectively
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await admin.from('notifications').insert({
        user_id: cfo.id,
        title: 'Misc top-up submitted',
        message: `${profile.full_name} submitted a misc top-up of ${formatKES(amount)} for ${project?.name} (${period_month}). Purpose: ${purpose}`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    // Notify Accountant
    const { data: accountants } = await admin.from('users').select('id').eq('role', 'accountant');
    for (const acct of accountants || []) {
      await admin.from('notifications').insert({
        user_id: acct.id,
        title: 'Misc top-up recorded',
        message: `Top-up of ${formatKES(amount)} for ${project?.name} (${period_month}) by ${profile.full_name}.`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_top_up_submitted',
      table_name: 'misc_draws',
      record_id: draw.id,
      old_values: null,
      new_values: { amount, purpose, urgency: urgency || 'normal', project_id, period_month },
    });

    // If limits now reached, create red_flag
    const newTopUpCount = topUpCount + 1;
    const newTopUpTotal = topUpTotal + amount;
    if (newTopUpCount >= topupLimitCount || newTopUpTotal >= topupLimitAmount) {
      await admin.from('red_flags').insert({
        flag_type: 'misc_topup_limit_reached',
        severity: 'high',
        title: `Misc top-up limit reached for ${project?.name}`,
        description: `Top-up count: ${newTopUpCount}/${topupLimitCount}, Total: ${newTopUpTotal}/${topupLimitAmount} for ${period_month}.`,
        project_id,
        year_month: period_month,
        reference_id: draw.id,
        reference_table: 'misc_draws',
      });
    }

    return NextResponse.json({ success: true, draw });
  }

  // -------------------------------------------------------
  // flag_draw
  // -------------------------------------------------------
  if (action === 'flag_draw') {
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can flag draws' }, { status: 403 });
    }

    const { draw_id, flag_reason } = body;
    if (!draw_id || !flag_reason) {
      return NextResponse.json({ error: 'draw_id and flag_reason required' }, { status: 400 });
    }

    const { data: draw, error: drawErr } = await admin.from('misc_draws').update({
      cfo_flagged: true,
      cfo_flag_reason: flag_reason,
      cfo_flagged_by: authUser.id,
      cfo_flagged_at: new Date().toISOString(),
      status: 'flagged',
    }).eq('id', draw_id).select().single();

    if (drawErr) return NextResponse.json({ error: drawErr.message }, { status: 500 });
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });

    // Notify PM(s) assigned to this project
    const { data: pmAssignments } = await admin.from('user_project_assignments')
      .select('user_id').eq('project_id', project_id);

    for (const pm of pmAssignments || []) {
      await admin.from('notifications').insert({
        user_id: pm.user_id,
        title: 'Misc draw flagged by CFO',
        message: `A misc draw for ${project?.name} (${period_month}) has been flagged: ${flag_reason}`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    return NextResponse.json({ success: true, draw });
  }

  // -------------------------------------------------------
  // freeze_topups
  // -------------------------------------------------------
  if (action === 'freeze_topups') {
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can freeze top-ups' }, { status: 403 });
    }

    const settingKey = `misc_freeze_${project_id}_${period_month}`;

    // Upsert: try update first, then insert
    const { data: existing } = await admin.from('system_settings')
      .select('id').eq('key', settingKey).single();

    if (existing) {
      await admin.from('system_settings').update({
        value: 'true',
        updated_by: authUser.id,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await admin.from('system_settings').insert({
        key: settingKey,
        value: 'true',
        description: `Freeze misc top-ups for project ${project_id} period ${period_month}`,
        updated_by: authUser.id,
      });
    }

    // Notify PM(s)
    const { data: pmAssignments } = await admin.from('user_project_assignments')
      .select('user_id').eq('project_id', project_id);

    for (const pm of pmAssignments || []) {
      await admin.from('notifications').insert({
        user_id: pm.user_id,
        title: 'Misc top-ups frozen',
        message: `The CFO has frozen misc top-ups for ${project?.name} (${period_month}). No further top-ups can be submitted.`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    return NextResponse.json({ success: true, frozen: true });
  }

  // -------------------------------------------------------
  // unfreeze_topups
  // -------------------------------------------------------
  if (action === 'unfreeze_topups') {
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can unfreeze top-ups' }, { status: 403 });
    }

    const settingKey = `misc_freeze_${project_id}_${period_month}`;

    // Set value to false (or delete)
    const { data: existing } = await admin.from('system_settings')
      .select('id').eq('key', settingKey).single();

    if (existing) {
      await admin.from('system_settings').update({
        value: 'false',
        updated_by: authUser.id,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    }

    // Notify PM(s)
    const { data: pmAssignments } = await admin.from('user_project_assignments')
      .select('user_id').eq('project_id', project_id);

    for (const pm of pmAssignments || []) {
      await admin.from('notifications').insert({
        user_id: pm.user_id,
        title: 'Misc top-ups unfrozen',
        message: `The CFO has unfrozen misc top-ups for ${project?.name} (${period_month}). You can submit top-ups again.`,
        link: `/misc?project_id=${project_id}&period=${period_month}`,
      });
    }

    return NextResponse.json({ success: true, frozen: false });
  }

  // -------------------------------------------------------
  // accountant_raise — Accountant raises a misc draw on behalf of PM
  // -------------------------------------------------------
  if (action === 'accountant_raise') {
    if (profile.role !== 'accountant') {
      return NextResponse.json({ error: 'Only accountants can raise proxy misc draws' }, { status: 403 });
    }

    const { amount, purpose, draw_type, accountant_notes } = body;
    if (!amount || !purpose) {
      return NextResponse.json({ error: 'amount and purpose required' }, { status: 400 });
    }

    const dtype = draw_type || 'top_up';

    // Get the PM assigned to this project
    const { data: pmAssignment } = await admin.from('user_project_assignments')
      .select('user_id').eq('project_id', project_id).limit(1).single();
    if (!pmAssignment) {
      return NextResponse.json({ error: 'No PM assigned to this project' }, { status: 404 });
    }

    const { data: draw, error: drawErr } = await admin.from('misc_draws').insert({
      project_id,
      pm_user_id: pmAssignment.user_id,
      period_month: periodDate,
      draw_type: dtype,
      amount_requested: amount,
      amount_approved: amount,
      purpose,
      status: 'pending_pm_approval',
      requested_by: pmAssignment.user_id,
      raised_by: authUser.id,
      raised_by_role: 'accountant',
      pm_approval_status: 'pending',
      accountant_notes: accountant_notes || null,
      revision_count: 0,
    }).select().single();

    if (drawErr) return NextResponse.json({ error: drawErr.message }, { status: 500 });

    // Notify the PM
    await admin.from('notifications').insert({
      user_id: pmAssignment.user_id,
      title: 'Misc request needs your approval',
      message: `${profile.full_name} (Accountant) raised a misc draw of ${formatKES(amount)} for ${project?.name} (${period_month}). Purpose: ${purpose}. Please review and approve/decline.`,
      link: `/misc`,
    });

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_accountant_raise',
      table_name: 'misc_draws',
      record_id: draw.id,
      old_values: null,
      new_values: { amount, purpose, project_id, period_month, draw_type: dtype },
    });

    return NextResponse.json({ success: true, draw });
  }

  // -------------------------------------------------------
  // pm_approve_draw — PM approves an accountant-raised draw
  // -------------------------------------------------------
  if (action === 'pm_approve_draw') {
    if (!isProjectLeadRole(profile.role) && profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only PM/TL or CFO can approve draws' }, { status: 403 });
    }

    const { draw_id, approved_amount } = body;
    if (!draw_id) return NextResponse.json({ error: 'draw_id required' }, { status: 400 });

    // PM must be assigned to this project
    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin.from('user_project_assignments')
        .select('id').eq('user_id', authUser.id).eq('project_id', project_id).single();
      if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    }

    const { data: draw } = await admin.from('misc_draws')
      .select('*').eq('id', draw_id).single();
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });
    if (draw.pm_approval_status !== 'pending') {
      return NextResponse.json({ error: 'Draw is not pending approval' }, { status: 400 });
    }

    const finalAmount = approved_amount || draw.amount_requested;

    const { data: updated, error: updErr } = await admin.from('misc_draws').update({
      status: 'approved',
      amount_approved: finalAmount,
      pm_approval_status: 'approved',
      pm_approved_by: authUser.id,
      pm_actioned_at: new Date().toISOString(),
    }).eq('id', draw_id).select().single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Notify the accountant who raised it
    if (draw.raised_by) {
      await admin.from('notifications').insert({
        user_id: draw.raised_by,
        title: 'Misc request approved by PM',
        message: `${profile.full_name} approved your misc draw of ${formatKES(finalAmount)} for ${project?.name} (${period_month}).`,
        link: `/misc`,
      });
    }

    // Notify CFO
    const { data: cfos } = await admin.from('users').select('id').eq('role', 'cfo');
    for (const cfo of cfos || []) {
      await admin.from('notifications').insert({
        user_id: cfo.id,
        title: 'Delegated misc draw approved',
        message: `${profile.full_name} (PM) approved an accountant-raised misc draw of ${formatKES(finalAmount)} for ${project?.name}.`,
        link: `/misc`,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_pm_approve_draw',
      table_name: 'misc_draws',
      record_id: draw_id,
      old_values: { status: draw.status, pm_approval_status: draw.pm_approval_status },
      new_values: { status: 'approved', pm_approval_status: 'approved', amount_approved: finalAmount },
    });

    return NextResponse.json({ success: true, draw: updated });
  }

  // -------------------------------------------------------
  // pm_decline_draw — PM declines an accountant-raised draw
  // -------------------------------------------------------
  if (action === 'pm_decline_draw') {
    if (!isProjectLeadRole(profile.role) && profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only PM/TL or CFO can decline draws' }, { status: 403 });
    }

    const { draw_id, decline_reason } = body;
    if (!draw_id) return NextResponse.json({ error: 'draw_id required' }, { status: 400 });
    if (!decline_reason?.trim()) return NextResponse.json({ error: 'Decline reason required' }, { status: 400 });

    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin.from('user_project_assignments')
        .select('id').eq('user_id', authUser.id).eq('project_id', project_id).single();
      if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    }

    const { data: draw } = await admin.from('misc_draws')
      .select('*').eq('id', draw_id).single();
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });
    if (draw.pm_approval_status !== 'pending') {
      return NextResponse.json({ error: 'Draw is not pending approval' }, { status: 400 });
    }

    const { data: updated, error: updErr } = await admin.from('misc_draws').update({
      status: 'declined',
      pm_approval_status: 'declined',
      pm_approved_by: authUser.id,
      pm_actioned_at: new Date().toISOString(),
      pm_decline_reason: decline_reason,
    }).eq('id', draw_id).select().single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Notify the accountant
    if (draw.raised_by) {
      await admin.from('notifications').insert({
        user_id: draw.raised_by,
        title: 'Misc request declined by PM',
        message: `${profile.full_name} declined your misc draw of ${formatKES(Number(draw.amount_requested))} for ${project?.name}. Reason: ${decline_reason}`,
        link: `/misc`,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_pm_decline_draw',
      table_name: 'misc_draws',
      record_id: draw_id,
      old_values: { status: draw.status, pm_approval_status: draw.pm_approval_status },
      new_values: { status: 'declined', pm_approval_status: 'declined', decline_reason },
    });

    return NextResponse.json({ success: true, draw: updated });
  }

  // -------------------------------------------------------
  // accountant_revise — Accountant revises a declined draw
  // -------------------------------------------------------
  if (action === 'accountant_revise') {
    if (profile.role !== 'accountant') {
      return NextResponse.json({ error: 'Only accountants can revise draws' }, { status: 403 });
    }

    const { draw_id, amount, purpose, accountant_notes } = body;
    if (!draw_id) return NextResponse.json({ error: 'draw_id required' }, { status: 400 });

    const { data: draw } = await admin.from('misc_draws')
      .select('*').eq('id', draw_id).single();
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });
    if (draw.raised_by !== authUser.id) {
      return NextResponse.json({ error: 'You can only revise draws you raised' }, { status: 403 });
    }
    if (draw.pm_approval_status !== 'declined') {
      return NextResponse.json({ error: 'Only declined draws can be revised' }, { status: 400 });
    }

    const updatedFields: Record<string, unknown> = {
      status: 'pending_pm_approval',
      pm_approval_status: 'pending',
      pm_decline_reason: null,
      pm_actioned_at: null,
      pm_approved_by: null,
      revision_count: (draw.revision_count || 0) + 1,
    };
    if (amount) {
      updatedFields.amount_requested = amount;
      updatedFields.amount_approved = amount;
    }
    if (purpose) updatedFields.purpose = purpose;
    if (accountant_notes) updatedFields.accountant_notes = accountant_notes;

    const { data: updated, error: updErr } = await admin.from('misc_draws')
      .update(updatedFields).eq('id', draw_id).select().single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Re-notify the PM
    if (draw.requested_by) {
      await admin.from('notifications').insert({
        user_id: draw.requested_by,
        title: 'Revised misc request needs approval',
        message: `${profile.full_name} revised a previously declined misc draw for ${project?.name}. Revision #${(draw.revision_count || 0) + 1}. Please review.`,
        link: `/misc`,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_accountant_revise',
      table_name: 'misc_draws',
      record_id: draw_id,
      old_values: { status: draw.status, amount_requested: draw.amount_requested },
      new_values: { status: 'pending_pm_approval', amount_requested: amount || draw.amount_requested, revision_count: (draw.revision_count || 0) + 1 },
    });

    return NextResponse.json({ success: true, draw: updated });
  }

  // -------------------------------------------------------
  // pm_delete_draw — PM deletes an approved-but-unspent draw
  // -------------------------------------------------------
  if (action === 'pm_delete_draw') {
    if (!isProjectLeadRole(profile.role) && profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only PM/TL or CFO can delete draws' }, { status: 403 });
    }

    const { draw_id, deletion_reason } = body;
    if (!draw_id) return NextResponse.json({ error: 'draw_id required' }, { status: 400 });
    if (!deletion_reason?.trim()) return NextResponse.json({ error: 'Deletion reason required' }, { status: 400 });

    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin.from('user_project_assignments')
        .select('id').eq('user_id', authUser.id).eq('project_id', project_id).single();
      if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
    }

    const { data: draw } = await admin.from('misc_draws')
      .select('*').eq('id', draw_id).single();
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });
    if (draw.expense_id) {
      return NextResponse.json({ error: 'Cannot delete a draw that has been recorded as an expense. Delete the expense first.' }, { status: 400 });
    }

    const { data: updated, error: updErr } = await admin.from('misc_draws').update({
      status: 'deleted',
      deleted_by: authUser.id,
      deleted_at: new Date().toISOString(),
      deletion_reason,
    }).eq('id', draw_id).select().single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Notify accountant(s)
    const { data: accountants } = await admin.from('users').select('id').eq('role', 'accountant');
    for (const acct of accountants || []) {
      await admin.from('notifications').insert({
        user_id: acct.id,
        title: 'Misc draw deleted by PM',
        message: `${profile.full_name} deleted a misc draw of ${formatKES(Number(draw.amount_approved))} for ${project?.name}. Reason: ${deletion_reason}`,
        link: `/misc`,
      });
    }

    // If raised by accountant, also notify them specifically
    if (draw.raised_by && draw.raised_by_role === 'accountant') {
      await admin.from('notifications').insert({
        user_id: draw.raised_by,
        title: 'Your misc request was deleted',
        message: `${profile.full_name} deleted the misc draw you raised for ${project?.name}. Reason: ${deletion_reason}`,
        link: `/misc`,
      });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: authUser.id,
      action: 'misc_pm_delete_draw',
      table_name: 'misc_draws',
      record_id: draw_id,
      old_values: draw,
      new_values: { status: 'deleted', deletion_reason },
    });

    return NextResponse.json({ success: true, draw: updated });
  }

  // -------------------------------------------------------
  // accountant_delete_draw — Accountant deletes own pending/declined draw
  // -------------------------------------------------------
  if (action === 'accountant_delete_draw') {
    if (profile.role !== 'accountant') {
      return NextResponse.json({ error: 'Only accountants can use this action' }, { status: 403 });
    }

    const { draw_id, deletion_reason } = body;
    if (!draw_id) return NextResponse.json({ error: 'draw_id required' }, { status: 400 });

    const { data: draw } = await admin.from('misc_draws')
      .select('*').eq('id', draw_id).single();
    if (!draw) return NextResponse.json({ error: 'Draw not found' }, { status: 404 });
    if (draw.raised_by !== authUser.id) {
      return NextResponse.json({ error: 'You can only delete draws you raised' }, { status: 403 });
    }
    if (!['pending_pm_approval', 'declined'].includes(draw.status)) {
      return NextResponse.json({ error: 'Only pending or declined draws can be deleted by the accountant' }, { status: 400 });
    }

    const { data: updated, error: updErr } = await admin.from('misc_draws').update({
      status: 'deleted',
      deleted_by: authUser.id,
      deleted_at: new Date().toISOString(),
      deletion_reason: deletion_reason || 'Withdrawn by accountant',
    }).eq('id', draw_id).select().single();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ success: true, draw: updated });
  }

    return NextResponse.json({ error: 'Unhandled action', code: 'BAD_REQUEST' }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process misc action.', 'MISC_POST_ERROR');
  }
}

// =============================================================
// DELETE — Delete a saved misc report line item
// =============================================================
export async function DELETE(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
    }

    const { user, profile, admin } = auth;
    const body = await request.json().catch(() => null);
    const lineItemId = body?.id as string | undefined;

    if (!lineItemId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const { data: lineItem, error: lineItemErr } = await admin
      .from('misc_report_items')
      .select(`
        id,
        description,
        amount,
        expense_date,
        misc_report_id,
        misc_draw_id,
        misc_reports (
          id,
          project_id,
          period_month,
          status,
          total_allocated
        )
      `)
      .eq('id', lineItemId)
      .maybeSingle();

    if (lineItemErr) {
      return NextResponse.json({ error: lineItemErr.message }, { status: 500 });
    }
    if (!lineItem) {
      return NextResponse.json({ error: 'Line item not found' }, { status: 404 });
    }

    const report = Array.isArray(lineItem.misc_reports) ? lineItem.misc_reports[0] : lineItem.misc_reports;
    if (!report?.project_id || !report?.period_month) {
      return NextResponse.json({ error: 'Invalid line item report relationship' }, { status: 400 });
    }

    if (isProjectLeadRole(profile.role)) {
      const { data: assignment } = await admin
        .from('user_project_assignments')
        .select('id')
        .eq('user_id', user.id)
        .eq('project_id', report.project_id)
        .maybeSingle();

      if (!assignment) {
        return NextResponse.json({ error: 'Not authorized to delete line items for this project' }, { status: 403 });
      }
    } else if (!['cfo', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'Not authorized to delete line items' }, { status: 403 });
    }

    const monthErr = await assertMonthOpen(admin, report.period_month);
    if (monthErr) {
      return NextResponse.json({ error: 'Cannot delete items in a closed month' }, { status: 403 });
    }

    const { error: deleteErr } = await admin
      .from('misc_report_items')
      .delete()
      .eq('id', lineItemId);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    const { data: remainingItems } = await admin
      .from('misc_report_items')
      .select('amount')
      .eq('misc_report_id', report.id);

    const updatedTotalClaimed = (remainingItems || []).reduce((sum: number, item: { amount: number }) => sum + Number(item.amount || 0), 0);
    const updatedItemCount = (remainingItems || []).length;
    const variance = Number(report.total_allocated || 0) - updatedTotalClaimed;

    await admin
      .from('misc_reports')
      .update({
        total_claimed: updatedTotalClaimed,
        item_count: updatedItemCount,
        variance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'misc_line_item_deleted',
      table_name: 'misc_report_items',
      record_id: lineItemId,
      old_values: {
        description: lineItem.description,
        amount_kes: lineItem.amount,
        expense_date: lineItem.expense_date,
        project_id: report.project_id,
        misc_report_id: report.id,
      },
      new_values: {
        deleted: true,
        deleted_by_role: profile.role,
      },
    });

    return NextResponse.json({
      success: true,
      warning: ['submitted', 'approved'].includes(report.status)
        ? 'This item is part of a submitted/approved report and report totals were updated.'
        : null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to delete misc line item.', 'MISC_DELETE_ERROR');
  }
}
