import { StatCard } from '@/components/layout/stat-card';
import { formatCompactKES } from '@/lib/format';
import type { ExpenseKpiSummary } from '@/hooks/use-expenses-list';

type ExpenseKpiStripProps = {
  kpis: ExpenseKpiSummary;
  loading?: boolean;
};

export function ExpenseKpiStrip({ kpis, loading }: ExpenseKpiStripProps) {
  const spentDelta =
    kpis.spentDeltaPct === null
      ? undefined
      : {
          value: `${kpis.spentDeltaPct >= 0 ? '+' : ''}${kpis.spentDeltaPct.toFixed(1)}%`,
          direction: (kpis.spentDeltaPct >= 0 ? 'up' : 'down') as 'up' | 'down',
          positive: kpis.spentDeltaPct >= 0,
        };

  const spentSubtitle =
    kpis.spentDeltaPct === null
      ? `${kpis.expenseCount} ${kpis.expenseCount === 1 ? 'expense' : 'expenses'}`
      : `vs prev month · ${kpis.expenseCount} ${
          kpis.expenseCount === 1 ? 'expense' : 'expenses'
        }`;

  const awaitingSubtitle =
    kpis.awaitingCount === 0
      ? 'Queue clear'
      : kpis.awaitingTotalKes > 0
        ? `${formatCompactKES(kpis.awaitingTotalKes)} in queue · oldest ${
            kpis.oldestAwaitingDays === 0 ? 'today' : `${kpis.oldestAwaitingDays}d`
          }`
        : `Oldest ${kpis.oldestAwaitingDays}d`;

  const missingSubtitle =
    kpis.missingReceiptCount === 0
      ? 'All receipts referenced'
      : kpis.missingReceiptOver7Days > 0
        ? `${kpis.missingReceiptOver7Days} over 7 days`
        : 'All within 7 days';

  const overSubtitle =
    kpis.overCount === 0
      ? 'No overruns this month'
      : `${formatCompactKES(kpis.overAggregateKes)} aggregate overrun`;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatCard
        title={`Spent · ${kpis.monthLabel}`}
        value={formatCompactKES(kpis.totalSpentKes)}
        subtitle={spentSubtitle}
        trend={spentDelta}
        loading={loading}
        tone="brand"
      />
      <StatCard
        title="Awaiting approval"
        value={
          kpis.awaitingCount === 1 ? '1 expense' : `${kpis.awaitingCount} expenses`
        }
        subtitle={awaitingSubtitle}
        loading={loading}
        tone="warning"
      />
      <StatCard
        title="Missing receipts"
        value={
          kpis.missingReceiptCount === 1
            ? '1 expense'
            : `${kpis.missingReceiptCount} expenses`
        }
        subtitle={missingSubtitle}
        trend={
          kpis.missingReceiptOver7Days > 0
            ? {
                value: `${kpis.missingReceiptOver7Days} > 7d`,
                direction: 'down',
                positive: false,
              }
            : undefined
        }
        loading={loading}
        tone={kpis.missingReceiptCount > 0 ? 'danger' : 'success'}
      />
      <StatCard
        title="Driving budget overrun"
        value={
          kpis.overCount === 1 ? '1 budget' : `${kpis.overCount} budgets`
        }
        subtitle={overSubtitle}
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
