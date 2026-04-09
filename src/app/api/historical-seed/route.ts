import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Seed creation disabled — Appendix R (2026-04-09)
async function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;
  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  return user;
}

async function requireCfo(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const admin = createAdminClient();
  const { data: profile } = await admin.from('users').select('role').eq('id', authUser.id).single();
  if (!profile || profile.role !== 'cfo') {
    return { error: NextResponse.json({ error: 'CFO role required' }, { status: 403 }) };
  }
  return { admin, authUser };
}

export async function POST(request: Request) {
  const auth = await requireCfo(request);
  if ('error' in auth) return auth.error;
  return NextResponse.json({
    error: 'Historical seed creation is disabled by policy (Appendix R).',
    code: 'HISTORICAL_SEED_DISABLED',
  }, { status: 405 });
}

export async function GET(request: Request) {
  const auth = await requireCfo(request);
  if ('error' in auth) return auth.error;

  const { admin } = auth;
  const db = admin as any;
  const scans = [
    db.from('monthly_financial_snapshots').select('id', { count: 'exact', head: true }).eq('data_source', 'historical_seed_q1_2026'),
    db.from('invoices').select('id', { count: 'exact', head: true }).ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%'),
    db.from('payments').select('id', { count: 'exact', head: true }).ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%'),
    db.from('project_expenses').select('id', { count: 'exact', head: true }).ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%'),
    db.from('shared_overhead_entries').select('id', { count: 'exact', head: true }).ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%'),
    db.from('profit_share_records').select('id', { count: 'exact', head: true }).ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%'),
  ];

  const [snapshots, invoices, payments, projectExpenses, overhead, profitShare] = await Promise.all(scans);
  const counts = {
    monthly_financial_snapshots: snapshots.count || 0,
    invoices: invoices.count || 0,
    payments: payments.count || 0,
    project_expenses: projectExpenses.count || 0,
    shared_overhead_entries: overhead.count || 0,
    profit_share_records: profitShare.count || 0,
  };
  const total = Object.values(counts).reduce((sum, v) => sum + Number(v || 0), 0);

  return NextResponse.json({
    policy: 'Historical seed creation disabled',
    total_records_detected: total,
    counts,
  });
}

export async function DELETE(request: Request) {
  const auth = await requireCfo(request);
  if ('error' in auth) return auth.error;

  const { admin, authUser } = auth;
  const db = admin as any;
  const countDelete = async (buildQuery: () => any): Promise<number> => {
    const q = buildQuery();
    const { data } = await q.select('id');
    const total = data?.length || 0;
    if (total > 0) await q.delete();
    return total;
  };

  const deleted = {
    monthly_financial_snapshots: await countDelete(() => db.from('monthly_financial_snapshots').eq('data_source', 'historical_seed_q1_2026')),
    invoices: await countDelete(() => db.from('invoices').ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%')),
    payments: await countDelete(() => db.from('payments').ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%')),
    project_expenses: await countDelete(() => db.from('project_expenses').ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%')),
    shared_overhead_entries: await countDelete(() => db.from('shared_overhead_entries').ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%')),
    profit_share_records: await countDelete(() => db.from('profit_share_records').ilike('source_note', '%Seeded from IO Financial Tracker Q1 2026%')),
    red_flags: await countDelete(() => db.from('red_flags').eq('title', 'Historical profit share — director breakdown pending')),
  };

  await admin.from('audit_logs').insert({
    user_id: authUser.id,
    action: 'historical_seed_removed',
    table_name: 'historical_seed',
    new_values: deleted,
  });

  return NextResponse.json({ success: true, message: 'Historical seed data removed successfully', deleted });
}
