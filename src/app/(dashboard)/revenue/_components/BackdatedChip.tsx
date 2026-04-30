// Visual spec: _design-system/invoices.html (Backdated inline chip on row title)
import { cn } from '@/lib/utils';

type BackdatedChipProps = {
  className?: string;
};

export function BackdatedChip({ className }: BackdatedChipProps) {
  return (
    <span
      className={cn(
        'ml-2 inline-flex items-center rounded-full border border-[var(--gold)] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--gold-lo)]',
        className,
      )}
    >
      Backdated
    </span>
  );
}
