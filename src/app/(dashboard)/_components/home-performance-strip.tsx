'use client';

import { Banknote, PiggyBank, TrendingDown } from 'lucide-react';

import { StatCard } from '@/components/layout/stat-card';
import { formatCurrency, formatYearMonth } from '@/lib/format';
import { useMonthlyPlSummary } from '@/hooks/use-monthly-pl-summary';

/**
 * Three-card company-wide P&L row rendered directly below HomeKpiStrip
 * on the CFO, Accountant, and PM Home dashboards. TL dashboard does
 * not render this strip — financial performance is not on that role's
 * Home. The row shows the same company totals to all three roles even
 * though the Monthly P&L page scopes to assigned projects for PM/TL —
 * the eyebrow "COMPANY TOTALS" makes the distinction explicit.
 */
export function HomePerformanceStrip() {
  const pl = useMonthlyPlSummary();

  const servicePeriodLabel = formatYearMonth(pl.laggedServiceMonth).toUpperCase();

  return (
    <div className="space-y-3">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Company Totals · {servicePeriodLabel} Service Period
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-3">
        <StatCard
          title="Total Revenue"
          value={pl.error ? '—' : formatCurrency(pl.totalRevenueKes, 'KES')}
          subtitle={pl.error ? 'Unable to load' : undefined}
          icon={Banknote}
          tone="brand"
          loading={pl.loading}
        />
        <StatCard
          title="Total Costs"
          value={pl.error ? '—' : formatCurrency(pl.totalCostsKes, 'KES')}
          subtitle={pl.error ? 'Unable to load' : undefined}
          icon={TrendingDown}
          tone="brand"
          loading={pl.loading}
        />
        <StatCard
          title="Net Profit"
          value={pl.error ? '—' : formatCurrency(pl.netProfitKes, 'KES')}
          subtitle={pl.error ? 'Unable to load' : undefined}
          icon={PiggyBank}
          tone="brand"
          loading={pl.loading}
        />
      </div>
    </div>
  );
}
