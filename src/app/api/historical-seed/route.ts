import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

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

const EXCHANGE_RATE = 129.5;

interface SeedCounts {
  invoices: { inserted: number; skipped: number };
  payments: { inserted: number; skipped: number };
  project_expenses: { inserted: number; skipped: number };
  shared_overhead: { inserted: number; skipped: number };
  profit_share: { inserted: number; skipped: number };
  snapshots: { inserted: number; updated: number; skipped: number };
  red_flags: { inserted: number; skipped: number };
  audit_log: { inserted: number };
  overhead_categories: { inserted: number; existing: number };
}

// =============================================================
// POST — Historical data seed for Q1 2026
// =============================================================
export async function POST(request: Request) {
  try {
    // ---------- Auth ----------
    const authUser = await getAuthUser(request);
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // Check CFO role
    const { data: profile } = await admin
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single();

    if (!profile || profile.role !== 'cfo') {
      return NextResponse.json({ error: 'CFO role required' }, { status: 403 });
    }

    const counts: SeedCounts = {
      invoices: { inserted: 0, skipped: 0 },
      payments: { inserted: 0, skipped: 0 },
      project_expenses: { inserted: 0, skipped: 0 },
      shared_overhead: { inserted: 0, skipped: 0 },
      profit_share: { inserted: 0, skipped: 0 },
      snapshots: { inserted: 0, updated: 0, skipped: 0 },
      red_flags: { inserted: 0, skipped: 0 },
      audit_log: { inserted: 0 },
      overhead_categories: { inserted: 0, existing: 0 },
    };
    const errors: string[] = [];

    // ==========================================================
    // Step 1: Look up project IDs
    // ==========================================================
    const projectNames = ['Windward', 'AIFI', 'SEEO', 'Kemtai'];
    const projectMap: Record<string, string> = {};

    for (const name of projectNames) {
      const { data, error } = await admin
        .from('projects')
        .select('id, name')
        .ilike('name', `%${name}%`)
        .limit(1)
        .single();

      if (error || !data) {
        errors.push(`Project "${name}" not found`);
        continue;
      }
      projectMap[name] = data.id;
    }

    if (Object.keys(projectMap).length < 4) {
      return NextResponse.json(
        { error: 'Not all projects found', details: errors, found: projectMap },
        { status: 400 }
      );
    }

    // ==========================================================
    // Step 2: Look up / create overhead categories
    // ==========================================================
    const categoryNames = [
      'Payroll',
      'Rent',
      'Administration',
      'Utilities',
      'Tools/Software',
      'Statutory',
      'Transport',
      'Infrastructure',
      'Project Specific',
    ];
    const categoryMap: Record<string, string> = {};

    for (const catName of categoryNames) {
      const { data: existing } = await admin
        .from('overhead_categories')
        .select('id')
        .eq('name', catName)
        .limit(1)
        .single();

      if (existing) {
        categoryMap[catName] = existing.id;
        counts.overhead_categories.existing++;
      } else {
        const { data: inserted, error } = await admin
          .from('overhead_categories')
          .insert({ name: catName })
          .select('id')
          .single();

        if (error || !inserted) {
          errors.push(`Failed to create overhead category "${catName}": ${error?.message}`);
          continue;
        }
        categoryMap[catName] = inserted.id;
        counts.overhead_categories.inserted++;
      }
    }

    // ==========================================================
    // Step 3: Get CFO user ID
    // ==========================================================
    const { data: cfoUser } = await admin
      .from('users')
      .select('id')
      .eq('role', 'cfo')
      .limit(1)
      .single();

    if (!cfoUser) {
      return NextResponse.json({ error: 'No CFO user found in users table' }, { status: 400 });
    }
    const cfoUserId = cfoUser.id;

    // ==========================================================
    // Step 4: Seed Invoices
    // ==========================================================
    const invoiceData = [
      { month: '2026-01', date: '2026-01-31', label: 'January', items: [
        { project: 'Windward', amount: 3457164.00 },
        { project: 'AIFI', amount: 2930272.88 },
        { project: 'SEEO', amount: 1054214.00 },
        { project: 'Kemtai', amount: 234738.66 },
      ]},
      { month: '2026-02', date: '2026-02-28', label: 'February', items: [
        { project: 'Windward', amount: 3330720.00 },
        { project: 'AIFI', amount: 2869895.87 },
        { project: 'SEEO', amount: 838334.00 },
        { project: 'Kemtai', amount: 135516.10 },
      ]},
    ];

    const insertedInvoices: Array<{ id: string; project: string; month: string; amount_kes: number; date: string }> = [];

    for (const period of invoiceData) {
      for (const item of period.items) {
        const projectId = projectMap[item.project];

        // Check existence
        const { data: existing } = await admin
          .from('invoices')
          .select('id')
          .eq('project_id', projectId)
          .eq('amount_kes', item.amount)
          .eq('invoice_date', period.date)
          .limit(1);

        if (existing && existing.length > 0) {
          counts.invoices.skipped++;
          continue;
        }

        const { data: inv, error } = await admin
          .from('invoices')
          .insert({
            project_id: projectId,
            invoice_number: `HIST-${item.project}-${period.month}`,
            billing_period: period.month,
            invoice_date: period.date,
            amount_kes: item.amount,
            amount_usd: item.amount / EXCHANGE_RATE,
            status: 'paid',
            description: `${item.project} invoice — ${period.label} 2026`,
            is_backdated: true,
            backdated_entry_date: new Date().toISOString().split('T')[0],
            source_note: 'Seeded from IO Financial Tracker Q1 2026',
            created_by: cfoUserId,
          })
          .select('id')
          .single();

        if (error) {
          errors.push(`Invoice ${item.project} ${period.month}: ${error.message}`);
        } else if (inv) {
          counts.invoices.inserted++;
          insertedInvoices.push({
            id: inv.id,
            project: item.project,
            month: period.month,
            amount_kes: item.amount,
            date: period.date,
          });
        }
      }
    }

    // ==========================================================
    // Step 5: Seed Payments
    // ==========================================================
    for (const inv of insertedInvoices) {
      const { error } = await admin
        .from('payments')
        .insert({
          invoice_id: inv.id,
          payment_date: inv.date,
          amount_usd: inv.amount_kes / EXCHANGE_RATE,
          amount_kes: inv.amount_kes,
          payment_method: 'bank_transfer',
          source_note: 'Seeded from IO Financial Tracker Q1 2026',
          recorded_by: cfoUserId,
        });

      if (error) {
        errors.push(`Payment for invoice ${inv.id}: ${error.message}`);
      } else {
        counts.payments.inserted++;
      }
    }

    // ==========================================================
    // Step 6: Seed Project Direct Expenses
    // ==========================================================
    const directExpenseData = [
      { month: '2026-01', date: '2026-01-31', label: 'January', items: [
        { project: 'Windward', amount: 2066575.00 },
        { project: 'AIFI', amount: 1600050.00 },
        { project: 'SEEO', amount: 394000.00 },
        { project: 'Kemtai', amount: 107965.00 },
      ]},
      { month: '2026-02', date: '2026-02-28', label: 'February', items: [
        { project: 'Windward', amount: 1835300.00 },
        { project: 'AIFI', amount: 2810070.00, notes: 'High expenditure due to client visit — Maasai Mara safari, February 2026. Approved operational cost.' },
        { project: 'SEEO', amount: 393950.00 },
        { project: 'Kemtai', amount: 97145.00 },
      ]},
    ];

    for (const period of directExpenseData) {
      for (const item of period.items) {
        const projectId = projectMap[item.project];
        const description = `Direct expenses — ${period.label} 2026 (seeded from Q1 tracker, general figure)`;

        // Check existence
        const { data: existing } = await admin
          .from('expenses')
          .select('id')
          .eq('project_id', projectId)
          .eq('year_month', period.month)
          .ilike('description', '%Direct expenses%')
          .limit(1);

        if (existing && existing.length > 0) {
          counts.project_expenses.skipped++;
          continue;
        }

        const expenseRecord: Record<string, unknown> = {
          expense_type: 'project_expense',
          project_id: projectId,
          budget_id: null,
          budget_version_id: null,
          description,
          amount_kes: item.amount,
          amount_usd: item.amount / EXCHANGE_RATE,
          expense_date: period.date,
          year_month: period.month,
          entered_by: cfoUserId,
          lifecycle_status: 'confirmed',
          auto_generated: false,
          source_note: 'Seeded from IO Financial Tracker Q1 2026',
        };

        if ('notes' in item && item.notes) {
          expenseRecord.expense_notes = item.notes;
        }

        const { error } = await admin.from('expenses').insert(expenseRecord);

        if (error) {
          errors.push(`Direct expense ${item.project} ${period.month}: ${error.message}`);
        } else {
          counts.project_expenses.inserted++;
        }
      }
    }

    // ==========================================================
    // Step 7: Seed Shared Overhead Expenses (Rent + Statutory only)
    // Payroll removed — already covered in project direct expenses.
    // Admin, Utilities, Tools/Software, Transport, Project Specific,
    // Infrastructure are allocated to projects proportionally by revenue.
    // ==========================================================
    const overheadData = [
      { month: '2026-01', date: '2026-01-31', label: 'January', items: [
        { category: 'Rent', amount: 189875.00 },
        { category: 'Statutory', amount: 41000.00 },
      ]},
      { month: '2026-02', date: '2026-02-28', label: 'February', items: [
        { category: 'Rent', amount: 189875.00 },
        { category: 'Statutory', amount: 41000.00 },
      ]},
    ];

    // Categories allocated proportionally to projects by revenue share
    const allocatedOverhead = [
      { month: '2026-01', date: '2026-01-31', label: 'January', items: [
        { category: 'Administration', amount: 168335.00 },
        { category: 'Utilities', amount: 145480.00 },
        { category: 'Tools/Software', amount: 20000.00 },
        { category: 'Transport', amount: 7150.00 },
        { category: 'Project Specific', amount: 79500.00 },
      ]},
      { month: '2026-02', date: '2026-02-28', label: 'February', items: [
        { category: 'Administration', amount: 486373.00 },
        { category: 'Utilities', amount: 83200.00 },
        { category: 'Tools/Software', amount: 100241.00 },
        { category: 'Transport', amount: 11570.00 },
        { category: 'Infrastructure', amount: 505000.00 },
        { category: 'Project Specific', amount: 39000.00 },
      ]},
    ];

    // Compute revenue proportions for allocation
    const revTotals: Record<string, Record<string, number>> = {};
    for (const period of allocatedOverhead) {
      const ym = period.month;
      revTotals[ym] = {};
      let total = 0;
      for (const inv of insertedInvoices.filter(i => i.month === ym)) {
        const pid = projectMap[inv.project];
        revTotals[ym][pid] = (revTotals[ym][pid] || 0) + inv.amount_kes;
        total += inv.amount_kes;
      }
      // Convert to ratios
      for (const pid of Object.keys(revTotals[ym])) {
        revTotals[ym][pid] = revTotals[ym][pid] / (total || 1);
      }
    }

    // Insert allocated overhead as project expenses
    for (const period of allocatedOverhead) {
      const proportions = revTotals[period.month] || {};
      for (const item of period.items) {
        for (const [projectId, ratio] of Object.entries(proportions)) {
          const allocKes = Math.round(item.amount * ratio * 100) / 100;
          const description = `${item.category} (allocated) — ${period.label} 2026 (seeded from Q1 tracker)`;

          const { data: existing } = await admin
            .from('expenses')
            .select('id')
            .eq('project_id', projectId)
            .eq('year_month', period.month)
            .eq('description', description)
            .limit(1);

          if (existing && existing.length > 0) {
            continue;
          }

          await admin.from('expenses').insert({
            expense_type: 'project_expense',
            project_id: projectId,
            budget_id: null,
            budget_version_id: null,
            description,
            amount_kes: allocKes,
            amount_usd: allocKes / EXCHANGE_RATE,
            expense_date: period.date,
            year_month: period.month,
            entered_by: cfoUserId,
            lifecycle_status: 'confirmed',
            auto_generated: false,
            source_note: 'Seeded from IO Financial Tracker Q1 2026 — reclassified from shared overhead',
          });
          counts.project_expenses.inserted++;
        }
      }
    }

    for (const period of overheadData) {
      for (const item of period.items) {
        const catId = categoryMap[item.category];
        if (!catId) {
          errors.push(`Overhead category "${item.category}" not found in map`);
          continue;
        }

        const description = `${item.category} — ${period.label} 2026 (seeded from Q1 tracker)`;

        // Check existence
        const { data: existing } = await admin
          .from('expenses')
          .select('id')
          .eq('year_month', period.month)
          .eq('description', description)
          .eq('amount_kes', item.amount)
          .limit(1);

        if (existing && existing.length > 0) {
          counts.shared_overhead.skipped++;
          continue;
        }

        const overheadRecord: Record<string, unknown> = {
          expense_type: 'shared_expense',
          overhead_category_id: catId,
          project_id: null,
          budget_id: null,
          budget_version_id: null,
          description,
          amount_kes: item.amount,
          amount_usd: item.amount / EXCHANGE_RATE,
          expense_date: period.date,
          year_month: period.month,
          entered_by: cfoUserId,
          lifecycle_status: 'confirmed',
          source_note: 'Seeded from IO Financial Tracker Q1 2026',
        };

        if ('notes' in item && item.notes) {
          overheadRecord.expense_notes = item.notes;
        }

        const { error } = await admin.from('expenses').insert(overheadRecord);

        if (error) {
          errors.push(`Overhead ${item.category} ${period.month}: ${error.message}`);
        } else {
          counts.shared_overhead.inserted++;
        }
      }
    }

    // ==========================================================
    // Step 8: Seed Profit Share Records
    // ==========================================================
    const profitShareData = [
      { year_month: '2026-01', total_distributed: 2344452.00 },
      { year_month: '2026-02', total_distributed: 1191000.00 },
    ];

    for (const ps of profitShareData) {
      // Check existence
      const { data: existing } = await admin
        .from('profit_share_records')
        .select('id')
        .eq('year_month', ps.year_month)
        .ilike('source_note', '%Q1 2026%')
        .limit(1);

      if (existing && existing.length > 0) {
        counts.profit_share.skipped++;
        continue;
      }

      const { error } = await admin.from('profit_share_records').insert({
        year_month: ps.year_month,
        distributable_profit_kes: ps.total_distributed,
        distributable_profit_usd: ps.total_distributed / EXCHANGE_RATE,
        director_share_kes: ps.total_distributed * 0.7,
        director_share_usd: (ps.total_distributed * 0.7) / EXCHANGE_RATE,
        company_share_kes: ps.total_distributed * 0.3,
        company_share_usd: (ps.total_distributed * 0.3) / EXCHANGE_RATE,
        status: 'approved',
        source_note: 'Seeded from IO Financial Tracker Q1 2026 — historical profit distributions',
        total_distributed: ps.total_distributed,
      });

      if (error) {
        errors.push(`Profit share ${ps.year_month}: ${error.message}`);
      } else {
        counts.profit_share.inserted++;
      }
    }

    // ==========================================================
    // Step 9: Monthly Financial Snapshots
    // ==========================================================
    const snapshotData = [
      {
        year_month: '2026-01',
        total_revenue_kes: 7676389.54,
        total_direct_costs_kes: 4589055.00,
        gross_profit_kes: 3087334.54,
        total_shared_overhead_kes: 230875.00,
        operating_profit_kes: 2856459.54,
        net_profit_kes: 2856459.54,
        revenue_source_month: '2026-01',
      },
      {
        year_month: '2026-02',
        total_revenue_kes: 7174465.97,
        total_direct_costs_kes: 6361849.01,
        gross_profit_kes: 812616.96,
        total_shared_overhead_kes: 230875.00,
        operating_profit_kes: 581741.96,
        net_profit_kes: 581741.96,
        revenue_source_month: '2026-02',
      },
    ];

    for (const snap of snapshotData) {
      const record = {
        year_month: snap.year_month,
        total_revenue_kes: snap.total_revenue_kes,
        total_revenue_usd: snap.total_revenue_kes / EXCHANGE_RATE,
        total_direct_costs_kes: snap.total_direct_costs_kes,
        total_direct_costs_usd: snap.total_direct_costs_kes / EXCHANGE_RATE,
        gross_profit_kes: snap.gross_profit_kes,
        gross_profit_usd: snap.gross_profit_kes / EXCHANGE_RATE,
        total_shared_overhead_kes: snap.total_shared_overhead_kes,
        total_shared_overhead_usd: snap.total_shared_overhead_kes / EXCHANGE_RATE,
        operating_profit_kes: snap.operating_profit_kes,
        operating_profit_usd: snap.operating_profit_kes / EXCHANGE_RATE,
        net_profit_kes: snap.net_profit_kes,
        net_profit_usd: snap.net_profit_kes / EXCHANGE_RATE,
        revenue_source_month: snap.revenue_source_month,
        computed_with_lag: false,
        data_source: 'historical_seed_q1_2026',
        total_agents: 0,
      };

      // Check existence
      const { data: existing } = await admin
        .from('monthly_financial_snapshots')
        .select('id')
        .eq('year_month', snap.year_month)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update existing
        const { error } = await admin
          .from('monthly_financial_snapshots')
          .update(record)
          .eq('year_month', snap.year_month);

        if (error) {
          errors.push(`Snapshot update ${snap.year_month}: ${error.message}`);
        } else {
          counts.snapshots.updated++;
        }
      } else {
        const { error } = await admin
          .from('monthly_financial_snapshots')
          .insert(record);

        if (error) {
          errors.push(`Snapshot insert ${snap.year_month}: ${error.message}`);
        } else {
          counts.snapshots.inserted++;
        }
      }
    }

    // ==========================================================
    // Step 10: Red Flags
    // ==========================================================
    const redFlags = [
      {
        flag_type: 'profit_share_before_closure',
        severity: 'low',
        title: 'Historical profit share — director breakdown pending',
        description:
          'Historical profit share records for Jan and Feb 2026 have been seeded with company totals only. Per-director breakdown not available in source data. Assign manually if needed.',
        is_resolved: false,
      },
      {
        flag_type: 'missing_agent_counts',
        severity: 'low',
        title: 'Agent count for January 2026 not entered',
        description:
          'Agent count for January 2026 not entered. Enter to enable agent efficiency reporting for this month.',
        year_month: '2026-01',
        is_resolved: false,
      },
      {
        flag_type: 'missing_agent_counts',
        severity: 'low',
        title: 'Agent count for February 2026 not entered',
        description:
          'Agent count for February 2026 not entered. Enter to enable agent efficiency reporting for this month.',
        year_month: '2026-02',
        is_resolved: false,
      },
    ];

    for (const flag of redFlags) {
      // Check existence by title
      const { data: existing } = await admin
        .from('red_flags')
        .select('id')
        .eq('title', flag.title)
        .limit(1);

      if (existing && existing.length > 0) {
        counts.red_flags.skipped++;
        continue;
      }

      const { error } = await admin.from('red_flags').insert(flag);

      if (error) {
        errors.push(`Red flag "${flag.title}": ${error.message}`);
      } else {
        counts.red_flags.inserted++;
      }
    }

    // ==========================================================
    // Step 11: Audit Log
    // ==========================================================
    const { error: auditError } = await admin.from('audit_logs').insert({
      user_id: cfoUserId,
      action: 'historical_data_seed_complete',
      table_name: 'multiple',
      new_values: {
        seed_type: 'Q1 2026 historical data',
        months: ['2026-01', '2026-02'],
        counts,
        errors_encountered: errors.length,
      },
    });

    if (auditError) {
      errors.push(`Audit log: ${auditError.message}`);
    } else {
      counts.audit_log.inserted++;
    }

    // ==========================================================
    // Return summary
    // ==========================================================
    return NextResponse.json({
      success: true,
      message: 'Historical Q1 2026 data seed complete',
      counts,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Historical seed failed', details: message },
      { status: 500 }
    );
  }
}
