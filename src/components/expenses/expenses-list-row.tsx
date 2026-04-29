'use client';

import { MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { ExpenseListRow } from '@/hooks/use-expenses-list';

import { BudgetChip } from './budget-chip';
import { ReceiptIndicator } from './receipt-indicator';

const NAIROBI_TZ = 'Africa/Nairobi';

const TONE_CLASS = {
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
  muted: 'bg-muted text-foreground/80',
  info: 'bg-info-soft text-info-soft-foreground',
} as const;

type StatusTone = keyof typeof TONE_CLASS;

function compactExpenseId(expenseDate: string, id: string): string {
  // EXP-{MM}-{DD}-{last4}
  const parts = expenseDate.split('-');
  const mm = parts[1] ?? '00';
  const dd = parts[2] ?? '00';
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `EXP-${mm}-${dd}-${tail}`;
}

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function dayOfMonth(dateStr: string): string {
  const parts = dateStr.split('-');
  return parts[2] ?? '—';
}

function statusDisplay(status: string): { label: string; tone: StatusTone } {
  if (status === 'confirmed') return { label: 'Approved', tone: 'success' };
  if (status === 'modified') return { label: 'Modified', tone: 'success' };
  if (status === 'pending_auth') return { label: 'Pending', tone: 'warning' };
  if (status === 'under_review') return { label: 'Under review', tone: 'info' };
  if (status === 'voided') return { label: 'Rejected', tone: 'danger' };
  if (status === 'carried_forward')
    return { label: 'Carried fwd', tone: 'muted' };
  return { label: 'Draft', tone: 'muted' };
}

export const EXPENSES_LIST_GRID =
  'grid-cols-[40px_100px_1.6fr_1fr_1fr_120px_120px_110px_44px]';

export type ExpensesListRowActions = {
  canDelete: boolean;
  onDelete(): void;
};

type ExpensesListRowProps = {
  row: ExpenseListRow;
  selected: boolean;
  onToggleSelect(): void;
  actions: ExpensesListRowActions;
  onClick?: () => void;
};

export function ExpensesListRow({
  row,
  selected,
  onToggleSelect,
  actions,
  onClick,
}: ExpensesListRowProps) {
  const status = statusDisplay(row.lifecycleStatus);
  const eyebrow = compactExpenseId(row.expenseDate, row.id);
  const hasReceipt = Boolean(row.receiptReference && row.receiptReference.trim());
  const hoursSinceCreated = (() => {
    const t = new Date(row.createdAt).getTime();
    if (Number.isNaN(t)) return undefined;
    return (Date.now() - t) / 3_600_000;
  })();

  return (
    <div
      className={cn(
        'grid items-center gap-4 border-b border-border/60 px-4 py-3.5 text-left transition-colors',
        'hover:bg-muted/40 focus-within:bg-muted/30',
        EXPENSES_LIST_GRID,
      )}
    >
      {/* Col 0 — selection */}
      <div className="flex items-center justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Select expense"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Col 1 — date stack */}
      <div
        className="cursor-pointer font-mono tabular-nums"
        onClick={onClick}
        role="button"
        tabIndex={-1}
      >
        <span className="block text-[16px] font-medium leading-none text-foreground">
          {dayOfMonth(row.expenseDate)}
        </span>
        <span className="mt-1.5 block text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          {timeOfDay(row.createdAt)}
        </span>
      </div>

      {/* Col 2 — expense */}
      <div
        className="min-w-0 cursor-pointer"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        }}
      >
        <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          {eyebrow}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {row.description}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {row.vendor ? (
            <>
              Vendor:{' '}
              <span className="font-medium text-foreground">{row.vendor}</span>
              {' · '}
            </>
          ) : null}
          submitted by {row.enteredByName}
        </p>
        <ReceiptIndicator
          hasReference={hasReceipt}
          hoursSinceCreated={hasReceipt ? undefined : hoursSinceCreated}
          className="mt-1"
        />
      </div>

      {/* Col 3 — project */}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {row.projectName ?? 'Shared'}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {row.projectName ? 'Project · KES' : 'Shared cost'}
        </p>
      </div>

      {/* Col 4 — budget chip */}
      <div className="min-w-0">
        {row.budgetId ? (
          <BudgetChip
            budgetId={row.budgetId}
            budgetLabel={row.budgetLabel}
            utilizationPct={row.budgetUtilizationPct}
            isOver={row.budgetIsOver}
          />
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">
            no link
          </span>
        )}
      </div>

      {/* Col 5 — category */}
      <div className="min-w-0">
        {row.categoryName ? (
          <span className="inline-flex h-5 items-center rounded-[var(--radius-sm)] bg-muted px-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-foreground/80">
            {row.categoryName}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">—</span>
        )}
      </div>

      {/* Col 6 — amount */}
      <div className="text-right font-mono text-[14px] font-medium tabular-nums text-foreground">
        {formatCompactKES(row.amountKes)}
      </div>

      {/* Col 7 — status pill */}
      <div className="flex justify-end">
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-[var(--radius-sm)] px-2 text-[11px] font-medium uppercase tracking-[0.06em]',
            TONE_CLASS[status.tone],
          )}
        >
          {status.label}
        </span>
      </div>

      {/* Col 8 — kebab */}
      <div className="flex justify-end">
        {actions.canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Expense actions"
                  className="size-7"
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className="text-danger-soft-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onDelete();
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span aria-hidden className="block size-7" />
        )}
      </div>
    </div>
  );
}
