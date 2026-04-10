import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/api-errors';

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const admin = createAdminClient();
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();

  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  const yearMonth = url.searchParams.get('year_month');
  if (!projectId || !yearMonth) return NextResponse.json({ error: 'project_id and year_month required' }, { status: 400 });

  const periodMonth = yearMonth + '-01';

  // Verify access
  if (profile?.role === 'team_leader') {
    const { data: assignment } = await admin.from('user_project_assignments')
      .select('id').eq('user_id', user.id).eq('project_id', projectId).single();
    if (!assignment) return NextResponse.json({ error: 'Not your project' }, { status: 403 });
  } else if (!['cfo', 'accountant'].includes(profile?.role || '')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Get project
  const { data: project } = await admin.from('projects').select('name').eq('id', projectId).single();

  // Revenue — LAGGED: use previous month's invoice
  const prevDate = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]) - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  const { data: laggedInvoices } = await admin.from('invoices')
    .select('*, payments(*)')
    .eq('project_id', projectId).eq('billing_period', prevMonth);

  const laggedInvoice = (laggedInvoices || [])[0];
  // Get standard exchange rate
  const { data: rateSetting } = await admin.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
  const stdRate = parseFloat(rateSetting?.value || '129.5');
  // Convert USD invoice to KES using standard rate
  const invoiceAmountKes = laggedInvoice ? Number(laggedInvoice.amount_kes) : 0;
  const invoiceAmountUsd = laggedInvoice ? Number(laggedInvoice.amount_usd) : 0;
  const invoiceAmount = invoiceAmountKes > 0 ? invoiceAmountKes : Math.round(invoiceAmountUsd * stdRate * 100) / 100;
  const totalPaid = laggedInvoice ? (laggedInvoice.payments || []).reduce((s: number, p: /* // */ any) => s + Number(p.amount_usd || 0), 0) : 0;
  const outstanding = invoiceAmountUsd - totalPaid;
  const revenueSourceMonth = prevMonth;

  // Expenses — project expenses only
  const { data: expenses } = await admin.from('expenses')
    .select('*, expense_categories(name)')
    .eq('project_id', projectId).eq('year_month', yearMonth).eq('expense_type', 'project_expense')
    .order('expense_date');

  const totalExpenses = (expenses || []).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);

  // Expense by category
  const catMap = new Map<string, number>();
  (expenses || []).forEach((e: /* // */ any) => {
    const cat = e.expense_categories?.name || 'Uncategorised';
    catMap.set(cat, (catMap.get(cat) || 0) + Number(e.amount_kes));
  });
  const expenseByCategory = Array.from(catMap.entries())
    .map(([name, amount]) => ({ name, amount, pct: totalExpenses > 0 ? (amount / totalExpenses * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // Budget — latest approved version
  const { data: budgets } = await admin.from('budgets')
    .select('*, budget_versions(*, budget_items(*))')
    .eq('project_id', projectId).eq('year_month', yearMonth);

  const budget = (budgets || [])[0];
  let approvedVersion = null;
  let budgetItems: /* // */ /* // */ any[] = [];
  let totalBudget = 0;

  if (budget) {
    const versions = (budget as /* // */ any).budget_versions || [];
    approvedVersion = versions.find((v: /* // */ any) => v.status === 'approved');
    if (approvedVersion) {
      budgetItems = (approvedVersion as /* // */ any).budget_items || [];
      totalBudget = Number((approvedVersion as /* // */ any).total_amount_kes);
    }
  }

  const budgetUtilisation = totalBudget > 0 ? (totalExpenses / totalBudget * 100) : 0;
  const budgetVariance = totalBudget - totalExpenses;

  // Agent counts
  const { data: agentData } = await admin.from('agent_counts')
    .select('agent_count').eq('project_id', projectId).eq('year_month', yearMonth).single();
  const agentCount = agentData?.agent_count || 0;

  // Previous month data for trends
  const prevMonths: /* // */ /* // */ any[] = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]) - 1 - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const revSrcDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const revenueYm = `${revSrcDate.getFullYear()}-${String(revSrcDate.getMonth() + 1).padStart(2, '0')}`;

    const [invRes, expRes, agRes] = await Promise.all([
      admin.from('invoices').select('amount_kes').eq('project_id', projectId).eq('billing_period', revenueYm),
      admin.from('expenses').select('amount_kes').eq('project_id', projectId).eq('year_month', ym).eq('expense_type', 'project_expense'),
      admin.from('agent_counts').select('agent_count').eq('project_id', projectId).eq('year_month', ym).single(),
    ]);

    const rev = (invRes.data || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes), 0);
    const exp = (expRes.data || []).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
    const agents = agRes.data?.agent_count || 0;

    if (rev > 0 || exp > 0) {
      prevMonths.push({
        year_month: ym,
        revenue: rev,
        expenses: exp,
        contribution: rev - exp,
        agents,
        margin: rev > 0 ? ((rev - exp) / rev * 100) : 0,
      });
    }
  }
  prevMonths.reverse();

  // Compute health score
  const grossMargin = invoiceAmount > 0 ? ((invoiceAmount - totalExpenses) / invoiceAmount * 100) : 0;

  let budgetScore = 0;
  if (totalBudget > 0) {
    if (budgetUtilisation >= 70 && budgetUtilisation <= 95) budgetScore = 100;
    else if (budgetUtilisation >= 50 && budgetUtilisation < 70) budgetScore = 60;
    else if (budgetUtilisation > 95 && budgetUtilisation <= 105) budgetScore = 50;
    else if (budgetUtilisation > 105) budgetScore = 20;
    else budgetScore = 40;
  }

  let marginScore = 0;
  if (invoiceAmount > 0) {
    if (grossMargin > 30) marginScore = 100;
    else if (grossMargin >= 15) marginScore = 60;
    else marginScore = 20;
  }

  const agentScore = agentCount > 0 ? 100 : 0;
  const timelinessScore = approvedVersion ? 100 : (budget ? 50 : 0);
  const periodDate = `${yearMonth}-01`;
  const [{ data: miscReport }, { data: miscReportItems }, { data: miscDraws }] = await Promise.all([
    admin.from('misc_reports').select('id, status, total_drawn').eq('project_id', projectId).eq('period_month', periodDate).maybeSingle(),
    admin
      .from('misc_report_items')
      .select('amount, misc_reports!inner(project_id, period_month)')
      .eq('misc_reports.project_id', projectId)
      .eq('misc_reports.period_month', periodDate),
    admin.from('misc_draws').select('amount_approved, status').eq('project_id', projectId).eq('period_month', periodDate),
  ]);

  const activeDrawn = (miscDraws || [])
    .filter((d: /* // */ any) => !['pending_pm_approval', 'declined', 'deleted'].includes(String(d.status)))
    .reduce((s: number, d: /* // */ any) => s + Number(d.amount_approved || 0), 0);
  const reportedMisc = (miscReportItems || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount || 0), 0);
  const miscBase = Number(miscReport?.total_drawn || 0) > 0 ? Number(miscReport?.total_drawn || 0) : activeDrawn;
  const miscCoveragePct = miscBase > 0 ? (reportedMisc / miscBase) * 100 : 100;

  let miscScore = 0;
  const miscStatus = miscReport?.status || 'not_submitted';
  if (miscBase <= 0 && !miscReport) {
    miscScore = 100; // no misc activity to report
  } else if (miscStatus === 'cfo_reviewed') {
    miscScore = 100;
  } else if (miscStatus === 'submitted') {
    miscScore = miscCoveragePct >= 90 ? 90 : miscCoveragePct >= 75 ? 75 : 60;
  } else if (miscStatus === 'draft') {
    miscScore = miscCoveragePct >= 80 ? 60 : miscCoveragePct >= 50 ? 45 : 30;
  } else {
    miscScore = miscCoveragePct >= 80 ? 65 : 35;
  }

  const score = Math.round(
    budgetScore * 0.30 + marginScore * 0.35 + miscScore * 0.15 + timelinessScore * 0.10 + agentScore * 0.10
  );
  const scoreBand = score >= 75 ? 'healthy' : score >= 50 ? 'watch' : 'at_risk';

  // Determine biggest drag
  const drags = [
    { name: 'Budget utilisation', score: budgetScore },
    { name: 'Gross margin', score: marginScore },
    { name: 'Misc reporting', score: miscScore },
    { name: 'Agent count', score: agentScore },
    { name: 'Budget submission', score: timelinessScore },
  ].sort((a, b) => a.score - b.score);
  const biggestDrag = drags[0].score < 80 ? drags[0].name : null;

  // Generate hints
  const hints: { icon: string; text: string; severity: string }[] = [];
  const dayOfMonth = new Date().getDate();

  if (budgetUtilisation > 95 && dayOfMonth < 28) hints.push({ icon: '⚠️', text: `You've used ${budgetUtilisation.toFixed(0)}% of your budget with ${30 - dayOfMonth} days left. Review remaining expenses carefully.`, severity: 'warning' });
  if (budgetUtilisation < 50 && dayOfMonth > 20) hints.push({ icon: '📋', text: `Only ${budgetUtilisation.toFixed(0)}% of your budget has been spent past the 20th. Ensure all expenses have been logged.`, severity: 'info' });
  if (laggedInvoice && outstanding > 0 && laggedInvoice.invoice_date) {
    const daysSinceInvoice = Math.floor((Date.now() - new Date(laggedInvoice.invoice_date).getTime()) / 86400000);
    if (daysSinceInvoice > 30) hints.push({ icon: '💰', text: `Your invoice has been outstanding for ${daysSinceInvoice} days. Follow up with your Accountant.`, severity: 'warning' });
  }
  if (expenseByCategory.length > 0 && expenseByCategory[0].pct > 50) hints.push({ icon: '🔍', text: `${expenseByCategory[0].name} makes up ${expenseByCategory[0].pct.toFixed(0)}% of total expenses. This is unusually concentrated.`, severity: 'info' });
  if (agentCount === 0) hints.push({ icon: '❗', text: `Agent count not entered for this month. Enter it to see productivity metrics.`, severity: 'critical' });
  if (miscScore < 70) {
    hints.push({
      icon: '🧾',
      text: miscBase > 0
        ? `Misc reporting is incomplete (${miscCoveragePct.toFixed(0)}% itemised for ${yearMonth}). Record remaining misc lines.`
        : `Misc report status is '${miscStatus}'. Submit and reconcile misc reporting for ${yearMonth}.`,
      severity: miscScore < 50 ? 'warning' : 'info',
    });
  }
  if (prevMonths.length > 0) {
    const lastMonth = prevMonths[prevMonths.length - 1];
    if (lastMonth && invoiceAmount > 0 && lastMonth.revenue > 0) {
      const revChange = ((invoiceAmount - lastMonth.revenue) / lastMonth.revenue * 100);
      if (revChange < -10) hints.push({ icon: '📉', text: `Revenue is ${Math.abs(revChange).toFixed(0)}% lower than last month. Ensure scope changes are documented.`, severity: 'warning' });
    }
  }
  if (score >= 75 && budgetUtilisation >= 70 && budgetUtilisation <= 95) {
    hints.push({ icon: '✅', text: 'Project is tracking well this month — healthy margin and budget utilisation within range.', severity: 'positive' });
  }
  if (hints.length === 0) hints.push({ icon: '✅', text: 'No issues flagged this month. Everything looks on track.', severity: 'positive' });

  // Save health score
  await admin.from('project_health_scores').upsert({
    project_id: projectId,
    period_month: periodMonth,
    score,
    score_band: scoreBand,
    biggest_drag: biggestDrag,
    budget_score: budgetScore,
    margin_score: marginScore,
    misc_score: miscScore,
    timeliness_score: timelinessScore,
    agent_score: agentScore,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'project_id,period_month' });

    return NextResponse.json({
      project_name: project?.name,
      year_month: yearMonth,
      health: {
        score,
        score_band: scoreBand,
        biggest_drag: biggestDrag,
        budget_score: budgetScore,
        margin_score: marginScore,
        misc_score: miscScore,
        timeliness_score: timelinessScore,
        agent_score: agentScore,
        misc_coverage_pct: Number(miscCoveragePct.toFixed(1)),
        misc_report_status: miscStatus,
      },
      revenue: { invoice_amount: invoiceAmount, invoice_status: laggedInvoice?.status || 'not_raised', total_paid: totalPaid, outstanding, invoice_date: laggedInvoice?.invoice_date, billing_period: laggedInvoice?.billing_period, revenue_source_month: revenueSourceMonth },
      expenses: { total: totalExpenses, by_category: expenseByCategory, items: expenses || [] },
      budget: { total: totalBudget, utilisation: budgetUtilisation, variance: budgetVariance, items: budgetItems, has_approved: !!approvedVersion },
      agents: { count: agentCount, revenue_per_agent: agentCount > 0 ? invoiceAmount / agentCount : 0, cost_per_agent: agentCount > 0 ? totalExpenses / agentCount : 0, contribution_per_agent: agentCount > 0 ? (invoiceAmount - totalExpenses) / agentCount : 0 },
      trends: prevMonths,
      hints: hints.slice(0, 4),
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to load project financials.', 'PROJECT_FINANCIALS_ERROR');
  }
}
