'use client';

import { ArrowDownToLine, FileText, TrendingUp } from 'lucide-react';

import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { formatCompactKES, formatCurrency, formatYearMonth, getCurrentYearMonth } from '@/lib/format';
import { useBankBalance } from '@/hooks/use-bank-balance';
import { useMonthlyApprovedBudget } from '@/hooks/use-monthly-approved-budget';
import { useMonthlyInvoiceRevenue } from '@/hooks/use-monthly-invoice-revenue';
import { useMonthlyWithdrawn } from '@/hooks/use-monthly-withdrawn';

/**
 * Four-card KPI strip rendered at the top of CFO, Accountant, and PM
 * Home dashboards: Bank Balance (USD, all-time, headline) · Approved
 * Budget (KES, current month) · Withdrawn (USD, current month) ·
 * Invoice Revenue (KES, current month).
 *
 * Composition mirrors the rethemed /revenue + /withdrawals + /invoices
 * KPI strips: HeadlineStatCard for the headline metric, compact KES
 * everywhere KES is the value, mid-dot title separators, data-driven
 * tones, gap-3 grid.
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
  const invoiceRevenue = useMonthlyInvoiceRevenue();

  const monthLabel = formatYearMonth(getCurrentYearMonth());

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <HeadlineStatCard
        eyebrow="Bank balance · USD"
        value={bank.error ? '—' : formatCurrency(bank.totalUSD, 'USD')}
        sub={bank.error ? 'Unable to load' : 'All tracked accounts'}
        loading={bank.loading}
      />
      <StatCard
        title={`Approved budget · ${monthLabel}`}
        value={budget.error ? '—' : formatCompactKES(budget.total)}
        subtitle={budget.error ? 'Unable to load' : 'Total approved this period'}
        icon={FileText}
        tone="brand"
        loading={budget.loading}
      />
      <StatCard
        title={`Withdrawn · ${monthLabel}`}
        value={withdrawn.error ? '—' : formatCurrency(withdrawn.total, 'USD')}
        subtitle={withdrawn.error ? 'Unable to load' : 'Forex outflow this period'}
        icon={ArrowDownToLine}
        tone="brand"
        loading={withdrawn.loading}
      />
      <StatCard
        title={`Invoice revenue · ${monthLabel}`}
        value={invoiceRevenue.error ? '—' : formatCompactKES(invoiceRevenue.total)}
        subtitle={
          invoiceRevenue.error
            ? 'Unable to load'
            : invoiceRevenue.total > 0
              ? `≈ ${formatCurrency(invoiceRevenue.total / 128.5, 'USD')}`
              : 'No invoiced revenue yet'
        }
        icon={TrendingUp}
        tone={invoiceRevenue.error ? 'brand' : invoiceRevenue.total > 0 ? 'success' : 'brand'}
        loading={invoiceRevenue.loading}
      />
    </div>
  );
}
