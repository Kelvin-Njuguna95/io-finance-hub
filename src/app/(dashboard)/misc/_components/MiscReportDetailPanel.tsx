import { cn } from '@/lib/utils';
import { formatCompactKES, formatCurrency } from '@/lib/format';

import { MiscStatusPill, type MiscStatusKind } from './MiscStatusPill';

export type DetailDraw = {
  id: string;
  draw_type?: string | null;
  amount_approved?: number | string | null;
  expense_id?: string | null;
  cfo_flagged?: boolean | null;
  purpose?: string | null;
  created_at?: string | null;
};

export type DetailItem = {
  id: string;
  description: string;
  amount: number | string;
  expense_date: string;
  draw_id?: string | null;
};

type DayBucket = {
  dayKey: string;
  dayLabel: string;
  dayTotal: number;
  drawCount: number;
  topUpRefs: string[];
  items: DetailItem[];
};

type MiscReportDetailPanelProps = {
  projectName: string;
  monthLabel: string;
  status: MiscStatusKind;
  statusCount?: number;
  statusSubtext?: string;

  totalDrawn: number;
  totalItemised: number;
  variance: number;
  itemisationPct: number;

  submittedByLabel?: string;
  reviewedByLabel?: string;

  draws: ReadonlyArray<DetailDraw>;
  items: ReadonlyArray<DetailItem>;

  /** Renders inline below the day-grouped lines (e.g. Flag / Send back / Approve). */
  actionBar?: React.ReactNode;
  /** Right-aligned status footnote text inside the action bar. */
  actionFootnote?: string;

  className?: string;
};

function formatDayKey(date: string): { key: string; label: string } {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return { key: date, label: date };
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const label = new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
    weekday: 'short',
  })
    .format(d)
    .toUpperCase();
  return { key, label };
}

function bucketByDay(items: ReadonlyArray<DetailItem>): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const item of items) {
    const { key, label } = formatDayKey(item.expense_date);
    const bucket =
      map.get(key) ??
      { dayKey: key, dayLabel: label, dayTotal: 0, drawCount: 0, topUpRefs: [], items: [] };
    bucket.items.push(item);
    bucket.dayTotal += Number(item.amount || 0);
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

export function MiscReportDetailPanel({
  projectName,
  monthLabel,
  status,
  statusCount,
  statusSubtext,
  totalDrawn,
  totalItemised,
  variance,
  itemisationPct,
  submittedByLabel,
  reviewedByLabel,
  draws,
  items,
  actionBar,
  actionFootnote,
  className,
}: MiscReportDetailPanelProps) {
  const buckets = bucketByDay(items);

  // Map draw_id → top-up index (for tagging line items linked to top-ups).
  const topUpIndex = new Map<string, number>();
  let n = 0;
  for (const d of draws) {
    if (d.draw_type === 'top_up') {
      n += 1;
      topUpIndex.set(d.id, n);
    }
  }

  const itemisationCapped = Math.max(0, Math.min(100, Math.round(itemisationPct)));
  const varianceTone =
    Math.abs(variance) < 1
      ? 'text-success-soft-foreground'
      : 'text-danger-soft-foreground';

  return (
    <section className={cn('flex flex-col gap-5', className)}>
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[22px] font-medium leading-tight tracking-[-0.005em] text-foreground">
            {projectName}{' '}
            <span aria-hidden className="text-muted-foreground/60">·</span>{' '}
            <em className="font-normal italic" style={{ color: 'var(--gold-lo)' }}>
              {monthLabel} misc report
            </em>
          </h2>
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {submittedByLabel && <span>Submitted · {submittedByLabel}</span>}
            {reviewedByLabel && <span>Reviewed · {reviewedByLabel}</span>}
          </div>
        </div>
        <MiscStatusPill kind={status} count={statusCount} subtext={statusSubtext} />
      </header>

      {/* 4-stat band */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
        <Stat label="Total drawn" value={formatCompactKES(totalDrawn)} />
        <Stat label="Total itemised" value={formatCompactKES(totalItemised)} />
        <Stat
          label="Variance · Unaccounted"
          value={<span className={varianceTone}>{formatCompactKES(variance)}</span>}
        />
        <Stat
          label="Itemisation"
          value={
            <span className={itemisationCapped >= 100 ? 'text-success-soft-foreground' : ''}>
              {itemisationCapped}%
            </span>
          }
          progress={itemisationCapped}
        />
      </div>

      {/* Day-grouped items */}
      <div className="space-y-4">
        {buckets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No itemised lines for this report.</p>
        ) : (
          buckets.map((b) => (
            <div key={b.dayKey} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border-subtle pb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <span>
                  <span className="text-foreground">{b.dayLabel}</span>{' '}
                  <span aria-hidden>·</span>{' '}
                  <span className="text-foreground">{formatCompactKES(b.dayTotal)}</span>
                </span>
                <span>
                  {b.items.length} item{b.items.length === 1 ? '' : 's'}
                </span>
              </div>
              <ul className="divide-y divide-border-subtle">
                {b.items.map((item) => {
                  const linkedTopUp = item.draw_id ? topUpIndex.get(item.draw_id) : undefined;
                  return (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {item.description}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-foreground">
                        {formatCurrency(Number(item.amount), 'KES')}
                      </span>
                      {linkedTopUp ? (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/70">
                          Top-up #{linkedTopUp}
                        </span>
                      ) : item.draw_id ? (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/70">
                          Standing
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full bg-danger-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-danger-soft-foreground">
                          Unlinked
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Action bar */}
      {(actionBar || actionFootnote) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">{actionBar}</div>
          {actionFootnote && (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {actionFootnote}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  progress,
}: {
  label: string;
  value: React.ReactNode;
  progress?: number;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl tabular-nums">{value}</div>
      {typeof progress === 'number' && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/70"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
