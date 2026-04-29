'use client';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

/**
 * Day-separator header for the expenses list, matching `.day-sep` in
 * _design-system/expenses.html. Renders the absolute date, the day's
 * total, and the expense count in monospace eyebrow style.
 *
 * If `isToday` is true, the leading label says "TODAY · {date}".
 */

const NAIROBI_TZ = 'Africa/Nairobi';

type ExpenseDayGroupProps = {
  date: Date;
  totalKes: number;
  count: number;
  isToday?: boolean;
  className?: string;
};

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function ExpenseDayGroup({
  date,
  totalKes,
  count,
  isToday,
  className,
}: ExpenseDayGroupProps) {
  const dateLabel = formatDayLabel(date);
  return (
    <div
      className={cn(
        'flex items-baseline gap-3 border-b border-border-subtle bg-[var(--paper-2)] px-5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
        className,
      )}
    >
      <span>
        {isToday ? 'Today · ' : ''}
        {dateLabel}
      </span>
      <span aria-hidden className="text-[var(--paper-4)]">—</span>
      <span className="tabular-nums text-foreground">
        {formatCompactKES(totalKes)}
      </span>
      <span className="ml-auto">
        {count} {count === 1 ? 'expense' : 'expenses'}
      </span>
    </div>
  );
}
