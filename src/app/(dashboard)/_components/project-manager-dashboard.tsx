'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { HeroCard } from '@/components/layout/hero-card';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import {
  DollarSign, TrendingUp, PieChart, Users, FileText, ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';
import { getPmReviewQueueCount } from '@/lib/queries/budgets';

interface ProjectData {
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number;
  agents: number;
  budgetStatus: string;
  budgetAmount: number;
}

interface Props {
  userId: string;
}

export function ProjectManagerDashboard({ userId }: Props) {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [pendingBudgets, setPendingBudgets] = useState(0);
  const [totalAgents, setTotalAgents] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const currentMonth = getCurrentYearMonth();

  const prevDate = new Date(parseInt(currentMonth.split('-')[0]), parseInt(currentMonth.split('-')[1]) - 2, 1);
  const revenueSourceMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Get PM's assigned projects
      const { data: assignments } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', userId);
      const pids = (assignments || []).map((a: any) => a.project_id);

      // Get all projects (PM can see all for overview)
      const { data: allProjects } = await supabase.from('projects').select('id, name').eq('is_active', true).order('name');

      // Get exchange rate and bank balance
      const { data: rateSetting } = await supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
      const stdRate = parseFloat(rateSetting?.value || '129.5');
      const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
      const standingBal = parseFloat(balSetting?.value || '0');
      const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
      const totalWd = (allWd || []).reduce((s: number, w: any) => s + Number(w.amount_usd), 0);
      setBankBalance(standingBal - totalWd);

      // Get lagged invoices (previous month)
      const { data: invoices } = await supabase.from('invoices').select('project_id, amount_usd, amount_kes').eq('billing_period', revenueSourceMonth);

      // Get expenses (current month)
      const { data: expenses } = await supabase.from('expenses').select('project_id, amount_kes').eq('year_month', currentMonth).eq('expense_type', 'project_expense');

      // Get agent counts
      const { data: agents } = await supabase.from('agent_counts').select('project_id, agent_count').eq('year_month', currentMonth);

      // Get budgets
      const { data: budgets } = await supabase.from('budgets')
        .select('project_id, pm_approved_total, budget_versions(status, total_amount_kes)')
        .eq('year_month', currentMonth);

      // Get pending budgets for PM review
      const { count: pmReviewCount } = await getPmReviewQueueCount(supabase, pids);

      setPendingBudgets(pmReviewCount || 0);

      // Build maps
      const invMap = new Map<string, number>();
      (invoices || []).forEach((i: any) => {
        const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
        invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
      });

      const expMap = new Map<string, number>();
      (expenses || []).forEach((e: any) => {
        expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
      });

      const agentMap = new Map<string, number>();
      (agents || []).forEach((a: any) => agentMap.set(a.project_id, Number(a.agent_count)));

      const budgetMap = new Map<string, { status: string; amount: number }>();
      (budgets || []).forEach((b: any) => {
        const vers = b.budget_versions || [];
        const best = vers.find((v: any) => v.status === 'approved') || vers[0];
        budgetMap.set(b.project_id, {
          status: best?.status || 'none',
          amount: b.pm_approved_total || Number(best?.total_amount_kes || 0),
        });
      });

      // Build project rows
      const rows: ProjectData[] = (allProjects || [])
        .map((p: any) => {
          const rev = invMap.get(p.id) || 0;
          const exp = expMap.get(p.id) || 0;
          const profit = rev - exp;
          const margin = rev > 0 ? (profit / rev * 100) : 0;
          const ag = agentMap.get(p.id) || 0;
          const bud = budgetMap.get(p.id);
          return {
            name: p.name,
            revenue: rev,
            expenses: exp,
            profit,
            margin,
            agents: ag,
            budgetStatus: bud?.status || 'none',
            budgetAmount: bud?.amount || 0,
          };
        })
        .filter(r => r.revenue > 0 || r.expenses > 0 || r.budgetAmount > 0 || r.agents > 0);

      setProjects(rows);
      setTotalRevenue(rows.reduce((s, r) => s + r.revenue, 0));
      setTotalExpenses(rows.reduce((s, r) => s + r.expenses, 0));
      setTotalAgents(rows.reduce((s, r) => s + r.agents, 0));
    }
    load();
  }, [currentMonth, userId, revenueSourceMonth]);

  const totalProfit = totalRevenue - totalExpenses;

  return (
    <div>
      <div className="p-6 space-y-6">
        {/* Hero Card */}
        <HeroCard stats={[
          { label: 'Bank Balance', value: formatCurrency(bankBalance, 'USD'), subtitle: 'Available after withdrawals' },
          { label: 'Revenue (Lagged)', value: formatCurrency(totalRevenue, 'KES'), subtitle: 'From ' + formatYearMonth(revenueSourceMonth) + ' invoice' },
          { label: 'Operating Profit', value: formatCurrency(totalProfit, 'KES'), subtitle: formatYearMonth(currentMonth) },
          { label: 'Pending Reviews', value: String(pendingBudgets), subtitle: pendingBudgets > 0 ? 'Budgets awaiting review' : 'All clear' },
        ]} />

        {/* Company P&L summary */}
        {totalRevenue > 0 && (
          <Card className="io-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Company P&L Summary</CardTitle>
              <Link href="/reports/pnl">
                <Button variant="ghost" size="sm" className="gap-1">Full report <ArrowRight className="h-3 w-3" /></Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Revenue <span className="text-slate-400">(from {formatYearMonth(revenueSourceMonth)})</span></span>
                  <span className="font-mono font-medium">{formatCurrency(totalRevenue, 'KES')}</span>
                </div>
                <div className="flex justify-between text-sm text-red-600">
                  <span>Direct Costs</span>
                  <span className="font-mono">-{formatCurrency(totalExpenses, 'KES')}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Gross Profit</span>
                  <span className={`font-mono ${totalProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(totalProfit, 'KES')}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expense Queue — compact view for PM */}
        <ExpenseQueuePanel compact />

        {/* Project Performance */}
        <Card className="io-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Project Performance</CardTitle>
            <Link href="/reports/profitability">
              <Button variant="ghost" size="sm" className="gap-1">Details <ArrowRight className="h-3 w-3" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">No project data for this month yet</p>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.name} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-neutral-500">
                        {p.agents > 0 ? `${p.agents} agents` : 'No agents set'}
                        {p.revenue > 0 ? ` · Revenue: ${formatCurrency(p.revenue, 'KES')}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      {p.revenue > 0 || p.expenses > 0 ? (
                        <>
                          <p className={`text-sm font-mono font-medium ${p.profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {formatCurrency(p.profit, 'KES')}
                          </p>
                          <Badge
                            variant="secondary"
                            className={
                              p.margin > 30 ? 'bg-emerald-100 text-emerald-700' :
                              p.margin > 10 ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }
                          >
                            {formatPercent(p.margin)} margin
                          </Badge>
                        </>
                      ) : (
                        <Badge variant="secondary" className="bg-slate-100 text-slate-500">
                          {p.budgetStatus !== 'none' ? p.budgetStatus : 'No data'}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
