'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useUser } from '@/hooks/use-user';
import { useTrends } from '@/hooks/use-trends';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
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
  getCurrentYearMonth,
} from '@/lib/format';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);

// TODO: Phase 4 Session B+ — YoY compare and Forecast tabs.

type RangeKey = '12' | '6' | '3';

const RANGE_LABEL: Record<RangeKey, string> = {
  '12': 'T12M',
  '6': 'T6M',
  '3': 'T3M',
};

function formatPercentDelta(pts: number | null): string {
  if (pts === null) return '—';
  const sign = pts >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pts).toFixed(1)}%`;
}

function formatPctValue(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export default function TrendsPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth] = useState(getCurrentYearMonth());
  const [range, setRange] = useState<RangeKey>('12');

  // Route-level role gate.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Trends & Analytics is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const trends = useTrends(selectedMonth);
  const summary = trends.summary;

  const rangeMonths = Number(range);
  const revenueTrend = useMemo(
    () => trends.revenueTrend.slice(-rangeMonths),
    [trends.revenueTrend, rangeMonths],
  );
  const marginTrend = useMemo(
    () => trends.marginTrend.slice(-rangeMonths),
    [trends.marginTrend, rangeMonths],
  );
  const costStructure = useMemo(
    () => trends.costStructure.slice(-rangeMonths),
    [trends.costStructure, rangeMonths],
  );
  const seasonality = useMemo(
    () => trends.seasonality.slice(-rangeMonths),
    [trends.seasonality, rangeMonths],
  );

  const hasPriorYearData = useMemo(
    () => seasonality.some((p) => p.priorYearKes !== null),
    [seasonality],
  );

  // Margin trend reference line at 0% only when at least one negative
  // margin appears in the window.
  const marginHasNegative = useMemo(
    () => marginTrend.some((p) => p.marginPct < 0),
    [marginTrend],
  );

  const cagrTone: 'good' | 'neutral' | 'bad' =
    summary.revenueCAGR === null
      ? 'neutral'
      : summary.revenueCAGR >= 5
        ? 'good'
        : summary.revenueCAGR >= 0
          ? 'neutral'
          : 'bad';

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Trends &"
          accent="analytics"
          subtitle={
            trends.loading
              ? `${RANGE_LABEL[range]} · loading…`
              : `${RANGE_LABEL[range]} · trailing window through ${summary.monthLabel} · seasonality & growth signals`
          }
          action={
            <div className="flex items-center gap-2">
              <Select
                value={range}
                onValueChange={(v) => v && setRange(v as RangeKey)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">Last 12 months</SelectItem>
                  <SelectItem value="6">Last 6 months</SelectItem>
                  <SelectItem value="3">Last 3 months</SelectItem>
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
            eyebrow="Revenue CAGR · T12M"
            value={
              summary.revenueCAGR !== null
                ? `${summary.revenueCAGR >= 0 ? '+ ' : '− '}${Math.abs(summary.revenueCAGR).toFixed(1)}%`
                : '—'
            }
            tone={cagrTone}
            sub={
              summary.revenueCAGR !== null
                ? 'Compounded month-on-month · KES base'
                : 'Insufficient revenue history'
            }
            loading={trends.loading}
          />
          <StatCard
            title="Margin trajectory"
            value={
              summary.marginTrajectoryPts !== null
                ? `${summary.marginTrajectoryPts >= 0 ? '+ ' : '− '}${Math.abs(summary.marginTrajectoryPts).toFixed(1)} pts`
                : '—'
            }
            subtitle={
              summary.marginTrajectoryPts !== null
                ? '12mo ago → latest · net margin movement'
                : 'No margin baseline'
            }
            loading={trends.loading}
            tone={
              summary.marginTrajectoryPts !== null && summary.marginTrajectoryPts >= 0
                ? 'success'
                : 'danger'
            }
          />
          <StatCard
            title="Cost per agent · latest"
            value={
              summary.costPerAgentLatest !== null
                ? formatCompactKES(summary.costPerAgentLatest)
                : '—'
            }
            subtitle={
              summary.costPerAgentYoYDeltaPct !== null
                ? `${formatPercentDelta(summary.costPerAgentYoYDeltaPct)} YoY`
                : 'Add prior-year data for YoY'
            }
            loading={trends.loading}
            tone="brand"
          />
          <StatCard
            title="Seasonality peak"
            value={summary.seasonalityPeak ?? '—'}
            subtitle={
              summary.seasonalityPeak
                ? 'Highest-revenue month in window'
                : 'No revenue data'
            }
            loading={trends.loading}
            tone="success"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="revenue">
          <TabsList>
            <TabsTrigger value="revenue">Revenue trend</TabsTrigger>
            <TabsTrigger value="margin">Margin trend</TabsTrigger>
            <TabsTrigger value="cost">Cost structure</TabsTrigger>
            <TabsTrigger value="seasonality">Seasonality</TabsTrigger>
          </TabsList>

          <TabsContent value="revenue" className="pt-4">
            <ChartCard
              eyebrow={`Revenue · ${RANGE_LABEL[range]} · KES`}
              title="Steady upward trajectory with"
              accent="seasonal lift"
              description="Solid line is monthly actual revenue. Dashed gold line is a 3-month moving average."
            >
              <div className="h-[320px] w-full">
                {trends.loading ? (
                  <ChartLoading />
                ) : revenueTrend.every((p) => p.revenueKes === 0) ? (
                  <ChartEmpty>No revenue data in the selected window</ChartEmpty>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={revenueTrend}
                      margin={{ top: 16, right: 16, left: 8, bottom: 16 }}
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
                        tickFormatter={(v) =>
                          formatCompactKES(Number(v)).replace('KES ', '')
                        }
                      />
                      <Tooltip
                        cursor={{
                          strokeDasharray: '3 3',
                          stroke: 'var(--paper-4)',
                        }}
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
                        verticalAlign="top"
                        align="right"
                        iconType="plainline"
                        wrapperStyle={{
                          paddingBottom: 12,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          letterSpacing: '0.08em',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenueKes"
                        name="Actual"
                        stroke={ChartTheme.series.primary}
                        strokeWidth={ChartTheme.lineWeight + 0.5}
                        dot={{ r: 3, fill: ChartTheme.series.primary }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="threeMonthMA"
                        name="3-mo MA"
                        stroke={ChartTheme.series.secondary}
                        strokeWidth={1.75}
                        strokeDasharray="6 4"
                        dot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </TabsContent>

          <TabsContent value="margin" className="pt-4">
            <ChartCard
              eyebrow={`Net margin · ${RANGE_LABEL[range]} · share of revenue`}
              title="Margin"
              accent="trajectory"
              description="Net margin (revenue − total confirmed expense) as a percentage of revenue. Reference line at 0% appears when at least one month is unprofitable."
            >
              <div className="h-[320px] w-full">
                {trends.loading ? (
                  <ChartLoading />
                ) : marginTrend.every((p) => p.marginPct === 0) ? (
                  <ChartEmpty>No margin data in the selected window</ChartEmpty>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={marginTrend}
                      margin={{ top: 16, right: 16, left: 8, bottom: 16 }}
                    >
                      <defs>
                        <linearGradient id="marginGold" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor={ChartTheme.series.secondary}
                            stopOpacity={ChartTheme.areaGradient.gold.topOpacity}
                          />
                          <stop
                            offset="100%"
                            stopColor={ChartTheme.series.secondary}
                            stopOpacity={ChartTheme.areaGradient.gold.bottomOpacity}
                          />
                        </linearGradient>
                      </defs>
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
                        tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                      />
                      {marginHasNegative && (
                        <ReferenceLine
                          y={0}
                          stroke={ChartTheme.series.danger}
                          strokeDasharray="4 4"
                          strokeOpacity={0.65}
                        />
                      )}
                      <Tooltip
                        cursor={{
                          strokeDasharray: '3 3',
                          stroke: 'var(--paper-4)',
                        }}
                        content={(props) => (
                          <CustomTooltip
                            {...props}
                            formatValue={(value, name) => {
                              if (name === 'Margin %')
                                return formatPctValue(Number(value));
                              return formatCurrency(Number(value), 'KES');
                            }}
                          />
                        )}
                      />
                      <Area
                        type="monotone"
                        dataKey="marginPct"
                        name="Margin %"
                        stroke={ChartTheme.series.secondary}
                        strokeWidth={ChartTheme.lineWeight}
                        fill="url(#marginGold)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </TabsContent>

          <TabsContent value="cost" className="pt-4">
            <ChartCard
              eyebrow={`Cost structure · ${RANGE_LABEL[range]} · stacked KES`}
              title="Cost mix is"
              accent="payroll-led"
              description="Project expenses (direct cost of service, ink) stacked above shared expenses (operating overhead, gold)."
            >
              <div className="h-[320px] w-full">
                {trends.loading ? (
                  <ChartLoading />
                ) : costStructure.every(
                    (p) =>
                      p.projectExpensesKes === 0 && p.sharedExpensesKes === 0,
                  ) ? (
                  <ChartEmpty>No expense data in the selected window</ChartEmpty>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={costStructure}
                      margin={{ top: 16, right: 16, left: 8, bottom: 16 }}
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
                        tickFormatter={(v) =>
                          formatCompactKES(Number(v)).replace('KES ', '')
                        }
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--paper-2)', opacity: 0.4 }}
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
                        verticalAlign="top"
                        align="right"
                        iconType="square"
                        wrapperStyle={{
                          paddingBottom: 12,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          letterSpacing: '0.08em',
                        }}
                      />
                      <Bar
                        dataKey="projectExpensesKes"
                        name="Project expenses"
                        stackId="cost"
                        fill={ChartTheme.series.primary}
                      />
                      <Bar
                        dataKey="sharedExpensesKes"
                        name="Shared expenses"
                        stackId="cost"
                        fill={ChartTheme.series.secondary}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </TabsContent>

          <TabsContent value="seasonality" className="pt-4">
            <ChartCard
              eyebrow={`Seasonality · ${RANGE_LABEL[range]} · KES revenue per calendar month`}
              title="Where the year"
              accent="leans"
              description={
                hasPriorYearData
                  ? 'Current year (ink) against prior year (gold) for the same calendar months.'
                  : 'Add prior-year data for seasonality comparison. Showing current-year revenue only.'
              }
            >
              <div className="h-[320px] w-full">
                {trends.loading ? (
                  <ChartLoading />
                ) : seasonality.every((p) => p.currentYearKes === 0) ? (
                  <ChartEmpty>No revenue data in the selected window</ChartEmpty>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={seasonality}
                      margin={{ top: 16, right: 16, left: 8, bottom: 16 }}
                    >
                      <CartesianGrid
                        stroke={ChartTheme.gridStroke}
                        strokeOpacity={ChartTheme.gridStrokeOpacity}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="monthShort"
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
                        tickFormatter={(v) =>
                          formatCompactKES(Number(v)).replace('KES ', '')
                        }
                      />
                      <Tooltip
                        cursor={{ fill: 'var(--paper-2)', opacity: 0.4 }}
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
                        verticalAlign="top"
                        align="right"
                        iconType="square"
                        wrapperStyle={{
                          paddingBottom: 12,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11,
                          letterSpacing: '0.08em',
                        }}
                      />
                      <Bar
                        dataKey="currentYearKes"
                        name="Current year"
                        fill={ChartTheme.series.primary}
                      />
                      {hasPriorYearData && (
                        <Bar
                          dataKey="priorYearKes"
                          name="Prior year"
                          fill={ChartTheme.series.secondary}
                        />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- Local primitives ----------

function ChartCard({
  eyebrow,
  title,
  accent,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <header className="mb-5">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
        <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
          {title}{' '}
          <em className="not-italic italic text-[var(--gold-lo)]">{accent}</em>
        </h3>
        <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

function ChartLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading chart…
    </div>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
