// Visual spec: _design-system/invoices.html (.status pill — see app-shell.css)
import { cn } from '@/lib/utils';

export type InvoiceStatusKind =
  | 'draft'
  | 'sent'
  | 'open'
  | 'overdue'
  | 'paid'
  | 'partial'
  | 'pending';

type InvoiceStatusPillProps = {
  kind: InvoiceStatusKind;
  className?: string;
};

const KIND_TONE: Record<InvoiceStatusKind, string> = {
  draft: 'bg-[var(--paper-3)] text-[var(--warm-grey-3)]',
  sent: 'bg-info-soft text-info-soft-foreground',
  open: 'bg-info-soft text-info-soft-foreground',
  overdue: 'bg-danger-soft text-danger-soft-foreground',
  paid: 'bg-success-soft text-success-soft-foreground',
  partial: 'bg-[var(--gold-soft)] text-[oklch(0.40_0.10_75)]',
  pending: 'bg-[var(--paper-3)] text-[var(--warm-grey-3)]',
};

const KIND_LABEL: Record<InvoiceStatusKind, string> = {
  draft: 'Draft',
  sent: 'Sent',
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  partial: 'Partial',
  pending: 'Pending',
};

export function InvoiceStatusPill({ kind, className }: InvoiceStatusPillProps) {
  return (
    <span
      className={cn(
        // .status: padding 4px 10px, fs 11, weight 500, letter-spacing 0.02em, radius full
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.02em]',
        KIND_TONE[kind],
        className,
      )}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
