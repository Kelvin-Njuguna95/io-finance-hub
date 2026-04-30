// Visual spec: _design-system/Misc Draws and Reports.html
// Pattern: .list-frame > .list-head.lr-misc + .list-row.lr-misc rows.
// 8-col grid: 1.6fr 0.8fr 1fr 1fr 1fr 1.2fr 130px 50px
import { MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatCompactKES, formatCurrency } from '@/lib/format';

import { MiscStatusPill, type MiscStatusKind } from './MiscStatusPill';

const ROW_GRID =
  'grid grid-cols-[1.6fr_0.8fr_1fr_1fr_1fr_1.2fr_130px_50px] items-center gap-4';

export function MiscProjectRowHead() {
  return (
    <div
      className={cn(
        ROW_GRID,
        'border-b border-border bg-[var(--paper-2)] px-5 py-3',
        'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
      )}
    >
      <div>Project · PM</div>
      <div className="text-right">Drawn (KES)</div>
      <div>Itemised vs drawn</div>
      <div className="text-right">Variance</div>
      <div className="text-right">Last activity</div>
      <div>Cadence</div>
      <div>Report status</div>
      <div />
    </div>
  );
}

type ItemBarTone = 'ok' | 'short' | 'bad';

type MiscProjectCardProps = {
  projectName: string;
  pmName?: string | null;
  projectMeta?: string | null;
  directorTag?: string | null;

  drawn: number;
  standingTotal: number;
  topUpsTotal: number;
  topUpsCount: number;

  itemisationPct?: number | null;
  itemisationLineCount?: number;
  itemisationItemisedKes?: number;

  variance?: number | null;
  varianceState?: 'reconciled' | 'within-tolerance' | 'unaccounted';

  lastActivityDate?: string | null;
  lastActivityLabel?: string;

  monthlyAllocation: number;

  status: MiscStatusKind;
  statusCount?: number;
  statusSubtext?: string;

  isOverdue?: boolean;

  onClick?: () => void;
  className?: string;
};

function pctTone(pct: number | null | undefined, hasReport: boolean): ItemBarTone {
  if (!hasReport) return 'bad';
  const v = pct ?? 0;
  if (v <= 0) return 'bad';
  if (v >= 80) return 'ok';
  return 'short';
}

const FILL_TONE: Record<ItemBarTone, string> = {
  ok: 'bg-[oklch(0.55_0.13_145)] text-[var(--paper)]',
  short: 'bg-[var(--gold)] text-[var(--ink)]',
  bad: 'bg-[var(--danger)] text-[var(--paper)]',
};

function VarianceCell({
  variance,
  state,
}: {
  variance: number | null | undefined;
  state: MiscProjectCardProps['varianceState'];
}) {
  if (variance == null) {
    return (
      <div className="text-right">
        <div className="font-mono text-base tabular-nums text-muted-foreground">—</div>
      </div>
    );
  }
  const colorClass =
    state === 'unaccounted'
      ? 'text-[var(--danger)]'
      : state === 'reconciled'
        ? 'text-success-soft-foreground'
        : 'text-foreground';
  const subText =
    state === 'unaccounted'
      ? 'Unaccounted'
      : state === 'reconciled'
        ? 'Fully reconciled'
        : 'Within tolerance';
  return (
    <div className="text-right">
      <div className={cn('font-mono text-base font-medium tabular-nums', colorClass)}>
        <span className="mr-1 text-[11px] text-muted-foreground">KES</span>
        {Math.abs(variance).toLocaleString('en-KE', { maximumFractionDigits: 0 })}
      </div>
      <div className={cn('mt-1 text-[11px]', state === 'unaccounted' ? 'text-[var(--danger)]' : 'text-muted-foreground')}>
        {subText}
      </div>
    </div>
  );
}

export function MiscProjectCard({
  projectName,
  pmName,
  projectMeta,
  directorTag,
  drawn,
  standingTotal,
  topUpsTotal,
  topUpsCount,
  itemisationPct,
  itemisationLineCount,
  itemisationItemisedKes,
  variance,
  varianceState,
  lastActivityDate,
  lastActivityLabel,
  monthlyAllocation,
  status,
  statusCount,
  statusSubtext,
  isOverdue,
  onClick,
  className,
}: MiscProjectCardProps) {
  const tone = pctTone(itemisationPct, itemisationLineCount != null && itemisationLineCount > 0);
  const fillPct = Math.max(0, Math.min(100, itemisationPct ?? 0));
  const dotColor = isOverdue ? 'var(--danger)' : 'var(--gold)';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        ROW_GRID,
        'cursor-pointer border-b border-border-subtle px-5 py-4 transition-colors last:border-b-0',
        'hover:bg-[var(--paper-2)]',
        isOverdue && 'bg-[oklch(0.99_0.012_30/0.5)]',
        className,
      )}
    >
      {/* 1. Project · PM · Director */}
      <div className="min-w-0">
        <div className="font-display text-[15px] font-medium leading-tight tracking-[-0.005em] text-foreground">
          {projectName}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {pmName ? <>PM {pmName}</> : projectMeta || '—'}
          {pmName && projectMeta && <> · {projectMeta}</>}
        </div>
        {directorTag && (
          <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
            <span aria-hidden className="size-[5px] rounded-full" style={{ background: dotColor }} />
            <span>Director · {directorTag}</span>
          </div>
        )}
      </div>

      {/* 2. Drawn */}
      <div className="text-right">
        <div className="font-mono text-base font-medium tabular-nums text-foreground">
          <span className="mr-1 text-[11px] text-muted-foreground">KES</span>
          {drawn.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Standing {formatCompactKES(standingTotal).replace('KES ', '')}
          {topUpsCount > 0 && (
            <> · {topUpsCount} top-up{topUpsCount === 1 ? '' : 's'} {formatCompactKES(topUpsTotal).replace('KES ', '')}</>
          )}
        </div>
      </div>

      {/* 3. Itemised vs drawn */}
      <div>
        <div className="relative h-[22px] overflow-hidden rounded-sm bg-[var(--paper-3)]">
          <div
            className={cn(
              'absolute inset-y-0 left-0 flex items-center justify-end pr-2 font-mono text-[10.5px] font-semibold',
              FILL_TONE[tone],
            )}
            style={{ width: `${Math.max(fillPct, tone === 'bad' && fillPct === 0 ? 8 : 0)}%` }}
          >
            {fillPct > 0 ? `${Math.round(fillPct)}%` : '0%'}
          </div>
          {/* 80% target line */}
          <div
            aria-hidden
            className="absolute -top-0.5 -bottom-0.5 w-px bg-[var(--ink)]"
            style={{ left: '80%' }}
          />
        </div>
        <div className={cn(
          'mt-1.5 font-mono text-[10.5px]',
          tone === 'bad' || (tone === 'short' && fillPct < 80)
            ? 'text-[var(--danger)]'
            : 'text-muted-foreground',
        )}>
          {tone === 'bad' && fillPct === 0
            ? (itemisationLineCount === 0 ? 'No report created · overdue' : 'Draft started · 0 of N draws itemised')
            : tone === 'short'
              ? 'Below 80% floor · variance note required'
              : itemisationLineCount && itemisationItemisedKes != null
                ? `${itemisationLineCount} line item${itemisationLineCount === 1 ? '' : 's'} · ${formatCurrency(itemisationItemisedKes, 'KES')} itemised`
                : '—'}
        </div>
      </div>

      {/* 4. Variance */}
      <VarianceCell variance={variance} state={varianceState} />

      {/* 5. Last activity */}
      <div className="text-right font-mono text-[12px] text-muted-foreground">
        {lastActivityDate ? (
          <>
            {lastActivityDate}
            <br />
            <span className="text-[10.5px]">{lastActivityLabel || '—'}</span>
          </>
        ) : (
          '—'
        )}
      </div>

      {/* 6. Cadence */}
      <div>
        <span className="inline-flex rounded-full bg-[var(--paper-3)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--warm-grey-3)]">
          {monthlyAllocation > 0
            ? `Standing · ${formatCompactKES(monthlyAllocation).replace('KES ', '')}/mo`
            : 'No standing'}
        </span>
        <div className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
          {topUpsCount} top-up{topUpsCount === 1 ? '' : 's'} used
        </div>
      </div>

      {/* 7. Report status */}
      <div>
        <MiscStatusPill kind={status} count={statusCount} />
        {statusSubtext && (
          <div className="mt-1.5 font-mono text-[10px] text-[var(--danger)]">{statusSubtext}</div>
        )}
      </div>

      {/* 8. Row actions */}
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="More"
          className="rounded p-1 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>
    </div>
  );
}
