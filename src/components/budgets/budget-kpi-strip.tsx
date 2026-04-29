import { StatCard } from '@/components/layout/stat-card';
import { formatCompactKES } from '@/lib/format';
import type { BudgetKpiSummary } from '@/hooks/use-budgets-list';

type BudgetKpiStripProps = {
  kpis: BudgetKpiSummary;
  loading?: boolean;
};

export function BudgetKpiStrip({ kpis, loading }: BudgetKpiStripProps) {
  const committedDelta =
    kpis.committedDeltaPct === null
      ? undefined
      : {
          value: `${kpis.committedDeltaPct >= 0 ? '+' : ''}${kpis.committedDeltaPct.toFixed(1)}%`,
          direction: (kpis.committedDeltaPct >= 0 ? 'up' : 'down') as 'up' | 'down',
          positive: kpis.committedDeltaPct >= 0,
        };

  const utilisationLabel =
    kpis.budgetsCount > 0
      ? `${kpis.utilisationPct.toFixed(1)}% utilised · across ${kpis.budgetsCount} ${kpis.budgetsCount === 1 ? 'budget' : 'budgets'}`
      : 'No budgets in this period';

  const awaitingLabel =
    kpis.awaitingCount > 0
      ? `Oldest ${kpis.oldestAwaitingDays === 0 ? 'today' : `${kpis.oldestAwaitingDays}d`} in queue`
      : 'Queue clear';

  const overLabel =
    kpis.overCount > 0
      ? `${formatCompactKES(kpis.overAggregateKes)} aggregate overrun`
      : 'No overruns this month';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title={`Total committed · ${kpis.monthLabel}`}
        value={formatCompactKES(kpis.totalCommittedKes)}
        subtitle={
          kpis.committedDeltaPct === null
            ? `${kpis.budgetsCount} ${kpis.budgetsCount === 1 ? 'budget' : 'budgets'}`
            : `vs prev month · ${kpis.budgetsCount} ${kpis.budgetsCount === 1 ? 'budget' : 'budgets'}`
        }
        trend={committedDelta}
        loading={loading}
        tone="brand"
      />
      <StatCard
        title="Spent to date"
        value={formatCompactKES(kpis.totalSpentKes)}
        subtitle={utilisationLabel}
        loading={loading}
        tone="info"
      />
      <StatCard
        title="Awaiting approval"
        value={
          kpis.awaitingCount === 1
            ? '1 budget'
            : `${kpis.awaitingCount} budgets`
        }
        subtitle={awaitingLabel}
        trend={
          kpis.awaitingCount > 0 && kpis.oldestAwaitingDays >= 5
            ? {
                value: `${kpis.oldestAwaitingDays}d`,
                direction: 'down',
                positive: false,
              }
            : undefined
        }
        loading={loading}
        tone="warning"
      />
      <StatCard
        title="Variance · over plan"
        value={
          kpis.overCount === 1
            ? '1 budget'
            : `${kpis.overCount} budgets`
        }
        subtitle={overLabel}
        trend={
          kpis.overCount > 0
            ? {
                value: formatCompactKES(kpis.overAggregateKes).replace('KES ', ''),
                direction: 'down',
                positive: false,
                label: 'aggregate',
              }
            : undefined
        }
        loading={loading}
        tone={kpis.overCount > 0 ? 'danger' : 'success'}
      />
    </div>
  );
}
