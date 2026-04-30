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
    remaining < 0 ? 'text-danger-soft-foreground' : 'text-foreground';

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <h4 className="font-display text-[14px] font-medium text-foreground">
        Top-up limits · <em className="font-normal italic" style={{ color: 'var(--gold-lo)' }}>{monthLabel}</em>
      </h4>
      <dl className="mt-3 space-y-2.5 text-[13px]">
        <Row label="Standing" value={formatCompactKES(standing)} />
        <Row
          label="Top-ups used"
          value={
            <span>
              <span className="tabular-nums">{topUpsCount}</span>{' '}
              <span className="text-muted-foreground">draw{topUpsCount === 1 ? '' : 's'}</span>{' '}
              <span className="text-muted-foreground">·</span>{' '}
              <span>{formatCompactKES(topUpsAmount)}</span>
            </span>
          }
        />
        <Row
          label="Remaining"
          value={<span className={cn('tabular-nums', remainingTone)}>{formatCompactKES(remaining)}</span>}
        />
        {typeof pendingCount === 'number' && pendingCount > 0 && (
          <Row
            label="Pending requests"
            value={<span className="tabular-nums text-warning-soft-foreground">{pendingCount}</span>}
          />
        )}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle pb-2 last:border-b-0 last:pb-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
