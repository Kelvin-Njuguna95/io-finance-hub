import { NextResponse } from 'next/server';
import { createAdminClient, getAuthUserProfile, assertMonthOpen } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

  // Only these roles can create budgets
  if (!['cfo', 'team_leader', 'project_manager', 'accountant'].includes(profile.role)) {
    return NextResponse.json({ error: 'Not authorized to create budgets' }, { status: 403 });
  }

  const body = await request.json();
  const {
    scope_type,
    scope_id,
    year_month,
    notes,
    items,
    submit,
  } = body;

  if (!scope_id || !year_month) {
    return NextResponse.json({ error: 'scope_id and year_month required' }, { status: 400 });
  }

  // Month lock enforcement
  const monthErr = await assertMonthOpen(admin, year_month);
  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: monthErr.status });
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one line item required' }, { status: 400 });
  }
  if (items.some((i: any) => !i.description?.trim())) {
    return NextResponse.json({ error: 'All line items must have a description' }, { status: 400 });
  }

  const isAccountant = profile.role === 'accountant';
  const isTeamLeader = profile.role === 'team_leader';
  const isProjectManager = profile.role === 'project_manager';
  const isCfo = profile.role === 'cfo';

  // TL: verify project assignment
  if (isTeamLeader) {
    const { data: assignment } = await admin
      .from('user_project_assignments')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', scope_id)
      .single();
    if (!assignment) return NextResponse.json({ error: 'Not assigned to this project' }, { status: 403 });
  }


  if (isProjectManager && scope_type !== 'project') {
    return NextResponse.json({ error: 'Project managers can only create project budgets' }, { status: 403 });
  }

  // PM: verify department/project assignment
  if (isProjectManager && scope_type === 'project') {
    const { data: assignment } = await admin
      .from('user_project_assignments')
      .select('id')
      .eq('user_id', user.id)
      .eq('project_id', scope_id)
      .single();
    if (!assignment) return NextResponse.json({ error: 'Not assigned to this project' }, { status: 403 });
  }

  // Determine submitted_by_role
  let submittedByRole = 'team_leader';
  if (isAccountant) submittedByRole = 'accountant';
  else if (isProjectManager) submittedByRole = 'project_manager';
  else if (isCfo) submittedByRole = 'cfo';

  // Determine status by routing chain
  let submitStatus: string;
  if (!submit) {
    submitStatus = 'draft';
  } else if (scope_type === 'department') {
    // Department budgets bypass PM review and go directly to CFO queue
    submitStatus = 'submitted';
  } else if (isProjectManager || isCfo) {
    // PM/CFO project submissions skip PM review
    submitStatus = 'pm_approved';
  } else {
    // TL and accountant project submissions go through PM review
    submitStatus = 'pm_review';
  }

  // Calculate total
  const totalKes = items.reduce((sum: number, i: any) => sum + (i.quantity || 1) * (i.unit_cost_kes || 0), 0);

  // Create budget
  const { data: budget, error: budgetError } = await admin
    .from('budgets')
    .insert({
      project_id: scope_type === 'project' ? scope_id : null,
      department_id: scope_type === 'department' ? scope_id : null,
      year_month,
      current_version: 1,
      created_by: user.id,
      submitted_by_role: submittedByRole,
    })
    .select()
    .single();

  if (budgetError) {
    return NextResponse.json({ error: `Budget creation failed: ${budgetError.message}` }, { status: 500 });
  }

  // Create budget version
  const { data: version, error: versionError } = await admin
    .from('budget_versions')
    .insert({
      budget_id: budget.id,
      version_number: 1,
      status: submitStatus,
      total_amount_usd: 0,
      total_amount_kes: totalKes,
      submitted_by: submit ? user.id : null,
      submitted_at: submit ? new Date().toISOString() : null,
      notes: notes || null,
    })
    .select()
    .single();

  if (versionError) {
    // Rollback budget
    await admin.from('budgets').delete().eq('id', budget.id);
    return NextResponse.json({ error: `Version creation failed: ${versionError.message}` }, { status: 500 });
  }

  // Create budget items
  const itemRows = items.map((item: any, idx: number) => ({
    budget_version_id: version.id,
    description: item.description,
    category: item.category || null,
    amount_usd: 0,
    amount_kes: (item.quantity || 1) * (item.unit_cost_kes || 0),
    quantity: item.quantity || 1,
    unit_cost_usd: 0,
    unit_cost_kes: item.unit_cost_kes || 0,
    notes: item.notes || null,
    sort_order: idx,
  }));

  const { error: itemsError } = await admin.from('budget_items').insert(itemRows);

  if (itemsError) {
    // Rollback
    await admin.from('budget_versions').delete().eq('id', version.id);
    await admin.from('budgets').delete().eq('id', budget.id);
    return NextResponse.json({ error: `Items creation failed: ${itemsError.message}` }, { status: 500 });
  }

    return NextResponse.json({
      success: true,
      budget_id: budget.id,
      version_id: version.id,
      status: submitStatus,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to create budget.', 'BUDGET_CREATE_ERROR');
  }
}
