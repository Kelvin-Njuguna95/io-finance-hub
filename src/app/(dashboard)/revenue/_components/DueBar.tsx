// Visual spec: _design-system/invoices.html (.due-bar inline progress bar)
import { cn } from '@/lib/utils';

export type DueBarVariant = 'default' | 'over' | 'paid';

type DueBarProps = {
  variant: DueBarVariant;
  /** Fill percent 0..100. Defaults to 100 for over/paid. */
  pct?: number;
  className?: string;
};

const VARIANT_FILL: Record<DueBarVariant, string> = {
  default: 'bg-[var(--gold)]',
  over: 'bg-[var(--danger)]',
  paid: 'bg-[var(--success)]',
};

export function DueBar({ variant, pct, className }: DueBarProps) {
  const width = Math.max(0, Math.min(100, pct ?? (variant === 'default' ? 50 : 100)));
  return (
    <div
      role="progressbar"
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        // .due-bar: height 4px, paper-3 track, radius full, w 120px
        'relative ml-auto h-1 w-[120px] overflow-hidden rounded-full bg-[var(--paper-3)]',
        className,
      )}
    >
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full', VARIANT_FILL[variant])}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
