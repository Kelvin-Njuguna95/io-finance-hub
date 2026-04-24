'use client';

import { CheckSquare, Receipt } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { SectionCard } from '@/components/layout/section-card';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { EodPanel } from '@/components/eod/eod-panel';
import { AccountantMiscRequests } from '@/components/misc/accountant-misc-requests';
import { AccountantMiscReport } from '@/components/misc/accountant-misc-report';
import { OutstandingReceivablesPanel } from '@/components/revenue/outstanding-receivables-panel';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';
import {
  daysUntilNextClose,
  isWithinCloseWindow,
} from '@/lib/dashboard-thresholds';
import { HomeKpiStrip } from './home-kpi-strip';
import { HomePerformanceStrip } from './home-performance-strip';

/**
 * Month-end close reference list. Static, presentation-only.
 * A schema-backed progress tracker (accountant_checklist_completions)
 * is a post-merge follow-up per /shape Q3; the current list is a
 * reminder, not a state machine.
 */
const CHECKLIST = [
  'Review and validate all submitted budgets',
  'Verify all expenses are linked to approved budgets',
  'Enter missing agent counts for all projects',
  'Reconcile withdrawals with forex logs',
  'Check for unclassified expenses',
  'Verify invoice statuses and payment records',
];

export function AccountantDashboard() {
  const currentMonth = getCurrentYearMonth();

  // Compute once per render; close-window is a date-only signal.
  const now = new Date();
  const inCloseWindow = isWithinCloseWindow(now);
  const daysUntilClose = daysUntilNextClose(now);

  return (
    <div>
      <PageHeader
        title="Accountant Dashboard"
        eyebrow="Finance Operations"
        description={formatYearMonth(currentMonth)}
        icon={Receipt}
        tone="brand"
      />

      <div className="p-6 space-y-6">
        {/*
          Month-End Checklist — promoted to first-above-the-fold position per
          /shape Q3. Context-aware: during close window (last 3 days of
          month + first 3 of next) the full reference list renders as the
          dominant section. Outside the window it compresses to a one-line
          strip that still surfaces how far off the next close is.

          Progress tracking (3 of 6 done) is a post-merge follow-up — the
          schema doesn't yet support per-item completion state.
        */}
        {inCloseWindow ? (
          <SectionCard
            title="Month-End Checklist"
            description="Close window open — work through every item before period lock"
            icon={CheckSquare}
            tone="warning"
          >
            <ol className="space-y-2 text-sm">
              {CHECKLIST.map((item, i) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border"
                  >
                    {i + 1}
                  </span>
                  <span className="text-foreground">{item}</span>
                </li>
              ))}
            </ol>
          </SectionCard>
        ) : (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
            role="status"
            aria-label="Month-end close schedule"
          >
            <div className="flex items-center gap-2.5">
              <CheckSquare
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="text-foreground">
                Next close in{' '}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {daysUntilClose}
                </span>{' '}
                {daysUntilClose === 1 ? 'day' : 'days'}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {CHECKLIST.length}-step reference · available during close window
            </span>
          </div>
        )}

        {/* Primary KPI strip — Bank Balance, Approved Budget, Withdrawn */}
        <HomeKpiStrip />

        {/* Company-wide P&L performance — lagged service period */}
        <HomePerformanceStrip />

        {/* Expense Queue */}
        <ExpenseQueuePanel />

        {/* Outstanding Receivables */}
        <OutstandingReceivablesPanel />

        {/* Misc Fund Requests */}
        <AccountantMiscRequests />

        {/* Misc Accountability Report */}
        <AccountantMiscReport />

        {/* EOD Report Panel */}
        <EodPanel />
      </div>
    </div>
  );
}
