// Visual spec: _design-system/withdrawals.html (.date-cell)
import { cn } from '@/lib/utils';

type DateCellProps = {
  date: string | Date;
  className?: string;
};

const DAY_FMT = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  day: 'numeric',
});

const MONTH_FMT = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  month: 'short',
  year: '2-digit',
});

export function DateCell({ date, className }: DateCellProps) {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return <div className={cn('font-mono text-muted-foreground', className)}>—</div>;
  }
  return (
    <div className={cn('font-mono tabular-nums', className)}>
      <div className="text-[20px] font-medium leading-none tracking-tight text-foreground">
        {DAY_FMT.format(d)}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {MONTH_FMT.format(d)}
      </div>
    </div>
  );
}
