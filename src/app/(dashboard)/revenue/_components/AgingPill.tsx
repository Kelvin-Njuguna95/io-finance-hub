// Visual spec: _design-system/invoices.html (.age chip in invoice row's due column)
import { cn } from '@/lib/utils';

export type AgingPillVariant = 'default' | 'warn' | 'danger' | 'paid' | null;

type AgingPillProps = {
  variant: AgingPillVariant;
  label: string;
  className?: string;
};

const VARIANT_CLASSES: Record<NonNullable<AgingPillVariant>, { text: string; dot: string }> = {
  default: { text: 'text-muted-foreground', dot: 'bg-[var(--paper-4)]' },
  warn: { text: 'text-[var(--gold-lo)]', dot: 'bg-[var(--gold)]' },
  danger: { text: 'text-[var(--danger)]', dot: 'bg-[var(--danger)]' },
  paid: { text: 'text-success-soft-foreground', dot: 'bg-[var(--success)]' },
};

export function AgingPill({ variant, label, className }: AgingPillProps) {
  if (variant === null) {
    return (
      <span className={cn('font-mono text-[11px] tabular-nums text-muted-foreground', className)}>—</span>
    );
  }
  const classes = VARIANT_CLASSES[variant];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tabular-nums tracking-[0.10em]',
        classes.text,
        className,
      )}
    >
      <span aria-hidden className={cn('size-[7px] rounded-full', classes.dot)} />
      {label}
    </span>
  );
}

/**
 * Compute the aging variant + label for an invoice.
 * Inputs: due_date (ISO), paid status, payment_date (when fully paid).
 */
export function computeAgingPill({
  dueDate,
  isPaid,
  paidDate,
  hasIssued = true,
}: {
  dueDate: string | null | undefined;
  isPaid: boolean;
  paidDate?: string | null;
  hasIssued?: boolean;
}): { variant: AgingPillVariant; label: string } {
  if (!hasIssued) {
    return { variant: 'default', label: 'not issued' };
  }
  if (isPaid) {
    if (paidDate) {
      const fmt = new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        day: '2-digit',
        month: 'short',
      }).format(new Date(paidDate));
      return { variant: 'paid', label: `paid ${fmt.toLowerCase()}` };
    }
    return { variant: 'paid', label: 'paid' };
  }
  if (!dueDate) {
    return { variant: null, label: '' };
  }
  const due = new Date(dueDate);
  const now = new Date();
  const days = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    const late = Math.abs(days);
    return { variant: 'danger', label: `${late} day${late === 1 ? '' : 's'} late` };
  }
  if (days <= 7) {
    return { variant: 'warn', label: `due in ${days} day${days === 1 ? '' : 's'}` };
  }
  return { variant: 'default', label: `due in ${days} days` };
}
