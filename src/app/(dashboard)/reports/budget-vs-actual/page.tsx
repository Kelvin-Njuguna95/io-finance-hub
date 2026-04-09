'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency } from '@/components/reports/executive-kit';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { getLaggedMonth, getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { getConfirmedExpensesByMonth } from '@/lib/queries/expenses';

interface BvaRow {
  scope: string;
  status: string;
  budget_kes: number;
  actual_kes: number;
  variance_kes: number;
  utilization_pct: number;
}

export default function BudgetVsActualPage() {
  const [rows, setRows] = useState<BvaRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [laggedRevenue, setLaggedRevenue] = useState(0);
  const [loading, setLoading] = useState(true);

  const [revenueSourceMonth, setRevenueSourceMonth] = useState('');
  const serviceMonth = getLaggedMonth(selectedMonth);
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Detect historical months — use direct matching
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('data_source')
        .eq('year_month', selectedMonth)
        .single();
      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      let revMonth: string;
      if (historical) {
        revMonth = selectedMonth;
      } else {
        const prevDate = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 2, 1);
        revMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
      }
      setRevenueSourceMonth(revMonth);

      // Get ALL budgets for this month (not just approved)
      const { data: budgets } = await supabase
        .from('budgets')
        .select('id, project_id, department_id, pm_approved_total, projects(name), departments(name), budget_versions(total_amount_kes, status, version_number)')
        .eq('year_month', selectedMonth);

      // Get expenses for this month
      const { data: expenses } = await getConfirmedExpensesByMonth(supabase, selectedMonth);

      // Expense by budget
      const expenseByBudget = new Map<string, number>();
      (expenses || []).forEach((e: any) => {
        if (e.budget_id) {
          expenseByBudget.set(e.budget_id, (expenseByBudget.get(e.budget_id) || 0) + Number(e.amount_kes));
        }
      });

      // Expense by project (for budgets without direct link)
      const expenseByProject = new Map<string, number>();
      (expenses || []).forEach((e: any) => {
        if (e.project_id) {
          expenseByProject.set(e.project_id, (expenseByProject.get(e.project_id) || 0) + Number(e.amount_kes));
        }
      });

      const result: BvaRow[] = (budgets || []).map((b: any) => {
        const versions = b.budget_versions || [];
        // Find the best version: approved > pm_approved > latest
        const approved = versions.find((v: any) => v.status === 'approved');
        const pmApproved = versions.find((v: any) => v.status === 'pm_approved');
        const latest = versions.sort((a: any, b: any) => b.version_number - a.version_number)[0];
        const bestVersion = approved || pmApproved || latest;

        // Use pm_approved_total if available, otherwise version total
        const budgetKes = b.pm_approved_total
          ? Number(b.pm_approved_total)
          : Number(bestVersion?.total_amount_kes || 0);

        const bestStatus = approved ? 'approved' : pmApproved ? 'pm_approved' : bestVersion?.status || 'draft';
        const actualKes = expenseByBudget.get(b.id) || (b.project_id ? expenseByProject.get(b.project_id) || 0 : 0);
        const variance = budgetKes - actualKes;
        const utilization = budgetKes > 0 ? (actualKes / budgetKes) * 100 : 0;

        return {
          scope: b.projects?.name || b.departments?.name || '—',
          status: bestStatus,
          budget_kes: budgetKes,
          actual_kes: actualKes,
          variance_kes: variance,
          utilization_pct: utilization,
        };
      });

      setRows(result);

      // Get lagged revenue
      const { data: invRes } = await supabase.from('invoices').select('amount_usd, amount_kes').eq('billing_period', revMonth);
      const { data: rateSetting } = await supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
      const stdRate = parseFloat(rateSetting?.value || '129.5');
      const revUsd = (invRes || []).reduce((s: number, i: any) => s + Number(i.amount_usd), 0);
      const revKes = (invRes || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
      setLaggedRevenue(revKes > 0 ? revKes : Math.round(revUsd * stdRate * 100) / 100);

      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  const totalBudget = rows.reduce((s, r) => s + r.budget_kes, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_kes, 0);
  const totalVariance = totalBudget - totalActual;
  const totalUtil = totalBudget > 0 ? (totalActual / totalBudget * 100) : 0;
  const grossProfit = laggedRevenue - totalActual;

  const statusColors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    submitted: 'bg-blue-100 text-blue-700',
    pm_review: 'bg-purple-100 text-purple-700',
    pm_approved: 'bg-teal-100 text-teal-700',
    returned_to_tl: 'bg-amber-200 text-amber-800',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-rose-100 text-rose-700',
  };

  return (
    <div>
      <PageHeader title="Budget vs Actual" description={servicePeriodLabel}>
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
        <ExecutiveInsightPanel lines={[
          `Expenses are ${formatPercent((totalActual / Math.max(laggedRevenue, 1)) * 100)} of revenue.`,
          grossProfit >= 0 ? `Profitable — ${formatCompactCurrency(grossProfit, 'KES')} net profit this period.` : 'Lagged P&L is negative this cycle.',
          rows.filter((r) => r.utilization_pct > 100).length === 0 ? 'All scopes within budget ✓' : `${rows.filter((r) => r.utilization_pct > 100).length} scope(s) over budget.`,
        ]} />

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveKpiCard label="Total Budgeted" value={formatCompactCurrency(totalBudget, 'KES')} trend="Budget envelope" />
          <ExecutiveKpiCard label="Total Spent" value={formatCompactCurrency(totalActual, 'KES')} trend="Current spend" />
          <ExecutiveKpiCard label="Variance" value={formatCompactCurrency(totalVariance, 'KES')} trend={totalVariance >= 0 ? '✅ Under' : 'Action Needed'} positive={totalVariance >= 0} />
          <ExecutiveKpiCard label="Budget Utilisation" value={formatPercent(totalUtil)} trend={totalUtil > 100 ? 'Over budget' : 'On Track'} positive={totalUtil <= 100} />
        </div>

        {/* Budget table */}
        <Card className="io-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Budget (KES)</TableHead>
                  <TableHead className="text-right">Actual Expenses (service period)</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-neutral-400">Loading...</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-neutral-500">
                      No budgets for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.scope}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColors[r.status] || 'bg-slate-100 text-slate-600'}>
                            {capitalize(r.status.replace(/_/g, ' '))}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.budget_kes, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.actual_kes, 'KES')}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${r.variance_kes < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatCurrency(r.variance_kes, 'KES')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={
                            r.utilization_pct > 100 ? 'bg-rose-100 text-rose-700' :
                            r.utilization_pct > 90 ? 'bg-amber-100 text-amber-700' :
                            'bg-emerald-100 text-emerald-700'
                          }>
                            {formatPercent(r.utilization_pct)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-slate-50">
                      <TableCell colSpan={2} className="text-right">Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalBudget, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalActual, 'KES')}</TableCell>
                      <TableCell className={`text-right font-mono ${totalVariance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(totalVariance, 'KES')}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={totalUtil > 100 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}>
                          {formatPercent(totalUtil)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Revenue vs expenses summary */}
        <Card className="io-card max-w-lg">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold text-slate-700">P&L Summary (Lagged)</p>
            <p className="text-xs text-slate-500">Expenses recorded in {formatYearMonth(selectedMonth)}, matched to {formatYearMonth(serviceMonth)} service period.</p>
            <div className="flex justify-between text-sm">
              <span>Revenue ({formatYearMonth(revenueSourceMonth)} invoice)</span>
              <span className="font-mono font-semibold">{formatCurrency(laggedRevenue, 'KES')}</span>
            </div>
            <div className="flex justify-between text-sm text-red-600">
              <span>Total Expenses ({formatYearMonth(selectedMonth)})</span>
              <span className="font-mono">-{formatCurrency(totalActual, 'KES')}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-bold">
              <span>Gross Profit</span>
              <span className={`font-mono ${grossProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(grossProfit, 'KES')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
