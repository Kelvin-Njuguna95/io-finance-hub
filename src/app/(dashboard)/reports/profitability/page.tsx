'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { useUser } from '@/hooks/use-user';
import {
  useProfitability,
  type ProfitabilityRow,
} from '@/hooks/use-profitability';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { VarianceBullet } from '@/components/finance/variance-bullet';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChartTheme, CustomTooltip } from '@/lib/charts/chart-theme';
import {
  formatCompactKES,
  formatCurrency,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);
const DEFAULT_VISIBLE_ROWS = 5;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function formatDeltaPts(pts: number): string {
  const sign = pts >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pts).toFixed(1)} pts`;
}

export default function ProfitabilityPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showAll, setShowAll] = useState(false);

  // Route-level role gate — books-of-record surface, CFO + accountant only.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Profitability is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const profitability = useProfitability(selectedMonth);

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const summary = profitability.summary;
  const headlineTone: 'good' | 'bad' | 'neutral' =
    summary.blendedMarginPct >= 25
      ? 'good'
      : summary.blendedMarginPct >= 10
        ? 'neutral'
        : 'bad';

  const visibleProjects = useMemo(() => {
    return showAll
      ? profitability.projects
      : profitability.projects.slice(0, DEFAULT_VISIBLE_ROWS);
  }, [profitability.projects, showAll]);

  const totalProjects = profitability.projects.length;
  const hiddenCount = Math.max(0, totalProjects - DEFAULT_VISIBLE_ROWS);

  // Quadrant medians for the scatter.
  const medianRevenue = useMemo(
    () => median(profitability.scatter.map((p) => p.revenueKes)),
    [profitability.scatter],
  );
  const medianMargin = useMemo(
    () => median(profitability.scatter.map((p) => p.marginPct)),
    [profitability.scatter],
  );

  // Scatter point z-axis (headcount) drives Recharts circle size.
  // Points without an `agent_counts` row fall back to a default value
  // so they render at a reasonable radius.
  const scatterData = useMemo(
    () =>
      profitability.scatter.map((p) => ({
        ...p,
        z: p.headcount ?? 8,
      })),
    [profitability.scatter],
  );

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Per-project"
          accent="profitability"
          subtitle={
            profitability.loading
              ? `${formatYearMonth(selectedMonth)} · loading…`
              : `${formatYearMonth(selectedMonth)} · ${summary.projectCount} ${
                  summary.projectCount === 1 ? 'project' : 'projects'
                } · ${formatCompactKES(summary.totalRevenueKes)} revenue · ${summary.blendedMarginPct.toFixed(1)}% blended margin`
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
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow={`Blended margin · ${summary.monthLabel}`}
            value={`${summary.blendedMarginPct.toFixed(1)}%`}
            tone={headlineTone}
            sub={
              summary.projectCount === 0
                ? 'No projects with revenue this month'
                : `${formatCompactKES(summary.totalGrossProfitKes)} gross profit across ${summary.projectCount} ${summary.projectCount === 1 ? 'project' : 'projects'}`
            }
            loading={profitability.loading}
          />
          <StatCard
            title="Total revenue"
            value={formatCompactKES(summary.totalRevenueKes)}
            subtitle="Lagged invoiced revenue"
            loading={profitability.loading}
            tone="brand"
          />
          <StatCard
            title="Total gross profit"
            value={formatCompactKES(summary.totalGrossProfitKes)}
            subtitle={`${formatCompactKES(summary.totalExpensesKes)} confirmed direct cost`}
            loading={profitability.loading}
            tone={summary.totalGrossProfitKes >= 0 ? 'success' : 'danger'}
          />
          <StatCard
            title="Top project"
            value={
              summary.topProject
                ? `${summary.topProject.marginPct.toFixed(1)}%`
                : '—'
            }
            subtitle={
              summary.topProject ? summary.topProject.name : 'No projects with revenue'
            }
            loading={profitability.loading}
            tone="success"
          />
        </div>

        {/* Per-project margin bars */}
        <section className="rounded-lg border border-border bg-card p-6">
          <header className="mb-5 flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Margin · {summary.monthLabel}
              </p>
              <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                Per-project{' '}
                <em className="not-italic italic text-[var(--gold-lo)]">margin bars</em>
              </h3>
              <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                Gold fill is the share of revenue retained as gross profit. Sorted by margin descending.
              </p>
            </div>
            {hiddenCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? `Show top ${DEFAULT_VISIBLE_ROWS}`
                  : `Show all ${totalProjects}`}
              </Button>
            )}
          </header>

          {profitability.loading ? (
            <div className="px-2 py-12 text-center text-sm text-muted-foreground">
              Loading per-project margins…
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="px-2 py-12 text-center text-sm text-muted-foreground">
              No projects with revenue for {formatYearMonth(selectedMonth)}
            </div>
          ) : (
            <ul className="space-y-4">
              {visibleProjects.map((row) => (
                <ProfitabilityMarginRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>

        {/* Margin × Revenue scatter */}
        <section className="rounded-lg border border-border bg-card p-6">
          <header className="mb-4">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Volume × margin · {summary.monthLabel}
            </p>
            <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
              Where the{' '}
              <em className="not-italic italic text-[var(--gold-lo)]">profitable volume</em>{' '}
              lives
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
              Each project plotted by revenue (x) and margin (y). Circle size scales with headcount when known. Quadrant lines mark median revenue and margin.
            </p>
          </header>
          <div className="h-[360px] w-full">
            {profitability.loading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading scatter…
              </div>
            ) : scatterData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No projects with revenue this month
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 16, right: 28, left: 8, bottom: 28 }}>
                  <CartesianGrid
                    stroke={ChartTheme.gridStroke}
                    strokeOpacity={ChartTheme.gridStrokeOpacity}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="revenueKes"
                    type="number"
                    name="Revenue"
                    stroke={ChartTheme.axisStroke}
                    tick={ChartTheme.axisNumStyle}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      formatCompactKES(Number(v)).replace('KES ', '')
                    }
                    label={{
                      value: 'Revenue (KES)',
                      position: 'insideBottom',
                      offset: -16,
                      style: ChartTheme.axisLabelStyle,
                    }}
                  />
                  <YAxis
                    dataKey="marginPct"
                    type="number"
                    name="Margin"
                    stroke={ChartTheme.axisStroke}
                    tick={ChartTheme.axisNumStyle}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                    label={{
                      value: 'Margin %',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 16,
                      style: ChartTheme.axisLabelStyle,
                    }}
                  />
                  <ZAxis
                    dataKey="z"
                    type="number"
                    range={[60, 360]}
                    name="Headcount"
                  />
                  {medianRevenue > 0 && (
                    <ReferenceLine
                      x={medianRevenue}
                      stroke={ChartTheme.gridStroke}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      label={{
                        value: 'median revenue',
                        position: 'top',
                        style: { ...ChartTheme.axisLabelStyle, fontSize: 9.5 },
                      }}
                    />
                  )}
                  {Number.isFinite(medianMargin) && scatterData.length > 0 && (
                    <ReferenceLine
                      y={medianMargin}
                      stroke={ChartTheme.gridStroke}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      label={{
                        value: 'median margin',
                        position: 'right',
                        style: { ...ChartTheme.axisLabelStyle, fontSize: 9.5 },
                      }}
                    />
                  )}
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: 'var(--paper-4)' }}
                    content={(props) => (
                      <CustomTooltip
                        {...props}
                        formatValue={(value, name) => {
                          if (name === 'Revenue')
                            return formatCurrency(Number(value), 'KES');
                          if (name === 'Margin')
                            return `${Number(value).toFixed(1)}%`;
                          if (name === 'Headcount')
                            return `${Number(value)} agents`;
                          return String(value);
                        }}
                        periodLabel="Project profitability"
                      />
                    )}
                  />
                  <Scatter
                    name="Projects"
                    data={scatterData}
                    fill={ChartTheme.series.secondary}
                    fillOpacity={0.85}
                    stroke="var(--ink)"
                    strokeWidth={1.25}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfitabilityMarginRow({ row }: { row: ProfitabilityRow }) {
  const marginTone =
    row.marginPct >= 25
      ? 'text-success-soft-foreground'
      : row.marginPct >= 10
        ? 'text-foreground'
        : row.marginPct >= 0
          ? 'text-[var(--warm-grey-3)]'
          : 'text-[var(--danger)]';

  return (
    <li className="grid grid-cols-[1.4fr_1fr_120px_120px] items-center gap-4">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
          <span
            aria-hidden
            className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-[var(--paper-2)] font-mono text-[10.5px] tabular-nums text-muted-foreground"
          >
            {row.marginRank}
          </span>
          {row.name}
        </p>
        <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          <span className={cn('font-medium', marginTone)}>
            {row.marginPct.toFixed(1)}% margin
          </span>
          {Math.abs(row.momMarginDeltaPts) >= 0.05 && (
            <>
              {' · '}
              <span
                className={cn(
                  row.momMarginDeltaPts >= 0
                    ? 'text-success-soft-foreground'
                    : 'text-[var(--danger)]',
                )}
              >
                {formatDeltaPts(row.momMarginDeltaPts)} MoM
              </span>
            </>
          )}
          {row.headcount !== undefined && (
            <>
              {' · '}
              <span>
                {row.headcount} {row.headcount === 1 ? 'agent' : 'agents'}
              </span>
            </>
          )}
        </p>
      </div>
      <VarianceBullet
        mode="margin"
        planKes={row.revenueKes}
        actualKes={row.grossProfitKes}
        periodElapsedPct={100}
      />
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {formatCompactKES(row.revenueKes)}
      </span>
      <span
        className={cn(
          'text-right font-mono text-[13px] tabular-nums',
          row.grossProfitKes >= 0 ? 'text-foreground' : 'text-[var(--danger)]',
        )}
      >
        {formatCompactKES(row.grossProfitKes)}
      </span>
    </li>
  );
}
