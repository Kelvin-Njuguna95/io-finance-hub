import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// POST /api/expenses/import — parse Excel and return validated rows
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await admin.from('users').select('role, full_name').eq('id', user.id).single();
  if (!['cfo', 'accountant'].includes(profile?.role || '')) {
    return NextResponse.json({ error: 'Only Accountant or CFO can import expenses' }, { status: 403 });
  }

  const contentType = request.headers.get('content-type') || '';

  // Step 1: Parse Excel (multipart upload)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];

    // Load lookup data
    const { data: projects } = await admin.from('projects').select('id, name').eq('is_active', true);
    const { data: budgets } = await admin.from('budgets').select('id, project_id, year_month, budget_versions(id, status)');
    const { data: users } = await admin.from('users').select('id, full_name');

    const projectMap = new Map((projects || []).map((p: any) => [p.name.toLowerCase(), p]));
    const userMap = new Map((users || []).map((u: any) => [u.full_name.toLowerCase(), u]));

    // Normalize payment methods
    const normPayment = (v: string): string => {
      const l = (v || '').toLowerCase().trim();
      if (['cash'].includes(l)) return 'Cash';
      if (['mpesa', 'm-pesa', 'mpessa'].includes(l)) return 'M-Pesa';
      if (['bank transfer', 'bank', 'eft'].includes(l)) return 'Bank Transfer';
      if (['cheque', 'check'].includes(l)) return 'Cheque';
      return v || '';
    };

    const validated = rawRows.map((row: any, idx: number) => {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Parse fields
      const expenseDate = row.expense_date ? new Date(row.expense_date) : null;
      const amountKes = parseFloat(String(row.amount_kes || '0').replace(/,/g, ''));
      const description = String(row.description || '').trim();
      const importAction = String(row.import_action || 'IMPORT').trim().toUpperCase();
      const flagDetail = String(row.flag_detail || '').trim();
      const projectName = String(row.project_id || '').trim();
      const expenseType = String(row.expense_type || '').trim().toLowerCase();
      const paidTo = String(row.paid_to || '').trim();
      const paymentMethod = normPayment(String(row.payment_method || ''));
      const approvedBy = String(row.approved_by || '').trim();
      const overheadCategory = String(row.overhead_category || '').trim();
      const budgetLinkNote = String(row.budget_link_note || '').trim();

      // Validate date
      if (!expenseDate || isNaN(expenseDate.getTime())) errors.push('Invalid date');

      // Validate amount
      if (isNaN(amountKes) || amountKes <= 0) errors.push('Amount must be > 0');

      // Validate description
      if (!description) errors.push('Description required');

      // Determine expense type
      let resolvedType = 'project_expense';
      if (expenseType.includes('shared') || projectName.toLowerCase() === 'all' || projectName.toLowerCase().includes('shared') || projectName.toLowerCase().includes('overhead')) {
        resolvedType = 'shared_expense';
      }

      // Resolve project
      let resolvedProjectId: string | null = null;
      let resolvedProjectName = projectName;
      if (resolvedType === 'project_expense') {
        const found = projectMap.get(projectName.toLowerCase());
        if (found) {
          resolvedProjectId = found.id;
          resolvedProjectName = found.name;
        } else {
          errors.push(`Project "${projectName}" not found`);
        }
      }

      // Check for approved budget
      let budgetId: string | null = null;
      let budgetVersionId: string | null = null;
      if (resolvedProjectId && expenseDate) {
        const ym = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
        const matchingBudget = (budgets || []).find((b: any) =>
          b.project_id === resolvedProjectId && b.year_month === ym
        );
        if (matchingBudget) {
          const approvedVersion = (matchingBudget.budget_versions || []).find((v: any) => v.status === 'approved' || v.status === 'pm_approved');
          if (approvedVersion) {
            budgetId = matchingBudget.id;
            budgetVersionId = approvedVersion.id;
          } else {
            warnings.push('No approved budget for this period');
          }
        } else {
          warnings.push('No budget found for this project/period');
        }
      }

      // Resolve approved_by
      let resolvedApprover: string | null = null;
      if (approvedBy && approvedBy.toLowerCase() !== 'all') {
        const found = userMap.get(approvedBy.toLowerCase());
        if (found) resolvedApprover = found.id;
      }

      // Determine row status
      let status: 'valid' | 'review' | 'reroute' = 'valid';
      if (importAction === 'REROUTE') {
        status = 'reroute';
        warnings.push('Marked REROUTE — appears to be a profit share payment');
      } else if (importAction !== 'IMPORT') {
        status = 'review';
        warnings.push(`Import action is "${importAction}", not IMPORT`);
      } else if (errors.length > 0) {
        status = 'review';
      } else if (warnings.length > 0) {
        status = 'review';
      }

      const periodMonth = expenseDate && !isNaN(expenseDate.getTime())
        ? `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`
        : '';

      return {
        row_index: idx + 1,
        status,
        errors,
        warnings,
        expense_date: expenseDate?.toISOString().split('T')[0] || '',
        expense_type: resolvedType,
        project_id: resolvedProjectId,
        project_name: resolvedProjectName,
        description,
        amount_kes: amountKes,
        paid_to: paidTo,
        payment_method: paymentMethod,
        approved_by: resolvedApprover,
        approved_by_name: approvedBy,
        overhead_category: overheadCategory,
        budget_id: budgetId,
        budget_version_id: budgetVersionId,
        budget_link_note: budgetLinkNote,
        import_action: importAction,
        flag_detail: flagDetail,
        period_month: periodMonth,
      };
    });

    return NextResponse.json({
      file_name: file.name,
      total_rows: validated.length,
      valid_count: validated.filter(r => r.status === 'valid').length,
      review_count: validated.filter(r => r.status === 'review').length,
      reroute_count: validated.filter(r => r.status === 'reroute').length,
      rows: validated,
    });
  }

  // Step 2: Confirm import (JSON body with approved rows)
  if (contentType.includes('application/json')) {
    const body = await request.json();
    const { file_name, rows } = body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    let importedCount = 0;
    let skippedCount = 0;
    const periodMonths = new Set<string>();

    // Generate transaction ID prefix
    const now = new Date();
    const prefix = `EXP-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get current sequence count
    const { count: existingCount } = await admin
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .like('receipt_reference', `${prefix}%`);

    let seq = (existingCount || 0) + 1;

    for (const row of rows) {
      if (row.status === 'reroute') { skippedCount++; continue; }

      const txId = `${prefix}-${String(seq).padStart(3, '0')}`;
      seq++;

      // Need a budget link — use provided or find one
      let budgetId = row.budget_id;
      let budgetVersionId = row.budget_version_id;

      // If no budget link, try to find any approved budget for the project/month
      if (!budgetId && row.project_id && row.period_month) {
        const { data: matchBudget } = await admin.from('budgets')
          .select('id, budget_versions(id, status)')
          .eq('project_id', row.project_id)
          .eq('year_month', row.period_month)
          .single();
        if (matchBudget) {
          const approved = ((matchBudget as any).budget_versions || []).find((v: any) => ['approved', 'pm_approved'].includes(v.status));
          if (approved) {
            budgetId = matchBudget.id;
            budgetVersionId = approved.id;
          }
        }
      }

      // Skip if no approved budget and it's a project expense
      if (!budgetId && row.expense_type === 'project_expense') {
        skippedCount++;
        continue;
      }

      // For shared expenses without a budget, create a minimal reference
      if (!budgetId && row.expense_type === 'shared_expense') {
        skippedCount++;
        continue;
      }

      const { error } = await admin.from('expenses').insert({
        budget_id: budgetId,
        budget_version_id: budgetVersionId,
        expense_type: row.expense_type,
        project_id: row.expense_type === 'project_expense' ? row.project_id : null,
        description: row.description,
        amount_usd: 0,
        amount_kes: row.amount_kes,
        expense_date: row.expense_date,
        year_month: row.period_month,
        vendor: row.paid_to || null,
        receipt_reference: txId,
        notes: row.budget_link_note || null,
        entered_by: user.id,
      });

      if (error) {
        skippedCount++;
      } else {
        importedCount++;
        periodMonths.add(row.period_month);
      }
    }

    // Record the batch
    await admin.from('expense_import_batches').insert({
      imported_by: user.id,
      file_name: file_name || 'unknown.xlsx',
      period_month: Array.from(periodMonths).join(', '),
      total_rows: rows.length,
      imported_count: importedCount,
      skipped_count: skippedCount,
      flagged_count: rows.filter((r: any) => r.status === 'reroute').length,
      status: importedCount > 0 ? (skippedCount > 0 ? 'partial' : 'completed') : 'failed',
    });

    // Audit log
    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'expense_batch_import',
      table_name: 'expenses',
      new_values: {
        file_name,
        row_count: rows.length,
        imported_count: importedCount,
        skipped_count: skippedCount,
        flagged_count: rows.filter((r: any) => r.status === 'reroute').length,
        period_months: Array.from(periodMonths),
      },
    });

    return NextResponse.json({
      success: true,
      imported_count: importedCount,
      skipped_count: skippedCount,
    });
  }

  return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
}
