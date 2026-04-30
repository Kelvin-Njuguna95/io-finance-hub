import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

import { MiscStatusPill, type MiscStatusKind } from './MiscStatusPill';

type MiscProjectCardProps = {
  projectName: string;
  directorTag?: string | null;
  pmName?: string | null;
  allocation: number;
  totalDrawn: number;
  standingTotal: number;
  topUpsTotal: number;
  topUpsCount: number;
  itemisationPct?: number | null;
  variance?: number | null;
  varianceIsReconciled?: boolean;
  submittedLabel?: string | null;
  status: MiscStatusKind;
  statusCount?: number;
  statusSubtext?: string;
  onClick?: () => void;
  className?: string;
};

function formatPct(pct?: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
}

export function MiscProjectCard({
  projectName,
  directorTag,
  pmName,
  allocation,
  totalDrawn,
  standingTotal,
  topUpsTotal,
  topUpsCount,
  itemisationPct,
  variance,
  varianceIsReconciled,
  submittedLabel,
  status,
  statusCount,
  statusSubtext,
  onClick,
  className,
}: MiscProjectCardProps) {
  const itemisationCapped =
    itemisationPct == null ? 0 : Math.max(0, Math.min(100, itemisationPct));
  const showVariance = variance != null && Number.isFinite(variance);
  const varianceTone = varianceIsReconciled
    ? 'text-success-soft-foreground'
    : showVariance && (variance ?? 0) !== 0
      ? 'text-danger-soft-foreground'
      : 'text-muted-foreground';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/proj relative flex w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors',
        'hover:border-border-strong hover:bg-muted/40',
        'before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-foreground/40 before:opacity-0',
        'hover:before:opacity-100',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: project + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="font-display text-[17px] font-medium leading-tight tracking-[-0.005em] text-foreground">
              {projectName}
            </h3>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {pmName && (
              <span>
                PM <span className="text-foreground/80">{pmName}</span>
              </span>
            )}
            {directorTag && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-danger" />
                <span>
                  Director · <span className="text-foreground/80">{directorTag}</span>
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Right: status pill */}
        <div className="flex shrink-0 items-start gap-2">
          <MiscStatusPill kind={status} count={statusCount} subtext={statusSubtext} />
          <ChevronRight className="mt-1 size-4 text-muted-foreground/60" aria-hidden />
        </div>
      </div>

      {/* Middle: numeric strip */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Allocation
          </div>
          <div className="font-mono text-sm tabular-nums">
            {allocation > 0 ? formatCompactKES(allocation) : '—'}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Drawn
          </div>
          <div className="font-mono text-sm tabular-nums text-foreground">
            {formatCompactKES(totalDrawn)}
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/80">
            {formatCompactKES(standingTotal)} standing · {formatCompactKES(topUpsTotal)} top-up
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Itemised
          </div>
          <div className="font-mono text-sm tabular-nums">{formatPct(itemisationPct)}</div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/70"
              style={{ width: `${itemisationCapped}%` }}
            />
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Variance
          </div>
          <div className={cn('font-mono text-sm tabular-nums', varianceTone)}>
            {showVariance ? formatCompactKES(variance ?? 0) : '—'}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10px] tabular-nums text-muted-foreground/80">
            {topUpsCount > 0 && <span>{topUpsCount} top-up{topUpsCount === 1 ? '' : 's'}</span>}
            {submittedLabel && <span>{submittedLabel}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}
