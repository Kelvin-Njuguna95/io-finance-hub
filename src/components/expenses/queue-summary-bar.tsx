'use client';

import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { QueueSummary } from '@/hooks/use-expense-queue';

/**
 * Section 2 of the queue page — single horizontal panel with 4 cells +
 * a "Start reviewing" CTA on the right. Mirrors `.qbar` in
 * _design-system/expense-queue-tab.html.
 *
 * Cells (left → right):
 *   - In queue            (total + count + median age)
 *   - Your turn · {Role}  (count + total + oldest)
 *   - Touching over-plan  (count + budget labels + combined)
 *   - Stalled · >48h      (count + reviewer names)
 *
 * The CTA fires `onStartReviewing` (page wires this to scroll/focus the
 * first your-turn row).
 */

type QueueSummaryBarProps = {
  summary: QueueSummary;
  onStartReviewing(): void;
  className?: string;
};

function ageLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remHours = Math.round(hours - days * 24);
  if (remHours <= 0) return `${days}d`;
  return `${days}d ${remHours}h`;
}

export function QueueSummaryBar({
  summary,
  onStartReviewing,
  className,
}: QueueSummaryBarProps) {
  const hasYourTurn = summary.yourTurn.count > 0;

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card px-6 py-5',
        'grid items-center gap-7',
        'grid-cols-1 md:grid-cols-[1.1fr_1fr_1fr_1fr_auto]',
        className,
      )}
    >
      <Cell
        label="In queue"
        value={
          <span className="font-mono tabular-nums">
            <span className="mr-1.5 text-[12px] font-normal text-muted-foreground">
              KES
            </span>
            {summary.inQueue.totalKes.toLocaleString('en-KE', {
              maximumFractionDigits: 0,
            })}
          </span>
        }
        sub={
          <>
            Across <Num>{summary.inQueue.count}</Num> expense
            {summary.inQueue.count === 1 ? '' : 's'} · median age{' '}
            <Num>{ageLabel(summary.inQueue.medianAgeHours)}</Num>
          </>
        }
        className="md:border-l-0 md:pl-0"
        first
      />
      <Cell
        label={`Your turn · ${summary.yourTurn.role}`}
        value={
          <span>
            {summary.yourTurn.count}{' '}
            <em className="not-italic font-normal italic text-[var(--gold-lo)]">
              · decide
            </em>
          </span>
        }
        sub={
          <>
            Total{' '}
            <Num>{formatCompactKES(summary.yourTurn.totalKes)}</Num>
            {summary.yourTurn.oldestAgeHours > 0 && (
              <>
                {' · '}oldest{' '}
                <Num
                  className={
                    summary.yourTurn.oldestAgeHours >= 48
                      ? 'text-[var(--danger)]'
                      : undefined
                  }
                >
                  {ageLabel(summary.yourTurn.oldestAgeHours)}
                </Num>
              </>
            )}
          </>
        }
      />
      <Cell
        label="Touching over-plan budgets"
        value={
          summary.overPlan.count === 1
            ? '1 expense'
            : `${summary.overPlan.count} expenses`
        }
        sub={
          summary.overPlan.count === 0 ? (
            <span className="text-muted-foreground">No overruns linked</span>
          ) : (
            <>
              {summary.overPlan.budgetLabels.length === 1 ? (
                <>
                  All on{' '}
                  <Num>{summary.overPlan.budgetLabels[0]}</Num>
                </>
              ) : (
                <>
                  Across <Num>{summary.overPlan.budgetLabels.length}</Num>{' '}
                  budgets
                </>
              )}
              {' · '}combined{' '}
              <Num className="text-[var(--danger)]">
                +{formatCompactKES(summary.overPlan.comboOverKes)}
              </Num>
            </>
          )
        }
      />
      <Cell
        label="Stalled · > 48h"
        value={
          summary.stalled.count === 1
            ? '1 expense'
            : `${summary.stalled.count} expenses`
        }
        sub={
          summary.stalled.count === 0 ? (
            <span className="text-muted-foreground">No stalls this month</span>
          ) : summary.stalled.reviewerNames.length > 0 ? (
            <>
              Awaiting{' '}
              {summary.stalled.reviewerNames.slice(0, 2).map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <Num>{n}</Num>
                </span>
              ))}
              {summary.stalled.reviewerNames.length > 2 && (
                <Num>{` +${summary.stalled.reviewerNames.length - 2}`}</Num>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">
              Awaiting decision · &gt; {summary.stalled.thresholdHours}h
            </span>
          )
        }
      />

      <div className="flex flex-col items-stretch gap-2">
        <button
          type="button"
          onClick={onStartReviewing}
          disabled={!hasYourTurn}
          className={cn(
            'inline-flex h-12 items-center gap-3 rounded-[var(--radius)] border px-5 text-[14px] font-medium transition-colors',
            hasYourTurn
              ? 'border-foreground bg-foreground text-background hover:bg-[var(--ink-2)]'
              : 'cursor-not-allowed border-border bg-card text-muted-foreground',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'size-[7px] rounded-full',
              hasYourTurn ? 'bg-[var(--gold)]' : 'bg-[var(--paper-4)]',
            )}
          />
          <span>Start reviewing</span>
          <ArrowRight className="ml-1 size-4" strokeWidth={2} />
        </button>
        <span className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {hasYourTurn
            ? `Opens ${summary.yourTurn.count} · ${summary.yourTurn.role} queue`
            : 'No items for your role'}
        </span>
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
  first,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  first?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0',
        !first && 'md:border-l md:border-border-subtle md:pl-7',
        className,
      )}
    >
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 font-display text-[26px] font-medium leading-none tracking-[-0.01em] text-foreground">
        {value}
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--warm-grey-3)]">{sub}</p>
    </div>
  );
}

function Num({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums text-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}
