'use client';

import { Banknote, TrendingDown, BarChart3 } from 'lucide-react';

import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { formatCompactKES, formatPercent, formatYearMonth } from '@/lib/format';
import { useMonthlyPlSummary } from '@/hooks/use-monthly-pl-summary';

/**
 * Company-wide P&L row rendered directly below HomeKpiStrip on the CFO,
 * Accountant, and PM Home dashboards. Service period is folded into
 * each card's title (matches the rethemed-pages pattern). Net profit
 * gets the headline treatment because it's the result number the rest
 * of the row supports.
 *
 * TL dashboard does not render this strip — financial performance is
 * not on that role's Home. The row shows the same company totals to
 * all three other roles even though the Monthly P&L page scopes to
 * assigned projects for PM/TL.
 */
export function HomePerformanceStrip() {
  const pl = useMonthlyPlSummary();
  const periodLabel = formatYearMonth(pl.laggedServiceMonth);

  // Margin computed inline since the hook doesn't expose it.
  const margin =
    pl.totalRevenueKes > 0 ? (pl.netProfitKes / pl.totalRevenueKes) * 100 : 0;
  const marginTone = pl.error
    ? 'brand'
    : margin < 0
      ? 'danger'
      : margin < 10
        ? 'warning'
        : 'success';

  const profitSub = pl.error
    ? 'Unable to load'
    : pl.totalRevenueKes > 0
      ? `${formatPercent(margin)} margin`
      : 'No revenue this period';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={`Total revenue · ${periodLabel}`}
        value={pl.error ? '—' : formatCompactKES(pl.totalRevenueKes)}
        subtitle={pl.error ? 'Unable to load' : 'Lagged service period'}
        icon={Banknote}
        tone="brand"
        loading={pl.loading}
      />
      <StatCard
        title={`Total costs · ${periodLabel}`}
        value={pl.error ? '—' : formatCompactKES(pl.totalCostsKes)}
        subtitle={pl.error ? 'Unable to load' : 'Direct + overhead, confirmed'}
        icon={TrendingDown}
        tone="brand"
        loading={pl.loading}
      />
      <HeadlineStatCard
        eyebrow={`Net profit · ${periodLabel}`}
        value={pl.error ? '—' : formatCompactKES(pl.netProfitKes)}
        sub={profitSub}
        tone={pl.error ? 'neutral' : pl.netProfitKes < 0 ? 'bad' : 'good'}
        loading={pl.loading}
      />
      <StatCard
        title={`Net margin · ${periodLabel}`}
        value={pl.error ? '—' : pl.totalRevenueKes > 0 ? formatPercent(margin) : '—'}
        subtitle={
          pl.error
            ? 'Unable to load'
            : margin < 0
              ? 'Action needed'
              : margin < 10
                ? 'Watch'
                : 'On track'
        }
        icon={BarChart3}
        tone={marginTone}
        loading={pl.loading}
      />
    </div>
  );
}
