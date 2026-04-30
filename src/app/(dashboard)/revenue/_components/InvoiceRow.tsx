// Visual spec: _design-system/invoices.html (.list-row.lr-inv 7-col grid)
import { ChevronDown, ChevronUp, MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';

import { AgingPill, type AgingPillVariant } from './AgingPill';
import { BackdatedChip } from './BackdatedChip';
import { DueBar, type DueBarVariant } from './DueBar';
import { InvoiceStatusPill, type InvoiceStatusKind } from './InvoiceStatusPill';

const ROW_GRID =
  'grid grid-cols-[1.6fr_1fr_110px_130px_200px_130px_50px] items-center gap-4';

export type InvoiceSortKey = 'invoice' | 'client' | 'issued' | 'due' | 'amount' | 'status';
export type SortDirection = 'asc' | 'desc';

type InvoiceRowHeadProps = {
  sortKey?: InvoiceSortKey | null;
  sortDirection?: SortDirection;
  onSort?: (key: InvoiceSortKey) => void;
};

function HeadCell({
  label,
  align = 'left',
  sortable,
  active,
  direction,
  onClick,
}: {
  label: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  active?: boolean;
  direction?: SortDirection;
  onClick?: () => void;
}) {
  const content = (
    <span className={cn('inline-flex items-center gap-1', active && 'text-foreground')}>
      {label}
      {sortable && (
        <span aria-hidden className="text-muted-foreground/70">
          {active ? (
            direction === 'asc' ? (
              <ChevronUp className="size-3" strokeWidth={1.75} />
            ) : (
              <ChevronDown className="size-3" strokeWidth={1.75} />
            )
          ) : (
            <ChevronDown className="size-3 opacity-40" strokeWidth={1.75} />
          )}
        </span>
      )}
    </span>
  );
  return (
    <div className={cn(align === 'right' && 'text-right')}>
      {sortable && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center hover:text-foreground"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </div>
  );
}

export function InvoiceRowHead({ sortKey, sortDirection = 'desc', onSort }: InvoiceRowHeadProps) {
  return (
    <div
      className={cn(
        ROW_GRID,
        'border-b border-border bg-[var(--paper-2)] px-5 py-3',
        'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
      )}
    >
      <HeadCell
        label="Invoice"
        sortable={!!onSort}
        active={sortKey === 'invoice'}
        direction={sortDirection}
        onClick={onSort ? () => onSort('invoice') : undefined}
      />
      <HeadCell label="Client" />
      <HeadCell label="Issued" />
      <HeadCell
        label="Due"
        sortable={!!onSort}
        active={sortKey === 'due'}
        direction={sortDirection}
        onClick={onSort ? () => onSort('due') : undefined}
      />
      <HeadCell
        label="Amount"
        align="right"
        sortable={!!onSort}
        active={sortKey === 'amount'}
        direction={sortDirection}
        onClick={onSort ? () => onSort('amount') : undefined}
      />
      <HeadCell
        label="Status"
        align="right"
        sortable={!!onSort}
        active={sortKey === 'status'}
        direction={sortDirection}
        onClick={onSort ? () => onSort('status') : undefined}
      />
      <div />
    </div>
  );
}

type InvoiceRowProps = {
  invoiceNumber: string;
  invoiceTitle?: string | null;
  invoiceSub?: string | null;

  clientName?: string | null;
  clientSub?: string | null;

  issuedDateLabel?: string | null;
  dueDateLabel?: string | null;

  ageVariant: AgingPillVariant;
  ageLabel: string;

  amountKes: number;
  amountKesFallback?: string | null;
  outstandingLabel?: string | null;

  dueBarVariant?: DueBarVariant | null;
  dueBarPct?: number;

  status: InvoiceStatusKind;

  isBackdated?: boolean;

  /** Optional row-actions column content (e.g., "More" menu button). */
  actions?: React.ReactNode;

  onClick?: () => void;
  className?: string;
};

export function InvoiceRow({
  invoiceNumber,
  invoiceTitle,
  invoiceSub,
  clientName,
  clientSub,
  issuedDateLabel,
  dueDateLabel,
  ageVariant,
  ageLabel,
  amountKes,
  amountKesFallback,
  outstandingLabel,
  dueBarVariant,
  dueBarPct,
  status,
  isBackdated,
  actions,
  onClick,
  className,
}: InvoiceRowProps) {
  const amountText =
    amountKes > 0
      ? formatCurrency(amountKes, 'KES')
      : amountKesFallback || '—';

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        ROW_GRID,
        'border-b border-border-subtle px-5 py-4 transition-colors last:border-b-0',
        onClick && 'cursor-pointer hover:bg-[var(--paper-2)]',
        className,
      )}
    >
      {/* 1. Invoice id + title + sub */}
      <div className="min-w-0">
        <span className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
          {invoiceNumber}
        </span>
        {invoiceTitle && (
          <div className="mt-0.5 truncate text-[14px] font-medium text-foreground">
            {invoiceTitle}
            {isBackdated && <BackdatedChip />}
          </div>
        )}
        {invoiceSub && (
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {invoiceSub}
          </div>
        )}
      </div>

      {/* 2. Client */}
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">
          {clientName || '—'}
        </div>
        {clientSub && (
          <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {clientSub}
          </div>
        )}
      </div>

      {/* 3. Issued */}
      <div className="font-mono text-[12px] tabular-nums text-foreground">
        {issuedDateLabel || '—'}
      </div>

      {/* 4. Due + age */}
      <div className="space-y-1.5">
        <div className="font-mono text-[12px] tabular-nums text-foreground">
          {dueDateLabel || '—'}
        </div>
        <AgingPill variant={ageVariant} label={ageLabel} />
      </div>

      {/* 5. Amount + due bar / outstanding */}
      <div className="text-right">
        <div className="font-mono text-[14px] font-medium tabular-nums text-foreground">
          <span className="mr-1 text-[11px] text-muted-foreground">KES</span>
          {amountKes > 0
            ? amountKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })
            : amountText}
        </div>
        {outstandingLabel ? (
          <div className="mt-1 font-mono text-[11px] text-[var(--gold-lo)]">
            {outstandingLabel}
          </div>
        ) : dueBarVariant ? (
          <DueBar variant={dueBarVariant} pct={dueBarPct} className="mt-1.5" />
        ) : null}
      </div>

      {/* 6. Status pill */}
      <div className="flex justify-end">
        <InvoiceStatusPill kind={status} />
      </div>

      {/* 7. Row actions */}
      <div className="flex justify-end">
        {actions ? (
          actions
        ) : (
          <button
            type="button"
            aria-label="More"
            className="rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
