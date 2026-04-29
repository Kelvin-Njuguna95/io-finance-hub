'use client';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { PendingExpenseRow, TriageSection as TriageSectionData } from '@/hooks/use-expense-queue';

import { TRIAGE_GRID, TriageRow, type TriageRowActions } from './triage-row';

/**
 * Section header + rows for the queue triage list. Always renders the
 * header, even when count is 0, so the structure stays visible.
 */

type TriageSectionProps = {
  section: TriageSectionData;
  selected: Set<string>;
  onToggleSelect(id: string): void;
  rowActions?: (row: PendingExpenseRow) => TriageRowActions;
  processing: boolean;
};

export function TriageSection({
  section,
  selected,
  onToggleSelect,
  rowActions,
  processing,
}: TriageSectionProps) {
  return (
    <div>
      <div
        className={cn(
          'flex items-baseline gap-3.5 border-y border-border-subtle px-5 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em]',
          section.isYourTurn
            ? 'border-[var(--gold)] bg-[var(--gold-soft)]'
            : 'bg-[var(--paper-2)] text-muted-foreground',
        )}
      >
        <span
          className={cn(
            section.isYourTurn ? 'text-[var(--gold-lo)]' : 'text-foreground',
          )}
        >
          {section.title}
        </span>
        <span aria-hidden className="text-[var(--paper-4)]">·</span>
        <span className="font-mono text-[10.5px] tabular-nums text-[var(--warm-grey-3)]">
          {section.count} {section.count === 1 ? 'expense' : 'expenses'} ·{' '}
          {formatCompactKES(section.totalKes)}
        </span>
        <span
          className={cn(
            'ml-auto font-mono text-[10.5px]',
            section.isYourTurn ? 'text-foreground/70' : 'text-[var(--warm-grey-3)]',
          )}
        >
          {section.isYourTurn ? 'inline actions enabled' : 'view-only here'}
        </span>
      </div>

      {section.rows.length === 0 ? (
        <div className="border-b border-border-subtle px-5 py-6 text-center text-[12.5px] text-muted-foreground">
          (no items in this stage)
        </div>
      ) : (
        section.rows.map((row) => (
          <TriageRow
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggleSelect={() => onToggleSelect(row.id)}
            isYourTurn={section.isYourTurn}
            actions={
              section.isYourTurn && rowActions ? rowActions(row) : undefined
            }
            processing={processing}
          />
        ))
      )}
    </div>
  );
}

/** Header row label for the table — exported so the page can pin it
 *  above the triage frame. */
export function TriageHeaderRow() {
  return (
    <div
      className={cn(
        'grid items-center gap-3 border-b border-border-subtle bg-[var(--paper-2)] px-5 py-3',
        'font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
        TRIAGE_GRID,
      )}
    >
      <span aria-hidden />
      <span aria-hidden />
      <span>Expense</span>
      <span>Project</span>
      <span>Linked budget · impact</span>
      <span className="text-center">Age</span>
      <span className="text-right">Amount · stage</span>
      <span className="text-right">Action</span>
    </div>
  );
}
