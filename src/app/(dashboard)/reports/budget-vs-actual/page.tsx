'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
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
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

interface BvaRow {
  scope: string;
  status: string;
  budget_kes: number;
  actual_kes: number;
  variance_kes: number;
  utilization_pct: number;
}

interface BudgetVersionRow {
  total_amount_kes: number | null;
  status: string | null;
  version_number: number | null;
}

interface BudgetScopeRow {
  id: string;
  project_id: string | null;
  pm_approved_total: number | null;
  projects: Array<{ name: string | null }> | null;
  departments: Array<{ name: string | null }> | null;
  budget_versions: BudgetVersionRow[] | null;
}

interface ExpenseRow {
  budget_id: string | null;
  project_id: string | null;
  amount_kes: number | null;
}

export default function BudgetVsActualPage() {
  const [rows, setRows] = useState<BvaRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [laggedRevenue, setLaggedRevenue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revenueSourceMonth, setRevenueSourceMonth] = useState(getLaggedMonth(getCurrentYearMonth()));
  const serviceMonth = getLaggedMonth(selectedMonth);
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);
      const supabase = createClient();
      try {
        // Detect historical months — use direct matching
        const { data: snapshot, error: snapshotError } = await supabase
          .from('monthly_financial_snapshots')
          .select('data_source')
          .eq('year_month', selectedMonth)
          .maybeSingle();
        if (snapshotError) {
          console.error('Monthly snapshot lookup failed:', snapshotError);
        }

        const historical = Boolean(snapshot?.data_source?.startsWith('historical_seed'));
        const revMonth = historical ? selectedMonth : getLaggedMonth(selectedMonth);
        setRevenueSourceMonth(revMonth);

        const [{ data: budgetData, error: budgetError }, expenseResult] = await Promise.all([
          supabase
            .from('budgets')
            .select('id, project_id, pm_approved_total, projects(name), departments(name), budget_versions(total_amount_kes, status, version_number)')
            .eq('year_month', selectedMonth),
          getConfirmedExpensesByMonth(supabase, selectedMonth),
        ]);

        if (budgetError) {
          console.error('Budget query failed:', budgetError);
          setLoadError('Unable to load budgets for the selected month.');
        }
        if (expenseResult.error) {
          console.error('Expense query failed:', expenseResult.error);
          setLoadError('Unable to load expenses for the selected month.');
        }

        const budgets = (budgetData ?? []) as BudgetScopeRow[];
        const expenses = (expenseResult.data ?? []) as ExpenseRow[];

        const expenseByBudget = new Map<string, number>();
        expenses.forEach((expense) => {
          if (!expense.budget_id) return;
          const amount = Number(expense.amount_kes ?? 0);
          expenseByBudget.set(expense.budget_id, (expenseByBudget.get(expense.budget_id) ?? 0) + amount);
        });

        const expenseByProject = new Map<string, number>();
        expenses.forEach((expense) => {
          if (!expense.project_id) return;
          const amount = Number(expense.amount_kes ?? 0);
          expenseByProject.set(expense.project_id, (expenseByProject.get(expense.project_id) ?? 0) + amount);
        });

        const result: BvaRow[] = budgets.map((budget) => {
          const versions = budget.budget_versions ?? [];
          const approved = versions.find((version) => version.status === 'approved');
          const pmApproved = versions.find((version) => version.status === 'pm_approved');
          const latest = [...versions].sort(
            (a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0)
          )[0];
          const bestVersion = approved ?? pmApproved ?? latest;

          const budgetKes = budget.pm_approved_total
            ? Number(budget.pm_approved_total)
            : Number(bestVersion?.total_amount_kes ?? 0);
          const bestStatus = approved
            ? 'approved'
            : (pmApproved?.status ?? bestVersion?.status ?? 'draft');
          const actualKes =
            expenseByBudget.get(budget.id) ??
            (budget.project_id ? (expenseByProject.get(budget.project_id) ?? 0) : 0);
          const variance = budgetKes - actualKes;
          const utilization = budgetKes > 0 ? (actualKes / budgetKes) * 100 : 0;

          return {
            scope: budget.projects?.[0]?.name ?? budget.departments?.[0]?.name ?? '—',
            status: bestStatus,
            budget_kes: budgetKes,
            actual_kes: actualKes,
            variance_kes: variance,
            utilization_pct: utilization,
          };
        });

        setRows(result);

        const [{ data: invoiceData, error: invoiceError }, { data: rateSetting, error: rateError }] = await Promise.all([
          supabase.from('invoices').select('amount_usd, amount_kes').eq('billing_period', revMonth),
          supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').maybeSingle(),
        ]);
        if (invoiceError) {
          console.error('Invoice query failed:', invoiceError);
          setLoadError('Unable to load lagged revenue for the selected month.');
        }
        if (rateError) {
          console.error('Exchange-rate query failed:', rateError);
        }

        const stdRate = parseFloat(rateSetting?.value ?? '129.5');
        const invoices = invoiceData ?? [];
        const revUsd = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_usd ?? 0), 0);
        const revKes = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_kes ?? 0), 0);
        setLaggedRevenue(revKes > 0 ? revKes : Math.round(revUsd * stdRate * 100) / 100);
      } catch (error) {
        console.error('Budget vs Actual page error:', error);
        setRows([]);
        setLaggedRevenue(0);
        setLoadError('Unable to load Budget vs Actual data. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedMonth]);

  const totalBudget = rows.reduce((s, r) => s + r.budget_kes, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual_kes, 0);
  const totalVariance = totalBudget - totalActual;
  const totalUtil = totalBudget > 0 ? (totalActual / totalBudget * 100) : 0;
  const grossProfit = laggedRevenue - totalActual;

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-foreground/80',
    submitted: 'bg-info-soft text-info-soft-foreground',
    pm_review: 'bg-purple-100 text-purple-700',
    pm_approved: 'bg-teal-soft text-teal-soft-foreground',
    returned_to_tl: 'bg-warning-soft text-warning-soft-foreground',
    approved: 'bg-success-soft text-success-soft-foreground',
    rejected: 'bg-rose-100 text-rose-700',
  };

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Budget vs Actual',
      `Service period: ${servicePeriodLabel}`,
      rows.slice(0, 120).map((r) => `${r.scope} | budget ${r.budget_kes.toFixed(2)} | actual ${r.actual_kes.toFixed(2)} | variance ${r.variance_kes.toFixed(2)}`),
      `IO_Budget_vs_Actual_${selectedMonth}.pdf`,
    );
  }

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
        <Button variant="outline" size="sm" onClick={exportPdf}>
          <FileDown className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {loadError && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="text-sm text-rose-700">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

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
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Please wait</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No budgets for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.scope}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColors[r.status] || 'bg-muted text-foreground/80'}>
                            {capitalize(r.status.replace(/_/g, ' '))}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.budget_kes, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.actual_kes, 'KES')}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${r.variance_kes < 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}`}>
                          {formatCurrency(r.variance_kes, 'KES')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={
                            r.utilization_pct > 100 ? 'bg-rose-100 text-rose-700' :
                            r.utilization_pct > 90 ? 'bg-warning-soft text-warning-soft-foreground' :
                            'bg-success-soft text-success-soft-foreground'
                          }>
                            {formatPercent(r.utilization_pct)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell colSpan={2} className="text-right">Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalBudget, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalActual, 'KES')}</TableCell>
                      <TableCell className={`text-right font-mono ${totalVariance < 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}`}>{formatCurrency(totalVariance, 'KES')}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className={totalUtil > 100 ? 'bg-rose-100 text-rose-700' : 'bg-success-soft text-success-soft-foreground'}>
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
            <p className="text-sm font-semibold text-foreground/90">P&L Summary (Lagged)</p>
            <p className="text-xs text-muted-foreground">Expenses recorded in {formatYearMonth(selectedMonth)}, matched to {formatYearMonth(serviceMonth)} service period.</p>
            <div className="flex justify-between text-sm">
              <span>Revenue ({formatYearMonth(revenueSourceMonth)} invoice)</span>
              <span className="font-mono font-semibold">{formatCurrency(laggedRevenue, 'KES')}</span>
            </div>
            <div className="flex justify-between text-sm text-danger-soft-foreground">
              <span>Total Expenses ({formatYearMonth(selectedMonth)})</span>
              <span className="font-mono">-{formatCurrency(totalActual, 'KES')}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm font-bold">
              <span>Gross Profit</span>
              <span className={`font-mono ${grossProfit < 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}`}>{formatCurrency(grossProfit, 'KES')}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
