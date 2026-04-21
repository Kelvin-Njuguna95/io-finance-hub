'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  DollarSign,
  Landmark,
  PieChart,
  TrendingUp,
  Wallet,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { HeroCard } from '@/components/layout/hero-card';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  formatCurrency,
  formatPercent,
  getCurrentYearMonth,
  formatYearMonth,
} from '@/lib/format';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';
import { getPmReviewQueueCount } from '@/lib/queries/budgets';
import { getTotalPaidUsd } from '@/lib/cash-balance';

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
  const [bankBalance, setBankBalance] = useState(0);
  const currentMonth = getCurrentYearMonth();

  const prevDate = new Date(
    parseInt(currentMonth.split('-')[0]),
    parseInt(currentMonth.split('-')[1]) - 2,
    1,
  );
  const revenueSourceMonth =
    prevDate.getFullYear() +
    '-' +
    String(prevDate.getMonth() + 1).padStart(2, '0');

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const { data: assignments } = await supabase
        .from('user_project_assignments')
        .select('project_id')
        .eq('user_id', userId);
      const pids = (assignments || []).map(
        (a: { project_id: string }) => a.project_id,
      );

      const { data: allProjects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      const { data: rateSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'standard_exchange_rate')
        .single();
      const stdRate = parseFloat(rateSetting?.value || '129.5');
      const { data: balSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'bank_balance_usd')
        .single();
      const seedBalance = parseFloat(balSetting?.value || '0');
      const { data: allWd } = await supabase
        .from('withdrawals')
        .select('amount_usd');
      const totalWd = (allWd || []).reduce(
        (s: number, w: { amount_usd: number }) => s + Number(w.amount_usd),
        0,
      );
      const { data: allInvoicesEver } = await supabase
        .from('invoices')
        .select('amount_usd, status, payments(amount_usd)');
      const totalPaid = getTotalPaidUsd(allInvoicesEver || []);
      setBankBalance(seedBalance + totalPaid - totalWd);

      const { data: invoices } = await supabase
        .from('invoices')
        .select('project_id, amount_usd, amount_kes')
        .eq('billing_period', revenueSourceMonth);

      const { data: expenses } = await supabase
        .from('expenses')
        .select('project_id, amount_kes')
        .eq('year_month', currentMonth)
        .eq('expense_type', 'project_expense');

      const { data: agents } = await supabase
        .from('agent_counts')
        .select('project_id, agent_count')
        .eq('year_month', currentMonth);

      const { data: budgets } = await supabase
        .from('budgets')
        .select(
          'project_id, pm_approved_total, budget_versions(status, total_amount_kes)',
        )
        .eq('year_month', currentMonth);

      // Pending budgets for PM review, scoped to PM's projects via shared helper
      const { count: pmReviewCount } = await getPmReviewQueueCount(supabase, pids);
      setPendingBudgets(pmReviewCount || 0);

      const invMap = new Map<string, number>();
      (invoices || []).forEach(
        (i: { project_id: string; amount_usd: number; amount_kes: number }) => {
          const kes =
            Number(i.amount_kes) > 0
              ? Number(i.amount_kes)
              : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
          invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
        },
      );

      const expMap = new Map<string, number>();
      (expenses || []).forEach(
        (e: { project_id: string; amount_kes: number }) => {
          expMap.set(
            e.project_id,
            (expMap.get(e.project_id) || 0) + Number(e.amount_kes),
          );
        },
      );

      const agentMap = new Map<string, number>();
      (agents || []).forEach(
        (a: { project_id: string; agent_count: number }) =>
          agentMap.set(a.project_id, Number(a.agent_count)),
      );

      const budgetMap = new Map<string, { status: string; amount: number }>();
      (budgets || []).forEach(
        (b: {
          project_id: string;
          pm_approved_total: number | null;
          budget_versions?: Array<{ status: string; total_amount_kes: number }>;
        }) => {
          const vers = b.budget_versions || [];
          const best = vers.find((v) => v.status === 'approved') || vers[0];
          budgetMap.set(b.project_id, {
            status: best?.status || 'none',
            amount: b.pm_approved_total || Number(best?.total_amount_kes || 0),
          });
        },
      );

      const rows: ProjectData[] = (allProjects || [])
        .map((p: { id: string; name: string }) => {
          const rev = invMap.get(p.id) || 0;
          const exp = expMap.get(p.id) || 0;
          const profit = rev - exp;
          const margin = rev > 0 ? (profit / rev) * 100 : 0;
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
        .filter(
          (r) =>
            r.revenue > 0 ||
            r.expenses > 0 ||
            r.budgetAmount > 0 ||
            r.agents > 0,
        );

      setProjects(rows);
      setTotalRevenue(rows.reduce((s, r) => s + r.revenue, 0));
      setTotalExpenses(rows.reduce((s, r) => s + r.expenses, 0));
    }
    load();
  }, [currentMonth, userId, revenueSourceMonth]);

  const totalProfit = totalRevenue - totalExpenses;

  return (
    <div className="p-6 space-y-6">
      <HeroCard
        stats={[
          {
            label: 'Bank Balance',
            value: formatCurrency(bankBalance, 'USD'),
            subtitle: 'Available after withdrawals',
            icon: Landmark,
            tone: 'brand',
          },
          {
            label: 'Revenue (Lagged)',
            value: formatCurrency(totalRevenue, 'KES'),
            subtitle: `From ${formatYearMonth(revenueSourceMonth)} invoice`,
            icon: DollarSign,
            tone: 'brand',
          },
          {
            label: 'Operating Profit',
            value: formatCurrency(totalProfit, 'KES'),
            subtitle: formatYearMonth(currentMonth),
            icon: Wallet,
            tone: totalProfit < 0 ? 'danger' : 'success',
          },
          {
            label: 'Pending Reviews',
            value: String(pendingBudgets),
            subtitle:
              pendingBudgets > 0 ? 'Budgets awaiting review' : 'All clear',
            icon: Briefcase,
            tone: pendingBudgets > 0 ? 'warning' : 'brand',
          },
        ]}
      />

      {totalRevenue > 0 && (
        <SectionCard
          title="Company P&L Summary"
          description={`Revenue from ${formatYearMonth(revenueSourceMonth)}, costs from ${formatYearMonth(currentMonth)}`}
          icon={TrendingUp}
          tone="teal"
          action={
            <Link href="/reports/pnl">
              <Button variant="ghost" size="sm" className="gap-1">
                Full report
                <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            </Link>
          }
        >
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-foreground">Revenue</span>
              <span className="font-mono font-medium text-foreground">
                {formatCurrency(totalRevenue, 'KES')}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Direct Costs</span>
              <span className="font-mono text-danger-soft-foreground">
                -{formatCurrency(totalExpenses, 'KES')}
              </span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-semibold">
              <span>Gross Profit</span>
              <span
                className={cn(
                  'font-mono tabular-nums',
                  totalProfit < 0
                    ? 'text-danger-soft-foreground'
                    : 'text-success-soft-foreground',
                )}
              >
                {formatCurrency(totalProfit, 'KES')}
              </span>
            </div>
          </div>
        </SectionCard>
      )}

      <ExpenseQueuePanel compact />

      <SectionCard
        title="Project Performance"
        description="Lagged revenue vs. current-month direct costs"
        icon={BarChart3}
        tone="violet"
        action={
          <Link href="/reports/profitability">
            <Button variant="ghost" size="sm" className="gap-1">
              Details
              <ArrowRight className="size-3.5" aria-hidden />
            </Button>
          </Link>
        }
      >
        {projects.length === 0 ? (
          <EmptyState
            icon={PieChart}
            tone="neutral"
            title="No project data for this month yet"
            description="Financials appear once invoices, expenses, or agent counts are recorded."
          />
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li
                key={p.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.agents > 0 ? `${p.agents} agents` : 'No agents set'}
                    {p.revenue > 0
                      ? ` · Revenue: ${formatCurrency(p.revenue, 'KES')}`
                      : ''}
                  </p>
                </div>
                <div className="text-right">
                  {p.revenue > 0 || p.expenses > 0 ? (
                    <>
                      <p
                        className={cn(
                          'font-mono text-sm font-medium tabular-nums',
                          p.profit < 0
                            ? 'text-danger-soft-foreground'
                            : 'text-success-soft-foreground',
                        )}
                      >
                        {formatCurrency(p.profit, 'KES')}
                      </p>
                      <Badge
                        variant="secondary"
                        className={cn(
                          p.margin > 30
                            ? 'bg-success-soft text-success-soft-foreground'
                            : p.margin > 10
                              ? 'bg-warning-soft text-warning-soft-foreground'
                              : 'bg-danger-soft text-danger-soft-foreground',
                        )}
                      >
                        {formatPercent(p.margin)} margin
                      </Badge>
                    </>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="bg-muted text-muted-foreground"
                    >
                      {p.budgetStatus !== 'none' ? p.budgetStatus : 'No data'}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
