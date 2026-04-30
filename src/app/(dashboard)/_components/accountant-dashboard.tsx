'use client';

import { CheckSquare } from 'lucide-react';

import { PageTitle } from '@/components/layout/page-title';
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

import { cn } from '@/lib/utils';

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
  const monthLabel = formatYearMonth(currentMonth);

  // Compute once per render; close-window is a date-only signal.
  const now = new Date();
  const inCloseWindow = isWithinCloseWindow(now);
  const daysUntilClose = daysUntilNextClose(now);

  const subtitle = inCloseWindow
    ? `${monthLabel} · close window open`
    : `${monthLabel} · next close in ${daysUntilClose} day${daysUntilClose === 1 ? '' : 's'}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Accountant"
        accent="control"
        subtitle={subtitle}
      />

      <div className="mt-6 space-y-6">
        {/*
          Month-End Checklist — promoted to first-above-the-fold position.
          Context-aware: during close window (last 3 days of month + first
          3 of next) the full reference list renders as a warning banner
          + numbered list. Outside the window it compresses to a one-line
          paper-2 strip that surfaces how far off the next close is.

          Progress tracking (3 of 6 done) is a post-merge follow-up — the
          schema doesn't yet support per-item completion state.
        */}
        {inCloseWindow ? (
          <section
            className={cn(
              'overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card',
              'border-l-[3px] border-l-[var(--gold)]',
            )}
          >
            <div className="flex items-start gap-3 border-b border-border-subtle bg-[var(--paper-2)] px-5 py-3.5">
              <span className="flex size-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--gold-soft)] text-[oklch(0.42_0.10_75)]">
                <CheckSquare className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <h2
                  className="font-display text-[16px] font-medium leading-tight tracking-[-0.005em] text-foreground"
                  style={{ fontVariationSettings: '"opsz" 28' }}
                >
                  Month-end{' '}
                  <em className="font-normal italic" style={{ color: 'var(--gold-lo)' }}>
                    checklist
                  </em>
                </h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Close window open — work through every item before period lock.
                </p>
              </div>
            </div>
            <ol className="divide-y divide-border-subtle">
              {CHECKLIST.map((item, i) => (
                <li
                  key={item}
                  className="flex items-start gap-3 px-5 py-3 text-[13px] text-foreground"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--paper-2)] font-mono text-[10.5px] font-semibold tabular-nums text-muted-foreground ring-1 ring-inset ring-border-subtle"
                  >
                    {i + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <div
            className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-card px-5 py-3"
            role="status"
            aria-label="Month-end close schedule"
          >
            <div className="flex items-center gap-2.5">
              <CheckSquare
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
                strokeWidth={1.75}
              />
              <span className="text-[13px] text-foreground">
                Next close in{' '}
                <span className="font-mono font-semibold tabular-nums">{daysUntilClose}</span>{' '}
                {daysUntilClose === 1 ? 'day' : 'days'}
              </span>
            </div>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
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
