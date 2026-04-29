'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useUser } from '@/hooks/use-user';
import { useMonthlyPL } from '@/hooks/use-monthly-pl';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { VarianceWaterfall } from '@/components/finance/variance-waterfall';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartTheme, CustomTooltip } from '@/lib/charts/chart-theme';
import {
  formatCompactKES,
  formatCurrency,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PLSection } from '@/hooks/use-monthly-pl';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);

function formatDeltaPct(pct: number | null, suffix = ''): string {
  if (pct === null) return '—';
  const sign = pct >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pct).toFixed(1)}%${suffix}`;
}

function formatDeltaPts(pts: number): string {
  const sign = pts >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pts).toFixed(1)} pts`;
}

function signedKesCompact(kes: number): string {
  const sign = kes >= 0 ? '+ ' : '− ';
  return `${sign}${formatCompactKES(Math.abs(kes)).replace('KES ', '')}`;
}

export default function MonthlyPLPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  // Route-level role gate — books-of-record surface, CFO + accountant only.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Monthly P&L is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const pl = useMonthlyPL(selectedMonth);

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const summary = pl.summary;
  const headlineTone: 'bad' | 'good' | 'neutral' =
    summary.netProfitKes > 0 ? 'good' : summary.netProfitKes < 0 ? 'bad' : 'neutral';
  const headlineSign = summary.netProfitKes >= 0 ? '+ ' : '− ';
  const headlineValue = `KES ${headlineSign}${formatCompactKES(Math.abs(summary.netProfitKes)).replace('KES ', '')}`;

  // Insights — light client-side derivations from the hook's data.
  const insights = useMemo(() => {
    const out: Array<{
      tone: 'good' | 'bad' | 'neutral';
      icon: typeof TrendingUp;
      title: string;
      body: string;
    }> = [];

    // Net margin movement.
    if (Math.abs(summary.netMarginDeltaPts) > 0.1) {
      out.push({
        tone: summary.netMarginDeltaPts >= 0 ? 'good' : 'bad',
        icon: summary.netMarginDeltaPts >= 0 ? TrendingUp : AlertTriangle,
        title: `Net margin ${summary.netMarginDeltaPts >= 0 ? 'up' : 'down'} ${Math.abs(summary.netMarginDeltaPts).toFixed(1)} pts vs prior month`,
        body: `${summary.netMarginPct.toFixed(1)}% this month, ${(summary.netMarginPct - summary.netMarginDeltaPts).toFixed(1)}% prior. ${summary.revenueMomDeltaPct === null ? '' : `Revenue ${formatDeltaPct(summary.revenueMomDeltaPct)} MoM.`}`,
      });
    }

    // Revenue movement.
    if (summary.revenueMomDeltaPct !== null && Math.abs(summary.revenueMomDeltaPct) > 1) {
      out.push({
        tone: summary.revenueMomDeltaPct >= 0 ? 'good' : 'bad',
        icon: summary.revenueMomDeltaPct >= 0 ? TrendingUp : AlertTriangle,
        title: `Revenue ${summary.revenueMomDeltaPct >= 0 ? 'up' : 'down'} ${Math.abs(summary.revenueMomDeltaPct).toFixed(1)}% MoM`,
        body: `${formatCompactKES(summary.revenueKes)} this month against confirmed expenses of ${formatCompactKES(summary.expensesKes)}.`,
      });
    }

    // Cost of service share.
    if (summary.totalCogsKes > 0 && summary.revenueKes > 0) {
      const cogsShare = (summary.totalCogsKes / summary.revenueKes) * 100;
      out.push({
        tone: cogsShare > 60 ? 'bad' : cogsShare > 50 ? 'neutral' : 'good',
        icon: FileText,
        title: `Cost of service ran ${cogsShare.toFixed(1)}% of revenue`,
        body: `Direct project costs ${formatCompactKES(summary.totalCogsKes)} against ${formatCompactKES(summary.revenueKes)} revenue. Gross margin sits at ${summary.grossMarginPct.toFixed(1)}%.`,
      });
    }

    // Operating expenses summary.
    if (summary.totalOpexKes > 0) {
      out.push({
        tone: 'neutral',
        icon: CheckCircle2,
        title: `Operating expenses totalled ${formatCompactKES(summary.totalOpexKes)}`,
        body: `Shared overhead landed at ${((summary.totalOpexKes / Math.max(summary.revenueKes, 1)) * 100).toFixed(1)}% of revenue.`,
      });
    }

    return out.slice(0, 4);
  }, [summary]);

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Monthly"
          accent="P&L"
          subtitle={
            pl.loading
              ? `${formatYearMonth(selectedMonth)} · loading…`
              : `${formatYearMonth(selectedMonth)} · MTD · ${formatCompactKES(summary.revenueKes)} revenue · ${formatCompactKES(summary.expensesKes)} spend · ${summary.netMarginPct.toFixed(1)}% net margin`
          }
          action={
            <div className="flex items-center gap-2">
              <Select
                value={selectedMonth}
                onValueChange={(v) => v && setSelectedMonth(v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((ym) => (
                    <SelectItem key={ym} value={ym}>
                      {formatYearMonth(ym)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — PDF export"
              >
                <Download className="size-4" /> Export PDF
              </Button>
              <Button
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — month closure workflow"
              >
                <Lock className="size-4" /> Sign off
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow={`Net profit · ${summary.monthLabel}`}
            value={headlineValue}
            tone={headlineTone}
            sub={
              <>
                {summary.netMarginPct.toFixed(1)}% margin
                {Math.abs(summary.netMarginDeltaPts) > 0.05 && (
                  <>
                    {' · '}
                    {formatDeltaPts(summary.netMarginDeltaPts)} vs prior
                  </>
                )}
              </>
            }
            loading={pl.loading}
          />
          <StatCard
            title="Revenue"
            value={formatCompactKES(summary.revenueKes)}
            subtitle={
              summary.revenueMomDeltaPct === null
                ? 'Invoiced & recognized'
                : `${formatDeltaPct(summary.revenueMomDeltaPct)} MoM · invoiced & recognized`
            }
            loading={pl.loading}
            tone="brand"
          />
          <StatCard
            title="Total expenses"
            value={formatCompactKES(summary.expensesKes)}
            subtitle={
              summary.expensesMomDeltaPct === null
                ? 'Confirmed only'
                : `${formatDeltaPct(summary.expensesMomDeltaPct)} MoM · confirmed only`
            }
            trend={
              summary.expensesMomDeltaPct === null
                ? undefined
                : {
                    value: `${summary.expensesMomDeltaPct >= 0 ? '+' : '−'}${Math.abs(summary.expensesMomDeltaPct).toFixed(1)}%`,
                    direction: summary.expensesMomDeltaPct >= 0 ? 'down' : 'up',
                    positive: summary.expensesMomDeltaPct < 0,
                  }
            }
            loading={pl.loading}
            tone={summary.expensesMomDeltaPct !== null && summary.expensesMomDeltaPct > 5 ? 'warning' : 'info'}
          />
          <StatCard
            title="Gross margin"
            value={`${summary.grossMarginPct.toFixed(1)}%`}
            subtitle={
              Math.abs(summary.grossMarginDeltaPts) < 0.05
                ? 'Before overhead allocation'
                : `${formatDeltaPts(summary.grossMarginDeltaPts)} · before overhead allocation`
            }
            loading={pl.loading}
            tone={summary.grossMarginPct >= 30 ? 'success' : summary.grossMarginPct >= 15 ? 'warning' : 'danger'}
          />
        </div>

        {/* Tabs (single tab wired tonight; other views deferred) */}
        <Tabs defaultValue="statement">
          <TabsList>
            <TabsTrigger value="statement">Statement</TabsTrigger>
          </TabsList>

          <TabsContent value="statement" className="space-y-3 pt-4">
            <PLStatementTable sections={pl.sections} loading={pl.loading} />
          </TabsContent>
        </Tabs>

        {/* Two-up: revenue vs expenses + insights */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-6">
            <header className="mb-4">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Trailing 6 months · KES millions
              </p>
              <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                Revenue against{' '}
                <em className="not-italic italic text-[var(--gold-lo)]">expenses</em>
              </h3>
              <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                Bars are revenue (gold) and total confirmed expense (ink) for
                the trailing months.
              </p>
            </header>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={pl.revenueVsExpenses}
                  margin={{ top: 16, right: 8, left: 8, bottom: 16 }}
                >
                  <CartesianGrid
                    stroke={ChartTheme.gridStroke}
                    strokeOpacity={ChartTheme.gridStrokeOpacity}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    stroke={ChartTheme.axisStroke}
                    tick={ChartTheme.axisLabelStyle}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={ChartTheme.axisStroke}
                    tick={ChartTheme.axisNumStyle}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatCompactKES(Number(v)).replace('KES ', '')}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--paper-2)' }}
                    content={(props) => (
                      <CustomTooltip
                        {...props}
                        formatValue={(value) =>
                          formatCurrency(Number(value), 'KES')
                        }
                      />
                    )}
                  />
                  <Legend
                    wrapperStyle={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      color: 'var(--muted-foreground)',
                    }}
                  />
                  <Bar
                    dataKey="revenueKes"
                    name="Revenue"
                    fill={ChartTheme.series.secondary}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="expensesKes"
                    name="Expenses"
                    fill={ChartTheme.series.primary}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <header className="mb-4">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Notes &amp; explanations
              </p>
              <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                {insights.length === 1
                  ? '1 noted item'
                  : `${insights.length} noted items`}{' '}
                this month
              </h3>
            </header>
            <div className="space-y-3">
              {insights.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No noteworthy movements this month.
                </p>
              ) : (
                insights.map((insight, i) => (
                  <InsightRow key={i} {...insight} />
                ))
              )}
            </div>
          </section>
        </div>

        {/* Waterfall — revenue → net profit */}
        <section>
          <header className="mb-3">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Net profit · {summary.monthLabel}
            </p>
            <h3 className="mt-1 font-display text-[20px] font-medium leading-tight text-foreground">
              Revenue →{' '}
              <em className="not-italic italic text-[var(--gold-lo)]">net profit</em>{' '}
              waterfall
            </h3>
          </header>
          <VarianceWaterfall
            data={pl.waterfall}
            anchorLabel="REVENUE"
            terminalLabel="NET PROFIT"
            calloutOverride={`NET PROFIT · ${signedKesCompact(summary.netProfitKes)} · ${summary.netMarginPct.toFixed(1)}% MARGIN`}
          />
        </section>
      </div>
    </div>
  );
}

function PLStatementTable({
  sections,
  loading,
}: {
  sections: PLSection[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading statement…
      </div>
    );
  }
  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No data to render.
      </div>
    );
  }

  // Compute net profit row at the bottom of the statement.
  const totalRevenue =
    sections.find((s) => s.label === 'Revenue')?.subtotal.kes ?? 0;
  const totalCogs =
    sections.find((s) => s.label === 'Cost of service')?.subtotal.kes ?? 0;
  const totalOpex =
    sections.find((s) => s.label === 'Operating expenses')?.subtotal.kes ?? 0;
  const grossProfit = totalRevenue - totalCogs;
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const netProfit = totalRevenue - totalCogs - totalOpex;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[1.8fr_1fr_1fr_120px] items-center gap-5 border-b border-border bg-muted/40 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Line item</span>
        <span className="text-right">Current</span>
        <span className="text-right">Prior</span>
        <span className="text-right">MoM</span>
      </div>

      {sections.map((section, sIdx) => (
        <div key={section.label}>
          <div className="border-b border-border-subtle bg-[var(--paper-2)] px-6 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-foreground">
            {section.label}
          </div>
          {section.rows.length === 0 ? (
            <div className="border-b border-border-subtle px-6 py-3 text-[12.5px] text-muted-foreground">
              No entries this month.
            </div>
          ) : (
            section.rows.map((row) => (
              <div
                key={`${section.label}-${row.account}`}
                className="grid grid-cols-[1.8fr_1fr_1fr_120px] items-baseline gap-5 border-b border-border-subtle px-6 py-2.5 hover:bg-[var(--paper-2)]"
              >
                <span className="text-[13.5px] text-foreground">{row.account}</span>
                <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
                  {formatCurrency(row.currentKes, 'KES')}
                </span>
                <span className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                  {formatCurrency(row.priorKes, 'KES')}
                </span>
                <span
                  className={cn(
                    'text-right font-mono text-[12px] tabular-nums',
                    row.priorKes === 0
                      ? 'text-muted-foreground'
                      : row.momDeltaPct >= 0
                        ? 'text-[var(--warm-grey-3)]'
                        : 'text-success-soft-foreground',
                  )}
                >
                  {row.priorKes === 0 ? '—' : formatDeltaPct(row.momDeltaPct)}
                </span>
              </div>
            ))
          )}
          <div className="grid grid-cols-[1.8fr_1fr_1fr_120px] items-baseline gap-5 border-b border-border bg-muted/30 px-6 py-3 font-medium">
            <span className="text-[13.5px] text-foreground">{section.subtotal.label}</span>
            <span className="text-right font-mono text-[14px] tabular-nums text-foreground">
              {formatCurrency(section.subtotal.kes, 'KES')}
            </span>
            <span aria-hidden />
            <span aria-hidden />
          </div>
          {/* Insert gross profit row right after Cost of service section */}
          {section.label === 'Cost of service' && sIdx < sections.length - 1 && (
            <div className="grid grid-cols-[1.8fr_1fr_1fr_120px] items-baseline gap-5 border-b border-border bg-[var(--gold-soft)] px-6 py-3">
              <span className="text-[13.5px] font-medium text-foreground">
                Gross profit · {grossMarginPct.toFixed(1)}% margin
              </span>
              <span className="text-right font-mono text-[14px] font-medium tabular-nums text-foreground">
                {formatCurrency(grossProfit, 'KES')}
              </span>
              <span aria-hidden />
              <span aria-hidden />
            </div>
          )}
        </div>
      ))}

      {/* Net profit grand total */}
      <div className="grid grid-cols-[1.8fr_1fr_1fr_120px] items-baseline gap-5 bg-foreground px-6 py-4 font-medium text-background">
        <span className="text-[14px]">Net profit · MTD</span>
        <span className="text-right font-mono text-[15px] font-semibold tabular-nums text-[var(--gold)]">
          {formatCurrency(netProfit, 'KES')}
        </span>
        <span aria-hidden />
        <span aria-hidden />
      </div>
    </div>
  );
}

function InsightRow({
  tone,
  icon: Icon,
  title,
  body,
}: {
  tone: 'good' | 'bad' | 'neutral';
  icon: typeof TrendingUp;
  title: string;
  body: string;
}) {
  const tileClass = {
    good: 'bg-success-soft text-success-soft-foreground',
    bad: 'bg-danger-soft text-[var(--danger)]',
    neutral: 'bg-[var(--gold-soft)] text-[var(--gold-lo)]',
  }[tone];

  return (
    <div className="grid grid-cols-[36px_1fr] items-start gap-3 rounded-[var(--radius)] border border-border-subtle bg-[var(--paper-2)] p-3">
      <span
        aria-hidden
        className={cn(
          'flex size-9 items-center justify-center rounded-[var(--radius)]',
          tileClass,
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium leading-tight text-foreground">
          {title}
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-[var(--warm-grey-3)]">
          {body}
        </p>
      </div>
    </div>
  );
}
