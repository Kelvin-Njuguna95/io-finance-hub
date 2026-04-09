'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RoleInsightBoard } from '@/components/reports/role-insight-board';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth } from '@/lib/report-utils';
import { isBackdated } from '@/lib/backdated-utils';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, Tooltip,
} from 'recharts';
import { getProjectColor } from '@/lib/report-utils';
import { BarChart3, TrendingUp, Users, DollarSign } from 'lucide-react';

interface ProjectComparison {
  name: string;
  revenue: number;
  directExpenses: number;
  grossProfit: number;
  grossMargin: number;
  overheadAllocated: number;
  distributableProfit: number;
  netMargin: number;
  agentCount: number;
  revenuePerAgent: number;
  costPerAgent: number;
  director: string;
  // Radar scores (0-100)
  radarGrossMargin: number;
  radarBudgetUtil: number;
  radarRevPerAgent: number;
  radarCostEff: number;
}

export default function ProjectComparisonPage() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProjectComparison[]>([]);
  const [userRole, setUserRole] = useState('');

  const [revenueSourceMonth, setRevenueSourceMonth] = useState(getLaggedMonth(selectedMonth));
  const [isHistorical, setIsHistorical] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
        setUserRole(profile?.role || '');
      }

      // Detect historical months — use direct matching
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('data_source')
        .eq('year_month', selectedMonth)
        .single();
      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      setIsHistorical(historical);
      const revMonth = historical ? selectedMonth : getLaggedMonth(selectedMonth);
      setRevenueSourceMonth(revMonth);

      const [projRes, rateRes, invRes, projExpRes, sharedExpRes, agentRes, budRes] = await Promise.all([
        supabase.from('projects').select('id, name, director_tag').eq('is_active', true),
        supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single(),
        supabase.from('invoices').select('project_id, amount_usd, amount_kes, description').eq('billing_period', revMonth),
        supabase.from('expenses').select('project_id, amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense'),
        supabase.from('expenses').select('amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'shared_expense'),
        supabase.from('agent_counts').select('project_id, agent_count').eq('year_month', selectedMonth),
        supabase.from('budgets').select('id, project_id, pm_approved_total, budget_versions(total_amount_kes, status)').eq('year_month', selectedMonth),
      ]);

      const stdRate = parseFloat(rateRes.data?.value || '129.5');
      const projects = projRes.data || [];
      const invoices = invRes.data || [];
      const projExpenses = projExpRes.data || [];
      const totalOverhead = (sharedExpRes.data || []).reduce((s: number, e: any) => s + Number(e.amount_kes), 0);
      const agents = agentRes.data || [];
      const budgets = budRes.data || [];

      const directorLabels: Record<string, string> = { kelvin: 'Kelvin', evans: 'Evans', dan: 'Dan', gidraph: 'Gidraph', victor: 'Victor' };

      // Revenue map
      const revMap = new Map<string, number>();
      invoices.filter((i: any) => !isBackdated(i.description)).forEach((i: any) => {
        const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
        revMap.set(i.project_id, (revMap.get(i.project_id) || 0) + kes);
      });

      // Expense map
      const expMap = new Map<string, number>();
      projExpenses.forEach((e: any) => {
        expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
      });

      // Agent map
      const agentMap = new Map<string, number>();
      agents.forEach((a: any) => { agentMap.set(a.project_id, Number(a.agent_count)); });

      // Budget util map
      const budgetMap = new Map<string, number>();
      budgets.forEach((b: any) => {
        if (!b.project_id) return;
        const approved = (b.budget_versions || []).find((v: any) => v.status === 'approved');
        const amt = b.pm_approved_total ? Number(b.pm_approved_total) : Number(approved?.total_amount_kes || 0);
        budgetMap.set(b.project_id, (budgetMap.get(b.project_id) || 0) + amt);
      });

      const totalRevenue = Array.from(revMap.values()).reduce((s, v) => s + v, 0);

      const rows: ProjectComparison[] = projects
        .filter(p => revMap.has(p.id) || expMap.has(p.id) || agentMap.has(p.id))
        .map(p => {
          const revenue = revMap.get(p.id) || 0;
          const directExpenses = expMap.get(p.id) || 0;
          const grossProfit = revenue - directExpenses;
          const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
          const overheadAllocated = totalRevenue > 0 ? (revenue / totalRevenue) * totalOverhead : 0;
          const distributableProfit = grossProfit - overheadAllocated;
          const netMargin = revenue > 0 ? (distributableProfit / revenue) * 100 : 0;
          const agentCount = agentMap.get(p.id) || 0;
          const revenuePerAgent = agentCount > 0 ? revenue / agentCount : 0;
          const costPerAgent = agentCount > 0 ? directExpenses / agentCount : 0;
          const budgetAmt = budgetMap.get(p.id) || 0;
          const budgetUtil = budgetAmt > 0 ? (directExpenses / budgetAmt) * 100 : 0;

          return {
            name: p.name,
            revenue,
            directExpenses,
            grossProfit,
            grossMargin,
            overheadAllocated,
            distributableProfit,
            netMargin,
            agentCount,
            revenuePerAgent,
            costPerAgent,
            director: directorLabels[p.director_tag] || p.director_tag,
            radarGrossMargin: Math.min(100, Math.max(0, grossMargin)),
            radarBudgetUtil: Math.min(100, Math.max(0, budgetUtil > 85 ? 100 - Math.abs(budgetUtil - 85) : budgetUtil)),
            radarRevPerAgent: 0, // normalized below
            radarCostEff: 0,
          };
        })
        .sort((a, b) => b.distributableProfit - a.distributableProfit);

      // Normalize radar scores
      const maxRevPA = Math.max(...rows.map(r => r.revenuePerAgent), 1);
      const maxCostPA = Math.max(...rows.map(r => r.costPerAgent), 1);
      rows.forEach(r => {
        r.radarRevPerAgent = (r.revenuePerAgent / maxRevPA) * 100;
        r.radarCostEff = (1 - r.costPerAgent / maxCostPA) * 100;
      });

      setData(rows);
      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalExpenses = data.reduce((s, r) => s + r.directExpenses, 0);
  const totalProfit = data.reduce((s, r) => s + r.distributableProfit, 0);
  const totalAgents = data.reduce((s, r) => s + r.agentCount, 0);

  // Radar data
  const radarDimensions = ['Gross Margin', 'Budget Util', 'Rev/Agent', 'Cost Eff'];
  const radarData = radarDimensions.map((dim, i) => {
    const point: any = { dimension: dim };
    data.forEach(p => {
      point[p.name] = [p.radarGrossMargin, p.radarBudgetUtil, p.radarRevPerAgent, p.radarCostEff][i];
    });
    return point;
  });

  return (
    <div>
      <PageHeader title="Project Comparison" description={isHistorical ? `Revenue & Expenses from ${formatYearMonth(selectedMonth)} (historical)` : `Revenue from ${formatYearMonth(revenueSourceMonth)} | Expenses from ${formatYearMonth(selectedMonth)}`}>
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6 space-y-6">
        <RoleInsightBoard
          insights={[
            {
              role: 'PM',
              headline: totalProfit >= 0 ? 'Portfolio distributable performance is positive.' : 'Portfolio distributable performance is negative.',
              items: [
                `Total distributable: ${formatCurrency(totalProfit, 'KES')}.`,
                `Median net margin: ${data.length ? formatPercent([...data].sort((a, b) => a.netMargin - b.netMargin)[Math.floor(data.length / 2)].netMargin) : 'N/A'}.`,
                `Positive projects: ${data.filter((p) => p.distributableProfit > 0).length}/${data.length}.`,
              ],
            },
            {
              role: 'Team Lead',
              headline: totalAgents > 0 ? `Operational footprint includes ${totalAgents} agents.` : 'No agent footprint recorded this month.',
              items: [
                `Revenue per agent (portfolio): ${totalAgents > 0 ? formatCurrency(totalRevenue / totalAgents, 'KES') : 'N/A'}.`,
                `Cost per agent (portfolio): ${totalAgents > 0 ? formatCurrency(totalExpenses / totalAgents, 'KES') : 'N/A'}.`,
                `Bottom projects by net margin: ${data.slice(-2).map((p) => p.name).join(', ') || 'N/A'}.`,
              ],
            },
            {
              role: 'Accountant',
              headline: 'Direct and allocated overhead are reconciled at project level.',
              items: [
                `Total direct expenses: ${formatCurrency(totalExpenses, 'KES')}.`,
                `Revenue source: ${isHistorical ? formatYearMonth(selectedMonth) : formatYearMonth(revenueSourceMonth)}.`,
                `Rows available for review: ${data.length}.`,
              ],
            },
            {
              role: 'CFO',
              headline: data[0]?.distributableProfit > 0 ? `${data[0]?.name} leads distributable returns.` : 'No project currently generating distributable upside.',
              items: [
                `Top project distributable: ${data[0] ? formatCurrency(data[0].distributableProfit, 'KES') : 'N/A'}.`,
                `Total revenue: ${formatCurrency(totalRevenue, 'KES')}.`,
                `Director-level attribution appears in table when CFO role is active.`,
              ],
            },
          ]}
        />

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Revenue" value={formatCurrency(totalRevenue, 'KES')} icon={DollarSign} />
          <StatCard title="Total Expenses" value={formatCurrency(totalExpenses, 'KES')} icon={BarChart3} />
          <StatCard title="Net Distributable" value={formatCurrency(totalProfit, 'KES')} icon={TrendingUp} />
          <StatCard title="Total Agents" value={String(totalAgents)} icon={Users} />
        </div>

        {/* Comparison table */}
        <Card className="io-card">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Direct Costs</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Overhead</TableHead>
                  <TableHead className="text-right">Dist. Profit</TableHead>
                  <TableHead className="text-right">Net Margin</TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                  <TableHead className="text-right">Rev/Agent</TableHead>
                  <TableHead className="text-right">Cost/Agent</TableHead>
                  {userRole === 'cfo' && <TableHead>Director</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={12} className="text-center py-8 text-neutral-400">Loading...</TableCell></TableRow>
                ) : data.length === 0 ? (
                  <TableRow><TableCell colSpan={12} className="text-center py-8 text-neutral-500">No data</TableCell></TableRow>
                ) : (
                  <>
                    {data.map(r => (
                      <TableRow key={r.name} className={r.distributableProfit > 0 ? 'bg-emerald-50/50' : r.distributableProfit < 0 ? 'bg-red-50/50' : ''}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(r.revenue, 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-600">{formatCurrency(r.directExpenses, 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${r.grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(r.grossProfit, 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatPercent(r.grossMargin)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-600">{formatCurrency(r.overheadAllocated, 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm font-semibold ${r.distributableProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(r.distributableProfit, 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${r.netMargin < 10 ? 'text-amber-600' : ''}`}>{formatPercent(r.netMargin)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{r.agentCount}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(r.revenuePerAgent, 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(r.costPerAgent, 'KES')}</TableCell>
                        {userRole === 'cfo' && <TableCell className="text-sm">{r.director}</TableCell>}
                      </TableRow>
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Radar Chart */}
        {!loading && data.length > 0 && (
          <Card className="io-card">
            <CardHeader><CardTitle className="text-base">Project Health Comparison</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                  {data.map(p => (
                    <Radar key={p.name} name={p.name} dataKey={p.name} stroke={getProjectColor(p.name)} fill={getProjectColor(p.name)} fillOpacity={0.15} />
                  ))}
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
