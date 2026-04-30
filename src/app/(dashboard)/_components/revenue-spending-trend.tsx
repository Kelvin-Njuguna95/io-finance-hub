'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useTrends } from '@/hooks/use-trends';
import { ChartTheme, CustomTooltip } from '@/lib/charts/chart-theme';
import { formatCompactKES, getCurrentYearMonth } from '@/lib/format';

const NAIROBI_TZ = 'Africa/Nairobi';

const monthOnlyFmt = new Intl.DateTimeFormat('en-KE', {
  timeZone: NAIROBI_TZ,
  month: 'short',
});
const monthYearFmt = new Intl.DateTimeFormat('en-KE', {
  timeZone: NAIROBI_TZ,
  month: 'short',
  year: '2-digit',
});

function formatXTick(yearMonth: string, index: number): string {
  const parts = yearMonth.split('-').map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return yearMonth;
  }
  const [y, m] = parts;
  const d = new Date(y, m - 1, 1);
  return m === 1 || index === 0 ? monthYearFmt.format(d) : monthOnlyFmt.format(d);
}

function formatYTick(value: number): string {
  return formatCompactKES(value).replace('KES ', '').replace('KES', '').trim();
}

function tooltipPeriod(yearMonth: string): string {
  const parts = yearMonth.split('-').map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return yearMonth;
  }
  const [y, m] = parts;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
    year: 'numeric',
  })
    .format(new Date(y, m - 1, 1))
    .toUpperCase();
}

export function RevenueSpendingTrendChart() {
  const trends = useTrends(getCurrentYearMonth());

  const data = useMemo(() => {
    const costByMonth = new Map(
      trends.costStructure.map((c) => [
        c.month,
        c.projectExpensesKes + c.sharedExpensesKes,
      ]),
    );
    return trends.revenueTrend.slice(-12).map((r) => ({
      month: r.month,
      label: r.label,
      revenueKes: r.revenueKes,
      totalCostKes: costByMonth.get(r.month) ?? 0,
    }));
  }, [trends.revenueTrend, trends.costStructure]);

  if (trends.loading) {
    return (
      <div className="h-[280px] w-full animate-pulse rounded-lg bg-muted/30" />
    );
  }

  if (data.length < 2) {
    return (
      <div className="flex h-[280px] w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/10">
        <p className="text-sm text-muted-foreground">
          Insufficient data — need at least 2 months
        </p>
      </div>
    );
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 16, right: 16, left: 8, bottom: 16 }}
        >
          <CartesianGrid
            stroke={ChartTheme.gridStroke}
            strokeOpacity={ChartTheme.gridStrokeOpacity}
            vertical={false}
          />
          <XAxis
            dataKey="month"
            stroke={ChartTheme.axisStroke}
            tick={ChartTheme.axisLabelStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatXTick}
          />
          <YAxis
            stroke={ChartTheme.axisStroke}
            tick={ChartTheme.axisNumStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatYTick(Number(v))}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: 'var(--paper-4)' }}
            content={(props) => {
              const periodLabel =
                typeof props.label === 'string'
                  ? tooltipPeriod(props.label)
                  : undefined;
              return (
                <CustomTooltip
                  {...props}
                  periodLabel={periodLabel}
                  formatValue={(value) => formatCompactKES(Number(value))}
                />
              );
            }}
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
            name="Revenue"
            stroke={ChartTheme.series.secondary}
            strokeWidth={ChartTheme.lineWeight}
            dot={false}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="totalCostKes"
            name="Total cost"
            stroke={ChartTheme.series.primary}
            strokeWidth={ChartTheme.lineWeight}
            dot={false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
