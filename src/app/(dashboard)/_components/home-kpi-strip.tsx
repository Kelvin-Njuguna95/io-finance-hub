'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, FileText } from 'lucide-react';

import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCompactKES, formatCurrency, getCurrentYearMonth } from '@/lib/format';
import { useBankBalance } from '@/hooks/use-bank-balance';
import { useMonthlyApprovedBudget } from '@/hooks/use-monthly-approved-budget';
import { useMonthlyWithdrawn } from '@/hooks/use-monthly-withdrawn';

const NAIROBI_TZ = 'Africa/Nairobi';
const MIN_YEAR_MONTH = '2024-10';

function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    month: 'long',
    year: 'numeric',
    timeZone: NAIROBI_TZ,
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

function buildMonthOptions(currentYearMonth: string): string[] {
  const options: string[] = [];
  const [curY, curM] = currentYearMonth.split('-').map(Number);
  const [minY, minM] = MIN_YEAR_MONTH.split('-').map(Number);
  let y = curY;
  let m = curM;
  while (y > minY || (y === minY && m >= minM)) {
    options.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return options;
}

/**
 * Three-card KPI strip rendered at the top of CFO, Accountant, and PM
 * Home dashboards: Bank Balance (USD, live all-time) · Approved Budget
 * (KES, selected month) · Withdrawn (USD, selected month).
 *
 * A month dropdown above the strip switches the latter two tiles to any
 * month from October 2024 through the current month (Africa/Nairobi),
 * descending. Default selection on mount is the current month.
 *
 * Bank Balance does NOT respond to the dropdown — see the TODO inside
 * for why it stays live/all-time.
 *
 * TL dashboard does not render this strip — financial totals would be a
 * data-leak for the team-leader role.
 */
export function HomeKpiStrip() {
  const currentMonth = getCurrentYearMonth();
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);
  const monthOptions = useMemo(
    () => buildMonthOptions(currentMonth),
    [currentMonth],
  );
  const monthLabel = formatMonthLabel(selectedMonth);

  const bank = useBankBalance();
  const budget = useMonthlyApprovedBudget(selectedMonth);
  const withdrawn = useMonthlyWithdrawn(selectedMonth);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Select
          value={selectedMonth}
          onValueChange={(v) => v && setSelectedMonth(String(v))}
        >
          <SelectTrigger className="w-[180px]" aria-label="Select month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((ym) => (
              <SelectItem key={ym} value={ym}>
                {formatMonthLabel(ym)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/*
          TODO: Add historical month-end balance support.
          Requires either (a) value_date column on payments/withdrawals,
          or (b) a daily bank_balance_snapshot table.
          Tracked separately — do not silently approximate via created_at.
        */}
        <HeadlineStatCard
          eyebrow="Bank balance · USD"
          value={bank.error ? '—' : formatCurrency(bank.totalUSD, 'USD')}
          sub={bank.error ? 'Unable to load' : 'Live · as of now'}
          loading={bank.loading}
        />
        <StatCard
          title="Approved budget"
          value={budget.error ? '—' : formatCompactKES(budget.total)}
          subtitle={budget.error ? 'Unable to load' : monthLabel}
          icon={FileText}
          tone="brand"
          loading={budget.loading}
        />
        <StatCard
          title="Withdrawn money"
          value={withdrawn.error ? '—' : formatCurrency(withdrawn.total, 'USD')}
          subtitle={withdrawn.error ? 'Unable to load' : monthLabel}
          icon={ArrowDownToLine}
          tone="brand"
          loading={withdrawn.loading}
        />
      </div>
    </div>
  );
}
