'use client';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { DriverRow } from '@/hooks/use-variance';

/**
 * Ranked driver list matching `.drivers` in
 * _design-system/variance.html. Each row shows a tone-coloured rank
 * circle, the driver name + meta, and the signed impact.
 *
 * Tone (from `useVariance.drivers`):
 *   bad     → over-plan, red rank circle
 *   good    → under-plan, green rank circle
 *   neutral → |variance_pct| < 2, muted rank circle
 */

type VarianceDriversListProps = {
  drivers: DriverRow[];
  /** Optional cap; shows up to all if omitted. */
  limit?: number;
  className?: string;
};

const RANK_TONE: Record<DriverRow['tone'], string> = {
  bad: 'bg-danger-soft border-[var(--danger)] text-[var(--danger)]',
  good: 'bg-success-soft border-[var(--success)] text-success-soft-foreground',
  neutral: 'bg-[var(--paper-2)] border-border text-[var(--warm-grey-3)]',
};

const IMPACT_TONE: Record<DriverRow['tone'], string> = {
  bad: 'text-[var(--danger)]',
  good: 'text-success-soft-foreground',
  neutral: 'text-foreground',
};

export function VarianceDriversList({
  drivers,
  limit,
  className,
}: VarianceDriversListProps) {
  const rows = typeof limit === 'number' ? drivers.slice(0, limit) : drivers;

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No variance drivers for this period.
      </div>
    );
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {rows.map((row) => {
        const sign = row.varianceKes >= 0 ? '+ ' : '− ';
        const pctSign = row.variancePct >= 0 ? '+ ' : '− ';
        return (
          <li
            key={row.id}
            className={cn(
              'grid grid-cols-[auto_1fr_auto] items-center gap-3.5 border-b border-border-subtle py-3',
              'first:pt-0 last:border-b-0 last:pb-0',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-medium',
                RANK_TONE[row.tone],
              )}
            >
              {row.rank}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium leading-tight text-foreground">
                {row.label}
              </p>
              <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                {row.project} · {row.category} · {row.count}{' '}
                {row.count === 1 ? 'expense' : 'expenses'}
              </p>
            </div>
            <div
              className={cn(
                'text-right font-mono leading-none tabular-nums',
                IMPACT_TONE[row.tone],
              )}
            >
              <p className="text-[14px] font-medium">
                {sign}
                {formatCompactKES(Math.abs(row.varianceKes)).replace('KES ', '')}
              </p>
              <p className="mt-1.5 text-[10.5px] font-medium uppercase tracking-[0.10em] text-muted-foreground">
                {pctSign}
                {Math.abs(row.variancePct).toFixed(0)}% line
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
