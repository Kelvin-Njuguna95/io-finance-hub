'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCompactKES, formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth, getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { FileDown, AlertTriangle, Wallet, Receipt, TrendingDown, BarChart3 } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

import { cn } from '@/lib/utils';

interface BvaRow {
  scope: string;
  status: string;
  budget_kes: number;
  actual_kes: number;
  variance_kes: number;
  utilization_pct: number;
}

const ROW_GRID = 'grid grid-cols-[1.6fr_140px_140px_140px_120px] items-center gap-4';

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

        const [{ data: varianceData, error: varianceError }, laggedCompanyRes] = await Promise.all([
          supabase
            .from('variance_summary_by_project')
            .select('project_name, budget_kes, actual_kes, variance_kes')
            .eq('year_month', selectedMonth),
          supabase.from('lagged_revenue_company_month').select('total_revenue_kes').eq('expense_month', selectedMonth).maybeSingle(),
        ]);

        if (varianceError) {
          console.error('Variance query failed:', varianceError);
          setLoadError('Unable to load expenses for the selected month.');
        }

        const result: BvaRow[] = (varianceData ?? []).map((row: { project_name: string | null; budget_kes: number | null; actual_kes: number | null; variance_kes: number | null }) => {
          const budgetKes = Number(row.budget_kes ?? 0);
          const actualKes = Number(row.actual_kes ?? 0);
          const variance = Number(row.variance_kes ?? 0);
          const utilization = budgetKes > 0 ? (actualKes / budgetKes) * 100 : 0;

          return {
            scope: row.project_name ?? '—',
            status: 'approved',
            budget_kes: budgetKes,
            actual_kes: actualKes,
            variance_kes: variance,
            utilization_pct: utilization,
          };
        });

        setRows(result);
        setLaggedRevenue(Number(laggedCompanyRes.data?.total_revenue_kes || 0));
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
  const overBudgetCount = rows.filter((r) => r.utilization_pct > 100).length;

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Budget vs Actual',
      `Service period: ${servicePeriodLabel}`,
      rows.slice(0, 120).map((r) => `${r.scope} | budget ${r.budget_kes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | actual ${r.actual_kes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | variance ${r.variance_kes.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`),
      `IO_Budget_vs_Actual_${selectedMonth}.pdf`,
    );
  }

  const monthSelect = (
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
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      <Button variant="outline" size="sm" onClick={exportPdf} className="gap-1.5">
        <FileDown className="size-3.5" /> Export PDF
      </Button>
    </div>
  );

  const subtitle = `${servicePeriodLabel} · ${rows.length} scope${rows.length === 1 ? '' : 's'}${overBudgetCount > 0 ? ` · ${overBudgetCount} over budget` : ''}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Budget vs"
        accent="actual"
        subtitle={subtitle}
        action={headerActions}
      />

      <div className="mt-6 space-y-6">
        {loadError && (
          <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft/60 px-5 py-4">
            <AlertTriangle className="size-5 shrink-0 text-danger-soft-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium text-danger-soft-foreground">{loadError}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total budgeted"
            value={formatCompactKES(totalBudget)}
            subtitle="Budget envelope"
            icon={Wallet}
            tone="brand"
          />
          <StatCard
            title="Total spent"
            value={formatCompactKES(totalActual)}
            subtitle="Current spend"
            icon={Receipt}
            tone="brand"
          />
          <StatCard
            title="Variance"
            value={formatCompactKES(totalVariance)}
            subtitle={totalVariance >= 0 ? 'Under budget' : 'Action needed'}
            icon={totalVariance >= 0 ? TrendingDown : AlertTriangle}
            tone={totalVariance >= 0 ? 'success' : 'danger'}
          />
          <StatCard
            title="Budget utilisation"
            value={formatPercent(totalUtil)}
            subtitle={totalUtil > 100 ? 'Over budget' : totalUtil > 90 ? 'Watch' : 'On track'}
            icon={BarChart3}
            tone={totalUtil > 100 ? 'danger' : totalUtil > 90 ? 'warning' : 'success'}
          />
        </div>

        {/* List-frame: scope rows */}
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div
            className={cn(
              ROW_GRID,
              'border-b border-border bg-[var(--paper-2)] px-5 py-3',
              'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
            )}
          >
            <div>Scope</div>
            <div className="text-right">Budget (KES)</div>
            <div className="text-right">Actual</div>
            <div className="text-right">Variance</div>
            <div className="text-right">Utilisation</div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">Please wait</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No budgets for {formatYearMonth(selectedMonth)}.
            </div>
          ) : (
            <>
              {rows.map((r, i) => {
                const overUtil = r.utilization_pct > 100;
                const watchUtil = r.utilization_pct > 90 && r.utilization_pct <= 100;
                return (
                  <div
                    key={i}
                    className={cn(
                      ROW_GRID,
                      'border-b border-border-subtle px-5 py-3.5 last:border-b-0',
                      overUtil && 'bg-danger-soft/30',
                    )}
                  >
                    <div className="min-w-0 truncate text-[14px] font-medium text-foreground">
                      {r.scope}
                    </div>
                    <div className="text-right font-mono text-[13px] tabular-nums text-foreground">
                      {formatCurrency(r.budget_kes, 'KES')}
                    </div>
                    <div className="text-right font-mono text-[13px] tabular-nums text-foreground">
                      {formatCurrency(r.actual_kes, 'KES')}
                    </div>
                    <div
                      className={cn(
                        'text-right font-mono text-[13px] tabular-nums',
                        r.variance_kes < 0
                          ? 'text-danger-soft-foreground'
                          : 'text-success-soft-foreground',
                      )}
                    >
                      {formatCurrency(r.variance_kes, 'KES')}
                    </div>
                    <div className="text-right">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                          overUtil
                            ? 'bg-danger-soft text-danger-soft-foreground'
                            : watchUtil
                              ? 'bg-warning-soft text-warning-soft-foreground'
                              : 'bg-success-soft text-success-soft-foreground',
                        )}
                      >
                        {formatPercent(r.utilization_pct)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {/* Total row */}
              <div
                className={cn(
                  ROW_GRID,
                  'border-t border-border bg-[var(--paper-2)] px-5 py-3 font-mono',
                )}
              >
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Total · {rows.length} scope{rows.length === 1 ? '' : 's'}
                </div>
                <div className="text-right text-[14px] font-medium tabular-nums text-foreground">
                  {formatCurrency(totalBudget, 'KES')}
                </div>
                <div className="text-right text-[14px] font-medium tabular-nums text-foreground">
                  {formatCurrency(totalActual, 'KES')}
                </div>
                <div
                  className={cn(
                    'text-right text-[14px] font-medium tabular-nums',
                    totalVariance < 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground',
                  )}
                >
                  {formatCurrency(totalVariance, 'KES')}
                </div>
                <div className="text-right">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                      totalUtil > 100
                        ? 'bg-danger-soft text-danger-soft-foreground'
                        : 'bg-success-soft text-success-soft-foreground',
                    )}
                  >
                    {formatPercent(totalUtil)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* P&L Summary panel — lagged */}
        <section className="max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="border-b border-border bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            P&amp;L summary · lagged
          </div>
          <div className="space-y-2.5 px-5 py-4 text-[13px]">
            <p className="text-[11.5px] text-muted-foreground">
              Expenses recorded in {formatYearMonth(selectedMonth)}, matched to{' '}
              {formatYearMonth(serviceMonth)} service period.
            </p>
            <Row label={`Revenue · ${formatYearMonth(revenueSourceMonth)}`} value={formatCurrency(laggedRevenue, 'KES')} />
            <Row
              label={`Total expenses · ${formatYearMonth(selectedMonth)}`}
              value={`-${formatCurrency(totalActual, 'KES')}`}
              tone="danger"
            />
            <div className="border-t border-border-subtle pt-2.5">
              <Row
                label="Gross profit"
                value={formatCurrency(grossProfit, 'KES')}
                tone={grossProfit < 0 ? 'danger' : 'success'}
                bold
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'success';
  bold?: boolean;
}) {
  const valueClass =
    tone === 'danger'
      ? 'text-danger-soft-foreground'
      : tone === 'success'
        ? 'text-success-soft-foreground'
        : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={bold ? 'font-medium text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('font-mono tabular-nums', valueClass, bold && 'font-medium')}>{value}</span>
    </div>
  );
}
