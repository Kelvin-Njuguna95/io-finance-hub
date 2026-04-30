// Visual spec: _design-system/Misc Draws and Reports.html (Top-up limits · April block)
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

type TopUpLimitsPanelProps = {
  monthLabel: string;
  standing: number;
  topUpsCount: number;
  topUpsAmount: number;
  remaining: number;
  pendingCount?: number;
  className?: string;
};

export function TopUpLimitsPanel({
  monthLabel,
  standing,
  topUpsCount,
  topUpsAmount,
  remaining,
  pendingCount,
  className,
}: TopUpLimitsPanelProps) {
  const remainingTone =
    remaining < 0 ? 'text-[var(--danger)]' : 'text-success-soft-foreground';

  return (
    <div className={cn('border-t border-border-subtle pt-4', className)}>
      <div className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Top-up limits · {monthLabel}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11.5px] tabular-nums">
        <dt className="text-muted-foreground">Standing</dt>
        <dd className="text-right text-foreground">{formatCompactKES(standing)}</dd>

        <dt className="text-muted-foreground">Top-ups used</dt>
        <dd className="text-right text-foreground">
          {topUpsCount} draw{topUpsCount === 1 ? '' : 's'} · {formatCompactKES(topUpsAmount).replace('KES ', '')}
        </dd>

        <dt className="text-muted-foreground">Remaining</dt>
        <dd className={cn('text-right', remainingTone)}>{formatCompactKES(remaining)}</dd>

        {typeof pendingCount === 'number' && pendingCount > 0 && (
          <>
            <dt className="text-muted-foreground">Pending requests</dt>
            <dd className="text-right text-warning-soft-foreground">{pendingCount}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
