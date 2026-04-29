'use client';

import { AlertTriangle, Link as LinkIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Compact monospace chip used on expense rows to show the linked budget
 * + utilization. Tone shifts to danger when the budget is over plan.
 *
 * The eyebrow ID format `BUD-{YYYYMM}-{last4}` matches the synthesized
 * label used in budgets/budgets-list-row.tsx.
 */

type BudgetChipProps = {
  budgetId: string;
  /** Pre-synthesized budget label (`BUD-...`). */
  budgetLabel: string;
  utilizationPct: number;
  isOver: boolean;
  className?: string;
};

export function BudgetChip({
  budgetLabel,
  utilizationPct,
  isOver,
  className,
}: BudgetChipProps) {
  const Icon = isOver ? AlertTriangle : LinkIcon;
  const pctRounded = Math.max(0, Math.round(utilizationPct));

  const subline = isOver
    ? `+${Math.round(utilizationPct - 100)}% over plan`
    : utilizationPct === 0
      ? 'not started'
      : `${pctRounded}% used`;

  return (
    <div className={cn('min-w-0', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius)] border bg-[var(--paper-2)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em]',
          isOver
            ? 'border-danger-soft text-danger'
            : 'border-border-subtle text-foreground',
        )}
      >
        <Icon
          className={cn(
            'size-3 shrink-0',
            isOver ? 'text-danger' : 'text-[var(--gold-lo)]',
          )}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="truncate">{budgetLabel}</span>
      </span>
      <p
        className={cn(
          'mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em]',
          isOver ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        {subline}
      </p>
    </div>
  );
}
