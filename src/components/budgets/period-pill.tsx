import { cn } from '@/lib/utils';

type PeriodPillProps = {
  /** YYYY-MM */
  yearMonth: string;
  className?: string;
};

export function PeriodPill({ yearMonth, className }: PeriodPillProps) {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number.parseInt(yStr ?? '', 10);
  const m = Number.parseInt(mStr ?? '', 10);
  let label = yearMonth;
  if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
    label = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      month: 'short',
      year: 'numeric',
    }).format(new Date(y, m - 1, 1));
  }
  return (
    <span
      className={cn(
        'font-mono text-[12px] tabular-nums text-foreground',
        className,
      )}
    >
      {label}
    </span>
  );
}
