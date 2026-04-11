import { NextResponse } from 'next/server';
import { createAdminClient, assertMonthOpen } from '@/lib/supabase/admin';

async function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: dbUser } = await admin.from('users').select('*').eq('id', user.id).single();
  return dbUser;
}

/** Increment YYYY-MM by one month */
function nextMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m, 1); // m is already 1-based, so this gives next month
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** Notify all users with a given role */
async function notifyRole(
  admin: ReturnType<typeof createAdminClient>,
  role: string,
  title: string,
  message: string,
  link?: string,
) {
  const { data: users } = await admin.from('users').select('id').eq('role', role);
  for (const u of users || []) {
    await admin.from('notifications').insert({
      user_id: u.id,
      title,
      message,
      link,
    });
  }
}

function isMiscBudgetItem(item: { category?: string | null; description?: string | null }) {
  const category = (item.category || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  return category.includes('misc') || description.includes('misc');
}

async function autoLogBudgetMiscDraws(
  admin: ReturnType<typeof createAdminClient>,
  dbUser: /* // */ any,
  budget: /* // */ any,
  budgetItems: /* // */ /* // */ any[],
) {
  if (!budget?.project_id || !budget?.year_month || !budgetItems.length) return 0;

  const miscItems = budgetItems
    .filter((item: /* // */ any) => isMiscBudgetItem(item))
    .filter((item: /* // */ any) => Number(item.pm_approved_amount != null ? item.pm_approved_amount : item.amount_kes) > 0);

  if (!miscItems.length) return 0;

  const { data: existingDraws } = await admin
    .from('misc_draws')
    .select('budget_item_id')
    .in('budget_item_id', miscItems.map((item: /* // */ any) => item.id));
  const existing = new Set((existingDraws || []).map((d: /* // */ any) => d.budget_item_id).filter(Boolean));

  const { data: assignment } = await admin
    .from('user_project_assignments')
    .select('user_id')
    .eq('project_id', budget.project_id)
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  const rows = miscItems
    .filter((item: /* // */ any) => !existing.has(item.id))
    .map((item: /* // */ any) => {
      const amount = Number(item.pm_approved_amount != null ? item.pm_approved_amount : item.amount_kes);
      return {
        project_id: budget.project_id,
        period_month: `${budget.year_month}-01`,
        draw_type: 'top_up',
        amount_requested: amount,
        amount_approved: amount,
        purpose: `Budget-approved misc line: ${item.description}`,
        status: 'approved',
        budget_item_id: item.id,
        requested_by: assignment?.user_id || dbUser.id,
        pm_user_id: assignment?.user_id || null,
        raised_by: dbUser.id,
        raised_by_role: dbUser.role,
        pm_approval_status: 'approved',
        pm_approved_by: dbUser.id,
        pm_actioned_at: now,
        accountant_notes: 'Auto-created from approved budget miscellaneous line item.',
      };
    });

  if (!rows.length) return 0;
  const { data: inserted, error } = await admin.from('misc_draws').insert(rows).select('id');
  if (error) throw error;

  return inserted?.length || 0;
}

// =============================================================
// GET  Fetch pending expenses with optional filters
// =============================================================
export async function GET(request: Request) {
  const dbUser = await getAuthUser(request);
  if (!dbUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);

  const yearMonth = searchParams.get('year_month');
  const projectId = searchParams.get('project_id');
  const status = searchParams.get('status');
  const category = searchParams.get('category');

  let query = admin.from('pending_expenses').select('*');

  if (yearMonth) query = query.eq('year_month', yearMonth);
  if (projectId) query = query.eq('project_id', projectId);
  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data });
}

// =============================================================
// POST  Perform lifecycle actions on pending expenses
// =============================================================
export async function POST(request: Request) {
  const dbUser = await getAuthUser(request);
  if (!dbUser) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const body = await request.json();
  const { action } = body;

  const validActions = [
    'auto_populate',
    'backfill',
    'confirm',
    'modify',
    'under_review',
    'void',
    'carry_forward',
    'bulk_confirm',
    'recompute_variances',
  ];

  if (!action || !validActions.includes(action)) {
    return NextResponse.json({
      success: false,
      error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
    }, { status: 400 });
  }

  const isCfo = dbUser.role === 'cfo';
  const isAccountant = dbUser.role === 'accountant';
  const isCfoOrAccountant = isCfo || isAccountant;

  // -----------------------------------------------------------
  // auto_populate
  // -----------------------------------------------------------
  if (action === 'auto_populate') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can auto-populate expenses' }, { status: 403 });
    }

    const { budget_version_id, budget_id } = body;
    if (!budget_version_id && !budget_id) {
      return NextResponse.json({ success: false, error: 'budget_version_id or budget_id required' }, { status: 400 });
    }

    // Get budget version and its items
    let budgetVersion: /* // */ any = null;
    if (budget_version_id) {
      const { data } = await admin
        .from('budget_versions')
        .select('*, budget_items(*)')
        .eq('id', budget_version_id)
        .single();
      budgetVersion = data;
    } else {
      const { data } = await admin
        .from('budget_versions')
        .select('*, budget_items(*)')
        .eq('budget_id', budget_id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      budgetVersion = data;
    }

    if (!budgetVersion) {
      return NextResponse.json({ success: false, error: 'Budget version not found' }, { status: 404 });
    }

    // Get budget to find project_id, department_id, year_month
    const { data: budget } = await admin
      .from('budgets')
      .select('*')
      .eq('id', budgetVersion.budget_id)
      .single();

    if (!budget) {
      return NextResponse.json({ success: false, error: 'Budget not found' }, { status: 404 });
    }

    // Month lock enforcement
    const monthErr = await assertMonthOpen(admin, budget.year_month);
    if (monthErr) return NextResponse.json({ success: false, error: monthErr.message }, { status: monthErr.status });

    // Filter items: include only PM-approved or adjusted items
    const allItems = budgetVersion.budget_items || [];
    const eligibleItems = allItems.filter((item: /* // */ any) => ['approved', 'adjusted'].includes(item.pm_status));

    if (eligibleItems.length === 0) {
      return NextResponse.json({ success: false, error: 'No eligible budget items found' }, { status: 400 });
    }

    // Check for duplicates — skip items already in pending_expenses
    const existingItemIds = new Set<string>();
    const { data: existingPE } = await admin
      .from('pending_expenses')
      .select('budget_item_id')
      .eq('budget_id', budget.id);
    (existingPE || []).forEach((pe: /* // */ any) => existingItemIds.add(pe.budget_item_id));

    const newItems = eligibleItems.filter((item: /* // */ any) => !existingItemIds.has(item.id));
    if (newItems.length === 0) {
      return NextResponse.json({ success: true, data: [], message: 'All items already populated' });
    }

    const pendingRows = newItems.map((item: /* // */ any) => {
      const budgetedAmountKes = item.pm_status === 'adjusted'
        ? item.pm_approved_amount
        : item.amount_kes;

      return {
        budget_id: budget.id,
        budget_version_id: budgetVersion.id,
        budget_item_id: item.id,
        project_id: budget.project_id,
        department_id: budget.department_id,
        year_month: budget.year_month,
        description: item.description,
        category: item.category,
        budgeted_amount_kes: budgetedAmountKes,
        actual_amount_kes: null,
        status: 'pending_auth',
      };
    });

    const { data: inserted, error: insertErr } = await admin
      .from('pending_expenses')
      .insert(pendingRows)
      .select();

    if (insertErr) {
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
    }

    let miscLogged = 0;
    try {
      miscLogged = await autoLogBudgetMiscDraws(admin, dbUser, budget, newItems);
    } catch (miscErr: /* // */ any) {
      console.error('Failed to auto-log misc items from budget:', miscErr?.message || miscErr);
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_auto_populate',
      table_name: 'pending_expenses',
      record_id: budgetVersion.id,
      old_values: null,
      new_values: { count: inserted?.length, budget_id: budget.id, year_month: budget.year_month },
    });

    // Notify relevant users
    await notifyRole(admin, 'cfo', 'Pending expenses auto-populated', `${inserted?.length} pending expense(s) created from budget for ${budget.year_month}.`, '/expenses/queue');
    await notifyRole(admin, 'accountant', 'Pending expenses auto-populated', `${inserted?.length} pending expense(s) created from budget for ${budget.year_month}.`, '/expenses/queue');

    return NextResponse.json({ success: true, data: inserted, misc_logged: miscLogged });
  }

  // -----------------------------------------------------------
  // backfill — populate pending expenses for ALL already-approved budgets
  // -----------------------------------------------------------
  if (action === 'backfill') {
    if (!isCfo) {
      return NextResponse.json({ success: false, error: 'Only CFO can backfill' }, { status: 403 });
    }

    const yearMonth = body.year_month;

    // Find all approved budget versions
    const budgetQuery = admin
      .from('budget_versions')
      .select('id, budget_id, budget_items(*)')
      .eq('status', 'approved');

    const { data: approvedVersions, error: avErr } = await budgetQuery;
    if (avErr) {
      return NextResponse.json({ success: false, error: avErr.message }, { status: 500 });
    }

    let totalCreated = 0;
    for (const bv of approvedVersions || []) {
      const { data: budget } = await admin
        .from('budgets')
        .select('id, project_id, department_id, year_month')
        .eq('id', bv.budget_id)
        .single();
      if (!budget) continue;
      if (yearMonth && budget.year_month !== yearMonth) continue;

      const allItems = (bv as /* // */ any).budget_items || [];
      const hasLineReview = allItems.some((item: /* // */ any) => ['approved', 'adjusted', 'removed'].includes(item.pm_status));
      const eligibleItems = hasLineReview
        ? allItems.filter((item: /* // */ any) => ['approved', 'adjusted'].includes(item.pm_status))
        : allItems.filter((item: /* // */ any) => item.pm_status !== 'removed');

      // Skip items already populated
      const { data: existingPE } = await admin
        .from('pending_expenses')
        .select('budget_item_id')
        .eq('budget_version_id', bv.id);
      const existingIds = new Set((existingPE || []).map((pe: /* // */ any) => pe.budget_item_id));
      const newItems = eligibleItems.filter((item: /* // */ any) => !existingIds.has(item.id));

      if (newItems.length === 0) continue;

      const rows = newItems.map((item: /* // */ any) => ({
        budget_id: budget.id,
        budget_version_id: bv.id,
        budget_item_id: item.id,
        project_id: budget.project_id,
        department_id: budget.department_id,
        year_month: budget.year_month,
        description: item.description,
        category: item.category,
        budgeted_amount_kes: item.pm_approved_amount != null ? item.pm_approved_amount : 0,
        status: 'pending_auth',
      }));

      const { error: insErr } = await admin.from('pending_expenses').insert(rows);
      if (!insErr) totalCreated += rows.length;

      try {
        await autoLogBudgetMiscDraws(admin, dbUser, budget, newItems);
      } catch (miscErr: /* // */ any) {
        console.error('Backfill misc auto-log failed:', miscErr?.message || miscErr);
      }
    }

    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_backfill',
      table_name: 'pending_expenses',
      new_values: { total_created: totalCreated },
    });

    return NextResponse.json({ success: true, data: { total_created: totalCreated } });
  }

  // -----------------------------------------------------------
  // confirm
  // -----------------------------------------------------------
  if (action === 'confirm') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can confirm expenses' }, { status: 403 });
    }

    const { id, actual_amount_kes } = body;
    if (!id || actual_amount_kes == null) {
      return NextResponse.json({ success: false, error: 'id and actual_amount_kes required' }, { status: 400 });
    }
    if (Number(actual_amount_kes) <= 0) {
      return NextResponse.json({ success: false, error: 'actual_amount_kes must be greater than 0' }, { status: 400 });
    }

    // Get the pending expense
    const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Pending expense not found' }, { status: 404 });
    }

    // Month lock enforcement
    const confirmMonthErr = await assertMonthOpen(admin, pending.year_month);
    if (confirmMonthErr) return NextResponse.json({ success: false, error: confirmMonthErr.message }, { status: confirmMonthErr.status });

    if (!['pending_auth', 'under_review', 'modified'].includes(pending.status)) {
      return NextResponse.json({ success: false, error: `Cannot confirm expense in status ${pending.status}` }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Look up expense_category_id from the category text
    let expenseCategoryId: string | null = null;
    if (pending.category) {
      const { data: cat } = await admin
        .from('expense_categories')
        .select('id')
        .eq('name', pending.category)
        .maybeSingle();
      expenseCategoryId = cat?.id || null;
    }

    // For shared expenses (department budgets), look up overhead_category_id
    let overheadCategoryId: string | null = null;
    if (!pending.project_id && pending.department_id && pending.category) {
      const { data: ohCat } = await admin
        .from('overhead_categories')
        .select('id')
        .eq('name', pending.category)
        .maybeSingle();
      overheadCategoryId = ohCat?.id || null;
    }

    const isProjectExpense = !!pending.project_id;

    // Create a real expense in the expenses table
    const { data: expense, error: expErr } = await admin.from('expenses').insert({
      budget_id: pending.budget_id,
      budget_version_id: pending.budget_version_id,
      expense_type: isProjectExpense ? 'project_expense' : 'shared_expense',
      project_id: pending.project_id,
      overhead_category_id: isProjectExpense ? null : overheadCategoryId,
      expense_category_id: expenseCategoryId,
      description: pending.description,
      amount_usd: 0,
      amount_kes: actual_amount_kes,
      expense_date: now.split('T')[0],
      year_month: pending.year_month,
      vendor: null,
      receipt_reference: null,
      notes: `Confirmed from pending expense ${id}`,
      entered_by: dbUser.id,
    }).select().single();

    if (expErr) {
      return NextResponse.json({ success: false, error: expErr.message }, { status: 500 });
    }

    // Update the pending expense
    const { data: updated, error: updErr } = await admin.from('pending_expenses').update({
      status: 'confirmed',
      actual_amount_kes,
      confirmed_by: dbUser.id,
      confirmed_at: now,
      expense_id: expense?.id,
    }).eq('id', id).select().single();

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    // Check variance and create red flag if needed
    await checkVarianceRedFlag(admin, dbUser, pending, actual_amount_kes);

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_confirmed',
      table_name: 'pending_expenses',
      record_id: id,
      old_values: { status: pending.status },
      new_values: { status: 'confirmed', actual_amount_kes, expense_id: expense?.id },
    });

    // Notify
    await notifyRole(admin, 'cfo', 'Expense confirmed', `Pending expense "${pending.description}" confirmed at KES ` + actual_amount_kes.toLocaleString() + ` for ${pending.year_month}.`, '/expenses');
    await recomputeExpenseVariancesForMonth(admin, pending.year_month);

    return NextResponse.json({ success: true, data: updated });
  }

  // -----------------------------------------------------------
  // modify
  // -----------------------------------------------------------
  if (action === 'modify') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can modify expenses' }, { status: 403 });
    }

    const { id, actual_amount_kes, modified_reason } = body;
    if (!id || actual_amount_kes == null || !modified_reason?.trim()) {
      return NextResponse.json({ success: false, error: 'id, actual_amount_kes, and modified_reason required' }, { status: 400 });
    }
    if (Number(actual_amount_kes) <= 0) {
      return NextResponse.json({ success: false, error: 'actual_amount_kes must be greater than 0' }, { status: 400 });
    }

    const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Pending expense not found' }, { status: 404 });
    }

    // Month lock enforcement
    const modifyMonthErr = await assertMonthOpen(admin, pending.year_month);
    if (modifyMonthErr) return NextResponse.json({ success: false, error: modifyMonthErr.message }, { status: modifyMonthErr.status });

    if (!['pending_auth', 'under_review'].includes(pending.status)) {
      return NextResponse.json({ success: false, error: `Cannot modify expense in status ${pending.status}` }, { status: 400 });
    }

    const now = new Date().toISOString();

    let expenseCategoryId: string | null = null;
    if (pending.category) {
      const { data: cat } = await admin.from('expense_categories').select('id').eq('name', pending.category).maybeSingle();
      expenseCategoryId = cat?.id || null;
    }

    let overheadCategoryId: string | null = null;
    if (!pending.project_id && pending.department_id && pending.category) {
      const { data: ohCat } = await admin.from('overhead_categories').select('id').eq('name', pending.category).maybeSingle();
      overheadCategoryId = ohCat?.id || null;
    }

    const isProjectExpense = !!pending.project_id;
    const { data: expense, error: expErr } = await admin.from('expenses').insert({
      budget_id: pending.budget_id,
      budget_version_id: pending.budget_version_id,
      expense_type: isProjectExpense ? 'project_expense' : 'shared_expense',
      project_id: pending.project_id,
      overhead_category_id: isProjectExpense ? null : overheadCategoryId,
      expense_category_id: expenseCategoryId,
      description: pending.description,
      amount_usd: 0,
      amount_kes: actual_amount_kes,
      expense_date: now.split('T')[0],
      year_month: pending.year_month,
      vendor: null,
      receipt_reference: null,
      notes: `Modified & confirmed from pending expense ${id}. Reason: ${modified_reason}`,
      entered_by: dbUser.id,
    }).select().single();

    if (expErr) {
      return NextResponse.json({ success: false, error: expErr.message }, { status: 500 });
    }

    const { data: updated, error: updErr } = await admin.from('pending_expenses').update({
      status: 'confirmed',
      actual_amount_kes,
      modified_reason,
      confirmed_by: dbUser.id,
      confirmed_at: now,
      expense_id: expense?.id,
    }).eq('id', id).select().single();

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    await checkVarianceRedFlag(admin, dbUser, pending, actual_amount_kes);

    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_modified',
      table_name: 'pending_expenses',
      record_id: id,
      old_values: { status: pending.status, budgeted_amount_kes: pending.budgeted_amount_kes },
      new_values: { status: 'confirmed', actual_amount_kes, modified_reason, expense_id: expense?.id },
    });

    await notifyRole(admin, 'cfo', 'Expense modified', `Pending expense "${pending.description}" modified to KES ` + actual_amount_kes.toLocaleString() + `. Reason: ${modified_reason}`, '/expenses');
    await recomputeExpenseVariancesForMonth(admin, pending.year_month);

    return NextResponse.json({ success: true, data: updated });
  }

  // -----------------------------------------------------------
  // under_review
  // -----------------------------------------------------------
  if (action === 'under_review') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can flag expenses for review' }, { status: 403 });
    }

    const { id, review_notes } = body;
    if (!id || !review_notes?.trim()) {
      return NextResponse.json({ success: false, error: 'id and review_notes required' }, { status: 400 });
    }

    const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Pending expense not found' }, { status: 404 });
    }

    // Month lock enforcement
    const urMonthErr = await assertMonthOpen(admin, pending.year_month);
    if (urMonthErr) return NextResponse.json({ success: false, error: urMonthErr.message }, { status: urMonthErr.status });

    const { data: updated, error: updErr } = await admin.from('pending_expenses').update({
      status: 'under_review',
      review_notes: review_notes.trim(),
      reviewed_by: dbUser.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id).select().single();

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_under_review',
      table_name: 'pending_expenses',
      record_id: id,
      old_values: { status: pending.status },
      new_values: { status: 'under_review', review_notes },
    });

    await notifyRole(admin, 'accountant', 'Expense flagged for review', `Expense "${pending.description}" flagged for review. ${review_notes ? 'Notes: ' + review_notes : ''}`, '/expenses');
    await recomputeExpenseVariancesForMonth(admin, pending.year_month);

    return NextResponse.json({ success: true, data: updated });
  }

  // -----------------------------------------------------------
  // void
  // -----------------------------------------------------------
  if (action === 'void') {
    if (!isCfo) {
      return NextResponse.json({ success: false, error: 'Only CFO can void expenses' }, { status: 403 });
    }

    const { id, void_reason } = body;
    if (!id || !void_reason?.trim()) {
      return NextResponse.json({ success: false, error: 'id and void_reason required' }, { status: 400 });
    }

    const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Pending expense not found' }, { status: 404 });
    }

    // Month lock enforcement
    const voidMonthErr = await assertMonthOpen(admin, pending.year_month);
    if (voidMonthErr) return NextResponse.json({ success: false, error: voidMonthErr.message }, { status: voidMonthErr.status });

    const now = new Date().toISOString();

    const { data: updated, error: updErr } = await admin.from('pending_expenses').update({
      status: 'voided',
      void_reason,
      voided_by: dbUser.id,
      voided_at: now,
    }).eq('id', id).select().single();

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_voided',
      table_name: 'pending_expenses',
      record_id: id,
      old_values: { status: pending.status },
      new_values: { status: 'voided', void_reason },
    });

    await notifyRole(admin, 'accountant', 'Expense voided', `CFO voided expense "${pending.description}" for ${pending.year_month}. Reason: ${void_reason}`, '/expenses');
    await recomputeExpenseVariancesForMonth(admin, pending.year_month);

    return NextResponse.json({ success: true, data: updated });
  }

  // -----------------------------------------------------------
  // carry_forward
  // -----------------------------------------------------------
  if (action === 'carry_forward') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can carry forward expenses' }, { status: 403 });
    }

    const { id, carry_reason, target_month } = body;
    if (!id || !carry_reason?.trim() || !target_month) {
      return NextResponse.json({ success: false, error: 'id, carry_reason, and target_month required' }, { status: 400 });
    }

    const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Pending expense not found' }, { status: 404 });
    }

    // Month lock enforcement — check the source month
    const cfMonthErr = await assertMonthOpen(admin, pending.year_month);
    if (cfMonthErr) return NextResponse.json({ success: false, error: cfMonthErr.message }, { status: cfMonthErr.status });

    if (target_month <= pending.year_month) {
      return NextResponse.json({ success: false, error: 'target_month must be after source month' }, { status: 400 });
    }

    // Mark original as carried_forward
    const { error: updErr } = await admin.from('pending_expenses').update({
      status: 'carried_forward',
      carry_reason: carry_reason.trim(),
    }).eq('id', id);

    if (updErr) {
      return NextResponse.json({ success: false, error: updErr.message }, { status: 500 });
    }

    // Create new pending expense in the next month
    const newYearMonth = target_month || nextMonth(pending.year_month);

    const { data: newPending, error: newErr } = await admin.from('pending_expenses').insert({
      budget_id: pending.budget_id,
      budget_version_id: pending.budget_version_id,
      budget_item_id: pending.budget_item_id,
      project_id: pending.project_id,
      department_id: pending.department_id,
      year_month: newYearMonth,
      description: pending.description,
      category: pending.category,
      budgeted_amount_kes: pending.budgeted_amount_kes,
      status: 'pending_auth',
      carry_from_month: pending.year_month,
    }).select().single();

    if (newErr) {
      return NextResponse.json({ success: false, error: newErr.message }, { status: 500 });
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_carried_forward',
      table_name: 'pending_expenses',
      record_id: id,
      old_values: { status: pending.status, year_month: pending.year_month },
      new_values: { status: 'carried_forward', new_id: newPending?.id, new_year_month: newYearMonth },
    });

    await notifyRole(admin, 'cfo', 'Expense carried forward', `Pending expense "${pending.description}" carried forward from ${pending.year_month} to ${newYearMonth}.`, '/expenses');
    await recomputeExpenseVariancesForMonth(admin, pending.year_month);

    return NextResponse.json({ success: true, data: { original_id: id, new_pending: newPending } });
  }

  // -----------------------------------------------------------
  // bulk_confirm
  // -----------------------------------------------------------
  if (action === 'bulk_confirm') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can bulk confirm expenses' }, { status: 403 });
    }

    const { items } = body; // Array of { id, actual_amount_kes }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'items array required with { id, actual_amount_kes } entries' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const results: /* // */ /* // */ any[] = [];
    const errors: /* // */ /* // */ any[] = [];

    for (const item of items) {
      const { id, actual_amount_kes } = item;
      if (!id || actual_amount_kes == null) {
        errors.push({ id, error: 'id and actual_amount_kes required' });
        continue;
      }

      const { data: pending } = await admin.from('pending_expenses').select('*').eq('id', id).single();
      if (!pending) {
        errors.push({ id, error: 'Pending expense not found' });
        continue;
      }
      if (!['pending_auth', 'under_review', 'modified'].includes(pending.status)) {
        errors.push({ id, error: `Cannot confirm status ${pending.status}` });
        continue;
      }

      // Month lock enforcement
      const bcMonthErr = await assertMonthOpen(admin, pending.year_month);
      if (bcMonthErr) {
        errors.push({ id, error: bcMonthErr.message });
        continue;
      }

      // Look up category IDs
      let bulkExpCatId: string | null = null;
      if (pending.category) {
        const { data: cat } = await admin.from('expense_categories').select('id').eq('name', pending.category).maybeSingle();
        bulkExpCatId = cat?.id || null;
      }
      let bulkOhCatId: string | null = null;
      if (!pending.project_id && pending.department_id && pending.category) {
        const { data: ohCat } = await admin.from('overhead_categories').select('id').eq('name', pending.category).maybeSingle();
        bulkOhCatId = ohCat?.id || null;
      }
      const bulkIsProject = !!pending.project_id;

      // Create real expense
      const { data: expense, error: expErr } = await admin.from('expenses').insert({
        budget_id: pending.budget_id,
        budget_version_id: pending.budget_version_id,
        expense_type: bulkIsProject ? 'project_expense' : 'shared_expense',
        project_id: pending.project_id,
        overhead_category_id: bulkIsProject ? null : bulkOhCatId,
        expense_category_id: bulkExpCatId,
        description: pending.description,
        amount_usd: 0,
        amount_kes: actual_amount_kes,
        expense_date: now.split('T')[0],
        year_month: pending.year_month,
        vendor: null,
        receipt_reference: null,
        notes: `Bulk confirmed from pending expense ${id}`,
        entered_by: dbUser.id,
      }).select().single();

      if (expErr) {
        errors.push({ id, error: expErr.message });
        continue;
      }

      // Update pending expense
      const { data: updated, error: updErr } = await admin.from('pending_expenses').update({
        status: 'confirmed',
        actual_amount_kes,
        confirmed_by: dbUser.id,
        confirmed_at: now,
        expense_id: expense?.id,
      }).eq('id', id).select().single();

      if (updErr) {
        errors.push({ id, error: updErr.message });
        continue;
      }

      // Check variance
      await checkVarianceRedFlag(admin, dbUser, pending, actual_amount_kes);

      // Audit log
      await admin.from('audit_logs').insert({
        user_id: dbUser.id,
        action: 'expense_bulk_confirmed',
        table_name: 'pending_expenses',
        record_id: id,
        old_values: { status: pending.status },
        new_values: { status: 'confirmed', actual_amount_kes, expense_id: expense?.id },
      });

      results.push(updated);
    }

    // Single notification for the batch
    await notifyRole(admin, 'cfo', 'Bulk expense confirmation', `${results.length} expense(s) confirmed in bulk by ${dbUser.full_name}.`, '/expenses');
    if (results.length > 0) await recomputeExpenseVariancesForMonth(admin, (results[0] as /* // */ any).year_month);

    return NextResponse.json({
      success: true,
      data: { confirmed: results, errors: errors.length > 0 ? errors : undefined },
    });
  }

  // -----------------------------------------------------------
  // recompute_variances
  // -----------------------------------------------------------
  if (action === 'recompute_variances') {
    if (!isCfoOrAccountant) {
      return NextResponse.json({ success: false, error: 'Only CFO or accountant can recompute variances' }, { status: 403 });
    }

    const { year_month } = body;
    if (!year_month) {
      return NextResponse.json({ success: false, error: 'year_month required' }, { status: 400 });
    }

    // Get all pending expenses for this month (exclude voided)
    const { data: allPending, error: pendErr } = await admin
      .from('pending_expenses')
      .select('*')
      .eq('year_month', year_month)
      .neq('status', 'voided');

    if (pendErr) {
      return NextResponse.json({ success: false, error: pendErr.message }, { status: 500 });
    }

    // Group by project_id, department_id, category
    const grouped: Record<string, {
      project_id: string | null;
      department_id: string | null;
      category: string | null;
      total_budgeted: number;
      total_actual: number;
      count: number;
    }> = {};

    for (const pe of allPending || []) {
      const key = `${pe.project_id || 'null'}|${pe.department_id || 'null'}|${pe.category || 'null'}`;
      if (!grouped[key]) {
        grouped[key] = {
          project_id: pe.project_id,
          department_id: pe.department_id,
          category: pe.category,
          total_budgeted: 0,
          total_actual: 0,
          count: 0,
        };
      }
      grouped[key].total_budgeted += Number(pe.budgeted_amount_kes || 0);
      grouped[key].total_actual += Number(pe.actual_amount_kes || 0);
      grouped[key].count += 1;
    }

    // Get variance threshold from system settings
    const { data: thresholdSetting } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', 'variance_overspend_flag_threshold')
      .single();
    const thresholdPct = parseFloat(thresholdSetting?.value || '15');

    const upsertRows: Record<string, unknown>[] = [];
    const newRedFlags: Record<string, unknown>[] = [];

    for (const g of Object.values(grouped)) {
      const variance = g.total_actual - g.total_budgeted;
      const variancePct = g.total_budgeted > 0 ? (variance / g.total_budgeted) * 100 : 0;

      upsertRows.push({
        year_month,
        project_id: g.project_id,
        department_id: g.department_id,
        category: g.category,
        budgeted_total_kes: g.total_budgeted,
        actual_total_kes: g.total_actual,
        pending_count: g.count,
        accuracy_score: Math.max(0, 100 - Math.abs(variancePct)),
      });

      // Create red flag if overspend exceeds threshold
      if (variancePct > thresholdPct) {
        newRedFlags.push({
          flag_type: 'expense_variance_overspend',
          severity: variancePct > thresholdPct * 2 ? 'critical' as const : 'high' as const,
          title: `Expense variance exceeds ${thresholdPct}% threshold`,
          description: `Variance of ${variancePct.toFixed(1)}% (KES ` + variance.toLocaleString() + `) detected for ${year_month}. Project: ${g.project_id || 'N/A'}, Dept: ${g.department_id || 'N/A'}, Category: ${g.category || 'N/A'}.`,
          project_id: g.project_id,
          year_month,
          reference_table: 'expense_variances',
        });
      }
    }

    // Upsert expense_variances
    for (const row of upsertRows) {
      // Try to find existing
      let query = admin.from('expense_variances')
        .select('id')
        .eq('year_month', year_month);

      if (row.project_id) {
        query = query.eq('project_id', row.project_id);
      } else {
        query = query.is('project_id', null);
      }
      if (row.department_id) {
        query = query.eq('department_id', row.department_id);
      } else {
        query = query.is('department_id', null);
      }
      if (row.category) {
        query = query.eq('category', row.category);
      } else {
        query = query.is('category', null);
      }

      const { data: existing } = await query.single();

      if (existing) {
        await admin.from('expense_variances').update(row).eq('id', existing.id);
      } else {
        await admin.from('expense_variances').insert(row);
      }
    }

    // Insert red flags
    if (newRedFlags.length > 0) {
      await admin.from('red_flags').insert(newRedFlags);
    }

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: dbUser.id,
      action: 'expense_variances_recomputed',
      table_name: 'pending_expenses',
      record_id: null,
      old_values: null,
      new_values: { year_month, groups: upsertRows.length, red_flags: newRedFlags.length },
    });

    await notifyRole(admin, 'cfo', 'Expense variances recomputed', `Variances recomputed for ${year_month}: ${upsertRows.length} group(s), ${newRedFlags.length} red flag(s).`, '/reports/budget-vs-actual');

    return NextResponse.json({
      success: true,
      data: { variances: upsertRows, red_flags_created: newRedFlags.length },
    });
  }

  return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 400 });
}

// =============================================================
// Helper: check variance and create red flag if over threshold
// =============================================================
async function checkVarianceRedFlag(
  admin: ReturnType<typeof createAdminClient>,
  dbUser: /* // */ any,
  pending: /* // */ any,
  actualAmountKes: number,
) {
  const budgeted = Number(pending.budgeted_amount_kes || 0);
  if (budgeted <= 0) return;

  const variance = actualAmountKes - budgeted;
  const variancePct = (variance / budgeted) * 100;

  // Get threshold
  const { data: thresholdSetting } = await admin
    .from('system_settings')
    .select('value')
    .eq('key', 'variance_overspend_flag_threshold')
    .single();
  const thresholdPct = parseFloat(thresholdSetting?.value || '15');

  if (variancePct > thresholdPct) {
    await admin.from('red_flags').insert({
      flag_type: 'expense_variance_overspend',
      severity: variancePct > thresholdPct * 2 ? 'critical' : 'high',
      title: `Expense overspend: ${variancePct.toFixed(1)}% over budget`,
      description: `"${pending.description}" actual KES ` + actualAmountKes.toLocaleString() + ` vs budgeted KES ` + budgeted.toLocaleString() + ` (${variancePct.toFixed(1)}% variance) for ${pending.year_month}.`,
      project_id: pending.project_id,
      year_month: pending.year_month,
      reference_id: pending.id,
      reference_table: 'pending_expenses',
    });
  }
}

async function recomputeExpenseVariancesForMonth(
  admin: ReturnType<typeof createAdminClient>,
  yearMonth: string,
) {
  const { data: pendingItems } = await admin
    .from('pending_expenses')
    .select('project_id, department_id, category, budgeted_amount_kes, actual_amount_kes, status')
    .eq('year_month', yearMonth);

  const groups = new Map<string, {
    project_id: string | null;
    department_id: string | null;
    category: string | null;
    budgeted: number;
    actual: number;
    confirmed: number;
    pending: number;
    voided: number;
    modified: number;
  }>();

  for (const item of pendingItems || []) {
    const key = `${item.project_id || ''}_${item.department_id || ''}_${item.category || ''}`;
    const g = groups.get(key) || {
      project_id: item.project_id,
      department_id: item.department_id,
      category: item.category,
      budgeted: 0, actual: 0, confirmed: 0, pending: 0, voided: 0, modified: 0,
    };
    g.budgeted += Number(item.budgeted_amount_kes || 0);
    g.actual += Number(item.actual_amount_kes || 0);
    if (item.status === 'confirmed') g.confirmed++;
    else if (item.status === 'voided') g.voided++;
    else if (item.status === 'modified') g.modified++;
    else g.pending++;
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const variancePct = g.budgeted === 0 ? 0 : ((g.actual - g.budgeted) / g.budgeted) * 100;
    const accuracy = Math.round(Math.max(0, 100 - Math.abs(variancePct)) * 100) / 100;
    await admin.from('expense_variances').upsert({
      year_month: yearMonth,
      project_id: g.project_id,
      department_id: g.department_id,
      category: g.category,
      budgeted_total_kes: g.budgeted,
      actual_total_kes: g.actual,
      confirmed_count: g.confirmed,
      pending_count: g.pending,
      voided_count: g.voided,
      modified_count: g.modified,
      accuracy_score: accuracy,
      computed_at: new Date().toISOString(),
    }, {
      onConflict: 'year_month,project_id,department_id,category',
    });
  }
}
