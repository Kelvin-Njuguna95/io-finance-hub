'use client';

import { ArrowDownToLine, FileText, Wallet } from 'lucide-react';

import { StatCard } from '@/components/layout/stat-card';
import { formatCurrency, formatMonth } from '@/lib/format';
import { useBankBalance } from '@/hooks/use-bank-balance';
import { useMonthlyApprovedBudget } from '@/hooks/use-monthly-approved-budget';
import { useMonthlyWithdrawn } from '@/hooks/use-monthly-withdrawn';

/**
 * Three-card KPI strip rendered at the top of CFO, Accountant, and PM
 * Home dashboards: Bank Balance (USD, all-time) · Approved Budget (KES,
 * current month) · Withdrawn (USD, current month).
 *
 * TL dashboard does not render this strip per the home restructure spec —
 * financial totals would be a data-leak for the team-leader role.
 *
 * On hook error, the affected card displays "—" and a small indicator
 * rather than hiding; the underlying toast fires from the hook.
 */
export function HomeKpiStrip() {
  const bank = useBankBalance();
  const budget = useMonthlyApprovedBudget();
  const withdrawn = useMonthlyWithdrawn();

  const currentMonthLabel = formatMonth(new Date());

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Bank Balance"
        value={bank.error ? '—' : formatCurrency(bank.totalUSD, 'USD')}
        subtitle={bank.error ? 'Unable to load' : 'All tracked accounts'}
        icon={Wallet}
        tone="brand"
        loading={bank.loading}
      />
      <StatCard
        title="Approved Budget"
        value={budget.error ? '—' : formatCurrency(budget.total, 'KES')}
        subtitle={budget.error ? 'Unable to load' : currentMonthLabel}
        icon={FileText}
        tone="brand"
        loading={budget.loading}
      />
      <StatCard
        title={`Withdrawn — ${currentMonthLabel}`}
        value={withdrawn.error ? '—' : formatCurrency(withdrawn.total, 'USD')}
        subtitle={withdrawn.error ? 'Unable to load' : undefined}
        icon={ArrowDownToLine}
        tone="brand"
        loading={withdrawn.loading}
      />
    </div>
  );
}
