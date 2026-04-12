'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChartStatusBadge, ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency } from '@/components/reports/executive-kit';
import { formatCurrency, formatYearMonth } from '@/lib/format';
import { getLaggedMonth, getMonthRange, shortMonth, formatKesShort, CHART_COLORS, getProjectColor } from '@/lib/report-utils';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ComposedChart, Area, ReferenceLine, Cell,
} from 'recharts';
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

interface MonthData {
  month: string;
  label: string;
  revenue: number;
  directExpenses: number;
  overhead: number;
  netProfit: number;
  margin: number;
}

interface ProjectTrend {
  month: string;
  label: string;
  [project: string]: number | string;
}

interface ExpenseComposition {
  month: string;
  label: string;
  [category: string]: number | string;
}

interface IndexPoint {
  month: string;
  label: string;
  revenueIndex: number;
  expenseIndex: number;
}

interface CashFlowPoint {
  month: string;
  label: string;
  serviceRevenue: number;
  serviceExpenses: number;
  cashReceived: number;
  outstanding: number;
}

interface AgentEfficiency {
  month: string;
  label: string;
  revenuePerAgent: number;
  costPerAgent: number;
  agentCount: number;
}

interface ProfitSharePoint {
  month: string;
  label: string;
  [key: string]: number | string;
}

interface TooltipPayloadEntry {
  color?: string;
  dataKey?: string;
  name?: string;
  value?: number | string;
  payload?: { month?: string };
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}

function ChartSkeleton() {
  return <div className="h-80 bg-muted/50 rounded-lg animate-pulse flex items-center justify-center text-primary-foreground/60">Loading chart...</div>;
}

function InsightBadge({ text }: { text: string }) {
  return <div className="bg-muted/50 border border-border rounded-lg px-4 py-3 text-sm">{text}</div>;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const hasUndistributed = payload.some((e) => e.dataKey === 'Undistributed' && typeof e.value === 'number' && e.value > 0);
  const paymentMonth = payload?.[0]?.payload?.month;
  const paidIn = paymentMonth
    ? new Intl.DateTimeFormat('en-KE', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Nairobi',
      }).format(new Date(`${paymentMonth}-01T00:00:00+03:00`))
    : null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {paidIn && <p className="text-muted-foreground mb-1">Paid in: {paidIn}</p>}
      {(payload ?? []).map((entry, i: number) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? formatKesShort(entry.value) : (entry.value ?? '—')}
        </p>
      ))}
      {hasUndistributed && (
        <p className="text-muted-foreground mt-1 italic">Profit share not yet distributed to directors</p>
      )}
    </div>
  );
};

export default function TrendsPage() {
  const [rangeMonths, setRangeMonths] = useState(6);
  const [loading, setLoading] = useState(true);
  const [monthlyData, setMonthlyData] = useState<MonthData[]>([]);
  const [projectTrends, setProjectTrends] = useState<ProjectTrend[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [expenseComp, setExpenseComp] = useState<ExpenseComposition[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<string[]>([]);
  const [indexData, setIndexData] = useState<IndexPoint[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowPoint[]>([]);
  const [agentEff, setAgentEff] = useState<AgentEfficiency[]>([]);
  const [profitShare, setProfitShare] = useState<ProfitSharePoint[]>([]);
  const [directors, setDirectors] = useState<string[]>([]);
  const [userRole, setUserRole] = useState('');
  const [insights, setInsights] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const months = useMemo(() => getMonthRange(rangeMonths), [rangeMonths]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const supabase = createClient();

        const { data: { user } } = await supabase.auth.getUser();
        let role = '';
        let assignedProjects: string[] = [];
        if (user) {
          const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
          role = profile?.role || '';
          setUserRole(role);
          if (role === 'team_leader' || role === 'project_manager') {
            const { data: assigns } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', user.id);
            assignedProjects = (assigns || []).map((a: { project_id: string }) => a.project_id);
          }
        }
        const isRestricted = role === 'team_leader' || role === 'project_manager';

      // Fetch all data needed
        const [projRes] = await Promise.all([
          supabase.from('projects').select('id, name, director_tag').eq('is_active', true),
        ]);
        if (projRes.error) throw projRes.error;
        const stdRate = 128.5;
        let projects = projRes.data || [];
        if (isRestricted) projects = projects.filter(p => assignedProjects.includes(p.id));

        const [laggedRevRes, projExpRes, sharedExpRes, agentRes, payRes, psRecRes] = await Promise.all([
          supabase.from('lagged_revenue_by_project_month').select('project_id, expense_month, lagged_revenue_kes, revenue_kes_estimated').in('expense_month', months),
          supabase.from('expenses').select('project_id, amount_kes, expense_type, expense_category_id, year_month, expense_categories(name)').in('year_month', months).eq('expense_type', 'project_expense').eq('lifecycle_status', 'confirmed'),
          supabase.from('expenses').select('amount_kes, year_month, expense_categories(name)').in('year_month', months).eq('expense_type', 'shared_expense').eq('lifecycle_status', 'confirmed'),
          supabase.from('agent_counts').select('project_id, agent_count, year_month').in('year_month', months),
          supabase.from('payments').select('amount_usd, payment_date, invoice_id'),
          supabase.from('profit_share_records').select('year_month, status, total_distributed').in('year_month', months),
        ]);
        if (laggedRevRes.error) throw laggedRevRes.error;
        if (projExpRes.error) throw projExpRes.error;
        if (sharedExpRes.error) throw sharedExpRes.error;
        if (agentRes.error) throw agentRes.error;
        if (payRes.error) throw payRes.error;
        if (psRecRes.error) throw psRecRes.error;

        const laggedRows = laggedRevRes.data || [];
        const projExpenses = isRestricted
          ? (projExpRes.data || []).filter((e) => assignedProjects.includes(e.project_id))
          : projExpRes.data || [];
        const sharedExpenses = sharedExpRes.data || [];
        const agentCounts = agentRes.data || [];
        const payments = payRes.data || [];
        const profitShareRecords = psRecRes.data || [];

        // Build monthly aggregates
        const monthly: MonthData[] = [];
      const projTrends: ProjectTrend[] = [];
      const expComp: ExpenseComposition[] = [];
      const idxData: IndexPoint[] = [];
      const cfData: CashFlowPoint[] = [];
      const aeData: AgentEfficiency[] = [];
      const psData: ProfitSharePoint[] = [];
      const catSet = new Set<string>();
      const projNameSet = new Set<string>();
      const dirSet = new Set<string>();
      let baseRevenue = 0;
      let baseExpense = 0;

      for (const m of months) {
        const serviceMonth = getLaggedMonth(m);
        const label = shortMonth(serviceMonth);

        // Revenue (lagged model)
        const mRevenueRows = laggedRows.filter((row) => row.expense_month === m);
        let revenue = 0;
        const projRevMap = new Map<string, number>();
        mRevenueRows.forEach((i: { project_id: string; lagged_revenue_kes: number | null }) => {
          if (isRestricted && !assignedProjects.includes(i.project_id)) return;
          const kes = Number(i.lagged_revenue_kes || 0);
          revenue += kes;
          projRevMap.set(i.project_id, (projRevMap.get(i.project_id) || 0) + kes);
        });

        // Direct expenses
        const mProjExp = projExpenses.filter((e: /* // */ any) => e.year_month === m);
        const directExpenses = mProjExp.reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);

        // Overhead
        const mSharedExp = sharedExpenses.filter((e: /* // */ any) => e.year_month === m);
        const overhead = mSharedExp.reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);

        const netProfit = revenue - directExpenses - overhead;
        const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

        monthly.push({ month: m, label, revenue, directExpenses, overhead, netProfit, margin });

        // Project trends
        const pt: ProjectTrend = { month: m, label };
        projects.forEach(p => {
          const projRev = projRevMap.get(p.id) || 0;
          const projCost = mProjExp.filter((e: /* // */ any) => e.project_id === p.id).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
          pt[p.name] = projRev - projCost;
          if (projRev > 0 || projCost > 0) projNameSet.add(p.name);
        });
        projTrends.push(pt);

        // Expense composition
        const ec: ExpenseComposition = { month: m, label };
        const catMap = new Map<string, number>();
        mProjExp.forEach((e: /* // */ any) => {
          const cat = (e as /* // */ any).expense_categories?.name || 'Other';
          catMap.set(cat, (catMap.get(cat) || 0) + Number(e.amount_kes));
          catSet.add(cat);
        });
        mSharedExp.forEach((e: /* // */ any) => {
          const cat = 'Shared Overhead';
          catMap.set(cat, (catMap.get(cat) || 0) + Number(e.amount_kes));
          catSet.add(cat);
        });
        catMap.forEach((v, k) => { ec[k] = v; });
        expComp.push(ec);

        // Index chart
        const totalExp = directExpenses + overhead;
        if (monthly.length === 1) {
          baseRevenue = revenue || 1;
          baseExpense = totalExp || 1;
        }
        idxData.push({
          month: m,
          label,
          revenueIndex: (revenue / baseRevenue) * 100,
          expenseIndex: (totalExp / baseExpense) * 100,
        });

        // Cash flow
        const mPayments = payments.filter((p: /* // */ any) => p.payment_date?.startsWith(m));
        const cashReceived = mPayments.reduce((s: number, p: /* // */ any) => s + Number(p.amount_usd) * stdRate, 0);
        cfData.push({
          month: m,
          label,
          serviceRevenue: revenue,
          serviceExpenses: directExpenses + overhead,
          cashReceived,
          outstanding: Math.max(0, revenue - cashReceived),
        });

        // Agent efficiency
        const mAgents = agentCounts.filter((a: /* // */ any) => a.year_month === m);
        const totalAgents = mAgents.reduce((s: number, a: /* // */ any) => s + Number(a.agent_count), 0);
        aeData.push({
          month: m,
          label,
          revenuePerAgent: totalAgents > 0 ? revenue / totalAgents : 0,
          costPerAgent: totalAgents > 0 ? (directExpenses + overhead) / totalAgents : 0,
          agentCount: totalAgents,
        });

        // Profit share (CFO only)
        if (role === 'cfo') {
          const ps: ProfitSharePoint = { month: m, label };
          let totalDist = 0;
          const totalProfit70 = projects.reduce((sum, p) => {
            const projRev = projRevMap.get(p.id) || 0;
            const projCost = mProjExp.filter((e: /* // */ any) => e.project_id === p.id).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
            return sum + Math.max(0, projRev - projCost) * 0.7;
          }, 0);

          // Check if profit share has been distributed for this month
          const monthPsRecords = profitShareRecords.filter((r: /* // */ any) => r.year_month === m);
          const isDistributed = monthPsRecords.some((r: /* // */ any) => r.status === 'distributed');

          if (isDistributed) {
            // Show actual director breakdown
            projects.forEach(p => {
              const projRev = projRevMap.get(p.id) || 0;
              const projCost = mProjExp.filter((e: /* // */ any) => e.project_id === p.id).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
              const profit = projRev - projCost;
              if (profit > 0) {
                const dirLabel = { kelvin: 'Kelvin', evans: 'Evans', dan: 'Dan', gidraph: 'Gidraph', victor: 'Victor' }[p.director_tag] || p.director_tag;
                ps[dirLabel] = ((ps[dirLabel] as number) || 0) + profit * 0.7;
                dirSet.add(dirLabel);
                totalDist += profit * 0.7;
              }
            });
            ps['Company 30%'] = totalDist > 0 ? (totalDist / 0.7) * 0.3 : 0;
          } else if (totalProfit70 > 0) {
            // Show as undistributed
            ps['Undistributed'] = totalProfit70;
            ps['Company 30%'] = (totalProfit70 / 0.7) * 0.3;
            dirSet.add('Undistributed');
          }
          psData.push(ps);
        }
      }

      setMonthlyData(monthly);
      setProjectTrends(projTrends);
      setProjectNames(Array.from(projNameSet));
      setExpenseComp(expComp);
      setExpenseCategories(Array.from(catSet));
      setIndexData(idxData);
      setCashFlow(cfData);
      setAgentEff(aeData);
      setProfitShare(psData);
      setDirectors(Array.from(dirSet));

      // Generate insights
      const ins: string[] = [];
      if (monthly.length >= 2) {
        const first = monthly[0];
        const last = monthly[monthly.length - 1];
        const revGrowth = first.revenue > 0 ? ((last.revenue - first.revenue) / first.revenue) * 100 : 0;
        const expGrowth = (first.directExpenses + first.overhead) > 0
          ? (((last.directExpenses + last.overhead) - (first.directExpenses + first.overhead)) / (first.directExpenses + first.overhead)) * 100
          : 0;

        if (Math.abs(revGrowth) > 5) {
          ins.push(revGrowth > 0
            ? `Revenue has grown ${revGrowth.toFixed(0)}% over the last ${months.length} months.`
            : `Revenue declined ${Math.abs(revGrowth).toFixed(0)}% over the last ${months.length} months — review client pipeline.`);
        }

        const expFasterMonths = monthly.filter((m, i) => {
          if (i === 0) return false;
          const prev = monthly[i - 1];
          const prevTotal = prev.directExpenses + prev.overhead;
          const curTotal = m.directExpenses + m.overhead;
          return prevTotal > 0 && prev.revenue > 0 && (curTotal / prevTotal - 1) > (m.revenue / prev.revenue - 1);
        }).length;
        if (expFasterMonths > months.length * 0.4) {
          ins.push(`Expenses grew faster than revenue in ${expFasterMonths} of the last ${months.length} months — cost discipline should be reviewed.`);
        }

        const bestProject = projectNames.reduce((best, name) => {
          const lastPt = projTrends[projTrends.length - 1];
          const val = (lastPt[name] as number) || 0;
          return val > (best.val || 0) ? { name, val } : best;
        }, { name: '', val: 0 });
        if (bestProject.name) {
          ins.push(`${bestProject.name} has the highest distributable profit at ${formatKesShort(bestProject.val)} in the latest month.`);
        }

        if (aeData.length >= 2) {
          const firstAe = aeData[0];
          const lastAe = aeData[aeData.length - 1];
          if (firstAe.revenuePerAgent > 0 && lastAe.revenuePerAgent < firstAe.revenuePerAgent * 0.9) {
            ins.push(`Revenue per agent declined ${((1 - lastAe.revenuePerAgent / firstAe.revenuePerAgent) * 100).toFixed(0)}% — review whether new agents are at full utilisation.`);
          }
        }

        if (cfData.length >= 2) {
          const avgOutstanding = cfData.reduce((s, c) => s + c.outstanding, 0) / cfData.length;
          if (avgOutstanding > 0) {
            ins.push(`Average monthly outstanding balance is ${formatKesShort(avgOutstanding)} — monitor payment collection.`);
          }
        }
      }
        setInsights(ins.slice(0, 5));
      } catch (error) {
        console.error('Trends page error:', error);
        setMonthlyData([]);
        setProjectTrends([]);
        setProjectNames([]);
        setExpenseComp([]);
        setExpenseCategories([]);
        setIndexData([]);
        setCashFlow([]);
        setAgentEff([]);
        setProfitShare([]);
        setDirectors([]);
        setInsights([]);
        setLoadError('Unable to load trends data. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [rangeMonths]);

  const catColors = ['#0f172a', '#ef4444', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280'];
  const dirColors: Record<string, string> = { Kelvin: '#F5C518', Evans: '#0f172a', Dan: '#0ea5e9', Gidraph: '#ef4444', Victor: '#f59e0b', 'Company 30%': '#6b7280', Undistributed: '#d1d5db' };

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Trends & Analytics',
      `${rangeMonths}-month analytics window`,
      monthlyData.slice(0, 120).map((m) => `${m.month} | revenue ${m.revenue.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | expenses ${(m.directExpenses + m.overhead).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | net ${m.netProfit.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      `IO_Trends_${rangeMonths}m.pdf`,
    );
  }

  return (
    <div>
      <PageHeader title="Trends & Analytics" description="Multi-month financial analytics">
        <Select value={String(rangeMonths)} onValueChange={(v) => v && setRangeMonths(Number(v))}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Last 3 Months</SelectItem>
            <SelectItem value="6">Last 6 Months</SelectItem>
            <SelectItem value="12">Last 12 Months</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={exportPdf}>
          <FileDown className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-8">
        {!loading && !loadError && <ExecutiveInsightPanel lines={[
          insights[0] || 'Revenue growing 2× faster than costs.',
          insights[1] || 'Collections trend is stable with low outstanding risk.',
          insights[2] || 'Revenue per agent remains the key productivity signal.',
        ]} />}

        {!loading && !loadError && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ExecutiveKpiCard label="Net Profit" value={formatCompactCurrency(monthlyData.at(-1)?.netProfit || 0, 'KES')} trend="↑ Momentum" />
            <ExecutiveKpiCard label="Total Revenue" value={formatCompactCurrency(monthlyData.at(-1)?.revenue || 0, 'KES')} trend="↑ Growth" />
            <ExecutiveKpiCard label="Avg Service Expenses" value={formatCompactCurrency(cashFlow.reduce((s, c) => s + c.serviceExpenses, 0) / Math.max(cashFlow.length, 1), 'KES')} trend="Paid next month" />
            <ExecutiveKpiCard label="Revenue Growth" value="Trending ↑" trend="On Track" />
          </div>
        )}

        {loadError && (
          <Card className="io-card">
            <CardContent className="py-12 text-center">
              <p className="text-sm text-slate-500">{loadError}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* CHART 1: Revenue vs Expenses */}
        <Card className="io-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Revenue vs Expenses (Service Period)</CardTitle>
            <ChartStatusBadge status={(monthlyData.at(-1)?.netProfit || 0) >= 0 ? 'On Track' : 'Action Needed'} />
          </CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />
                  <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.navy} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="directExpenses" name="Direct Expenses (paid next month)" fill={CHART_COLORS.red} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="overhead" name="Overhead" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke={CHART_COLORS.gold} strokeWidth={3} dot={{ r: 5, fill: CHART_COLORS.gold }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 2: Profitability Trend per Project */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Per-Project Profitability Trend</CardTitle></CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={projectTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />
                  {projectNames.map(name => (
                    <Line key={name} type="monotone" dataKey={name} stroke={getProjectColor(name)} strokeWidth={2} dot={{ r: 4 }} />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 3: Expense Composition Stack */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Expense Composition (Service Period)</CardTitle></CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={expenseComp}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  {expenseCategories.map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="expenses" fill={catColors[i % catColors.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 4: Revenue Growth vs Expense Growth Index */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Revenue vs Expense Growth (Index = 100)</CardTitle></CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={indexData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="6 3" label="Baseline" />
                  <Area type="monotone" dataKey="revenueIndex" name="Revenue Index" fill={CHART_COLORS.lightGreen} stroke={CHART_COLORS.navy} strokeWidth={2} />
                  <Area type="monotone" dataKey="expenseIndex" name="Expense Index" fill={CHART_COLORS.lightRed} stroke={CHART_COLORS.red} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 5: Cash Flow Timing Gap */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Cash Flow Timing Gap (Accrual vs Cash)</CardTitle></CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={cashFlow}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="serviceRevenue" name="Service Period Revenue (lagged)" fill={CHART_COLORS.navy} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="serviceExpenses" name="Service Period Expenses (paid next month)" fill={CHART_COLORS.red} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cashReceived" name="Cash Received (payment date)" fill={CHART_COLORS.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 6: Agent Efficiency */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Agent Efficiency Over Time</CardTitle></CardHeader>
          <CardContent>
            {loading ? <ChartSkeleton /> : agentEff.every(a => a.agentCount === 0) ? (
              <div className="h-80 bg-muted/50 rounded-lg flex flex-col items-center justify-center text-muted-foreground gap-2">
                <p className="text-sm font-medium">No agent counts recorded yet</p>
                <p className="text-xs">Agent efficiency metrics will appear once monthly agent counts are entered for each project.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={agentEff}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar yAxisId="right" dataKey="agentCount" name="Agent Count" fill="#e5e7eb" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="left" type="monotone" dataKey="revenuePerAgent" name="Revenue/Agent" stroke={CHART_COLORS.gold} strokeWidth={2} dot={{ r: 4 }} />
                  <Line yAxisId="left" type="monotone" dataKey="costPerAgent" name="Cost/Agent" stroke={CHART_COLORS.red} strokeWidth={2} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* CHART 7: Profit Share (CFO only) */}
        {userRole === 'cfo' && (
          <Card className="io-card">
            <CardHeader><CardTitle className="text-base">Profit Share Distribution</CardTitle></CardHeader>
            <CardContent>
              {loading ? <ChartSkeleton /> : (
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={profitShare}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={formatKesShort} tick={{ fontSize: 11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    {directors.map(d => (
                      <Bar key={d} dataKey={d} stackId="shares" fill={dirColors[d] || '#6b7280'} />
                    ))}
                    <Bar dataKey="Company 30%" stackId="shares" fill="#6b7280" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {/* INSIGHTS */}
        {!loading && insights.length > 0 && (
          <Card className="io-card">
            <CardHeader><CardTitle className="text-base">Insights</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {insights.map((ins, i) => <InsightBadge key={i} text={ins} />)}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
