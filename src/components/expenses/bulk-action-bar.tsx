'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

/**
 * Dark "selection toolbar" matching `.bulk-bar` in
 * _design-system/expenses.html. Becomes visible when the page has any
 * selected items. Pure presentational — actions are passed in by the
 * page (different surfaces use different actions per D4).
 */

type BulkActionBarProps = {
  selectedCount: number;
  totalKes: number;
  /** Optional callout when all selected items share a budget. */
  commonBudgetLabel?: string | null;
  /** Action buttons rendered to the right of the spacer. */
  actions: React.ReactNode;
  onClear(): void;
  className?: string;
};

export function BulkActionBar({
  selectedCount,
  totalKes,
  commonBudgetLabel,
  actions,
  onClear,
  className,
}: BulkActionBarProps) {
  if (selectedCount <= 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(
        'flex items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-background',
        className,
      )}
    >
      <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full bg-[var(--gold)] px-2 font-mono text-[12px] font-medium text-foreground tabular-nums">
        {selectedCount}
      </span>
      <span className="text-[13px]">
        <span className="font-medium">
          {selectedCount} {selectedCount === 1 ? 'expense' : 'expenses'} selected
        </span>
        <span className="px-1.5 text-background/50">·</span>
        total{' '}
        <span className="font-mono tabular-nums text-[var(--gold)]">
          {formatCompactKES(totalKes)}
        </span>
        {commonBudgetLabel && (
          <>
            <span className="px-1.5 text-background/50">·</span>
            all linked to{' '}
            <span className="font-mono tabular-nums text-[var(--gold)]">
              {commonBudgetLabel}
            </span>
          </>
        )}
      </span>
      <span className="flex-1" />
      <div className="flex items-center gap-2">{actions}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-1 inline-flex size-7 items-center justify-center rounded-[var(--radius)] border border-white/15 text-background/80 transition-colors hover:bg-white/10 hover:text-background"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
