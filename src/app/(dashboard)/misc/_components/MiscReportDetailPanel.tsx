// Visual spec: _design-system/Misc Draws and Reports.html (.drill block)
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';

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
  items: DetailItem[];
  topUpRefs: number[];
  unlinkedCount: number;
};

type MiscReportDetailPanelProps = {
  projectName: string;
  monthLabel: string;
  status: MiscStatusKind;
  statusCount?: number;
  inlineStatusDate?: string;

  totalDrawn: number;
  totalItemised: number;
  variance: number;
  itemisationPct: number;

  submittedByLabel?: string;
  reviewedByLabel?: string;

  draws: ReadonlyArray<DetailDraw>;
  items: ReadonlyArray<DetailItem>;

  /** Renders inline at the action-bar buttons row. */
  actionBar?: React.ReactNode;
  /** Right-aligned mono uppercase footnote inside the action bar. */
  actionFootnote?: string;

  className?: string;
};

function formatDayKey(date: string): { key: string; label: string; short: string } {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return { key: date, label: date, short: date };
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  // "Mar 28 · Mon" — match mockup .day-sep label
  const label = (() => {
    const m = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      month: 'short',
      day: '2-digit',
    }).format(d);
    const wd = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      weekday: 'short',
    }).format(d);
    return `${m} · ${wd}`;
  })();
  // "28 Mar" for the per-row date column
  const short = new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
  }).format(d);
  return { key, label, short };
}

const ITEM_GRID = 'grid grid-cols-[90px_1fr_130px_120px_50px] items-center gap-3.5 px-5 py-3';

export function MiscReportDetailPanel({
  projectName,
  monthLabel,
  status,
  statusCount,
  inlineStatusDate,
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
  // Map draw_id → top-up index
  const topUpIndex = new Map<string, number>();
  let n = 0;
  for (const d of draws) {
    if (d.draw_type === 'top_up') {
      n += 1;
      topUpIndex.set(d.id, n);
    }
  }

  // Bucket items by day, track linked top-up refs and unlinked count
  const buckets: DayBucket[] = (() => {
    const map = new Map<string, DayBucket>();
    for (const item of items) {
      const { key, label } = formatDayKey(item.expense_date);
      const bucket =
        map.get(key) ?? {
          dayKey: key,
          dayLabel: label,
          dayTotal: 0,
          items: [] as DetailItem[],
          topUpRefs: [] as number[],
          unlinkedCount: 0,
        };
      bucket.items.push(item);
      bucket.dayTotal += Number(item.amount || 0);
      const idx = item.draw_id ? topUpIndex.get(item.draw_id) : undefined;
      if (idx && !bucket.topUpRefs.includes(idx)) bucket.topUpRefs.push(idx);
      if (!item.draw_id) bucket.unlinkedCount += 1;
      map.set(key, bucket);
    }
    return Array.from(map.values()).sort((a, b) => b.dayKey.localeCompare(a.dayKey));
  })();

  const itemisationCapped = Math.max(0, Math.min(100, Math.round(itemisationPct)));
  const itemisationTone =
    itemisationCapped >= 95
      ? 'text-success-soft-foreground'
      : itemisationCapped < 80
        ? 'text-[var(--danger)]'
        : 'text-foreground';
  const varianceTone =
    Math.abs(variance) < 1
      ? 'text-success-soft-foreground'
      : variance > 0
        ? 'text-[var(--danger)]'
        : 'text-foreground';

  const totalEntries = items.length;

  return (
    <section className={cn('flex flex-col gap-3.5', className)}>
      {/* Inline header: title + pill on the same baseline */}
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
        <h3
          className="font-display text-[18px] font-medium leading-tight tracking-[-0.005em] text-foreground"
          style={{ fontVariationSettings: '"opsz" 72' }}
        >
          {projectName}
          <span aria-hidden className="mx-1 text-muted-foreground/70">·</span>
          <em className="font-normal italic">{monthLabel} misc report</em>
        </h3>
        <MiscStatusPill kind={status} count={statusCount} inlineDate={inlineStatusDate} />
      </header>

      {/* paper-2 inset meta-grid: 2 cols × 3 rows */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] px-[18px] py-4">
        <MetaCell label="Total drawn" value={formatCurrency(totalDrawn, 'KES')} />
        <MetaCell label="Total itemised" value={formatCurrency(totalItemised, 'KES')} />
        <MetaCell
          label="Variance · unaccounted"
          value={formatCurrency(Math.abs(variance), 'KES')}
          tone={varianceTone}
        />
        <MetaCell
          label="Itemisation"
          value={`${itemisationCapped.toFixed(1)}%`}
          tone={itemisationTone}
        />
        <MetaCell
          label="Submitted by"
          value={submittedByLabel || '—'}
          smallValue
        />
        <MetaCell
          label="Reviewed by"
          value={reviewedByLabel || '—'}
          smallValue
        />
      </dl>

      {/* Day-grouped items frame */}
      <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
        {buckets.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No itemised lines for this report.
          </p>
        ) : (
          <>
            {buckets.map((b) => (
              <div key={b.dayKey}>
                {/* .day-sep */}
                <div className="flex items-baseline gap-4 border-b border-border-subtle bg-[var(--paper-2)] px-5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  <span>{b.dayLabel}</span>
                  <span aria-hidden>—</span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(b.dayTotal, 'KES')}
                  </span>
                  <span className="ml-auto">
                    {b.items.length} item{b.items.length === 1 ? '' : 's'}
                    {b.topUpRefs.length === 1 && b.unlinkedCount === 0 && (
                      <> · linked to Top-up #{b.topUpRefs[0]}</>
                    )}
                    {b.unlinkedCount > 0 && (
                      <> · {b.unlinkedCount} unlinked</>
                    )}
                  </span>
                </div>
                {b.items.map((item) => {
                  const linkedTopUp = item.draw_id ? topUpIndex.get(item.draw_id) : undefined;
                  const tagKind = !item.draw_id
                    ? 'unlinked'
                    : linkedTopUp
                      ? 'topup'
                      : 'standing';
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        ITEM_GRID,
                        'border-b border-border-subtle text-[13px] last:border-b-0',
                      )}
                    >
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {formatDayKey(item.expense_date).short}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-foreground">{item.description}</div>
                      </div>
                      <span className="text-right font-mono tabular-nums text-foreground">
                        {formatCurrency(Number(item.amount), 'KES')}
                      </span>
                      <span>
                        <DrawTag
                          kind={tagKind}
                          label={
                            tagKind === 'unlinked'
                              ? 'Unlinked'
                              : tagKind === 'topup'
                                ? `Top-up #${linkedTopUp}`
                                : 'Standing'
                          }
                        />
                      </span>
                      <span />
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Total row */}
            <div className={cn(ITEM_GRID, 'bg-[var(--paper-2)] py-3.5 font-mono')}>
              <span />
              <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Total itemised · {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'}
              </span>
              <span className="text-right text-[14px] font-medium tabular-nums text-foreground">
                {formatCurrency(totalItemised, 'KES')}
              </span>
              <span />
              <span />
            </div>
          </>
        )}
      </div>

      {/* Action bar */}
      {(actionBar || actionFootnote) && (
        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          {actionBar}
          <span className="ml-auto" />
          {actionFootnote && (
            <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
              {actionFootnote}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function MetaCell({
  label,
  value,
  tone,
  smallValue,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  smallValue?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono font-medium tabular-nums',
          smallValue ? 'text-[12px]' : 'text-[14px]',
          tone || 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DrawTag({
  kind,
  label,
}: {
  kind: 'standing' | 'topup' | 'unlinked';
  label: string;
}) {
  const tone =
    kind === 'unlinked'
      ? 'bg-[oklch(0.94_0.06_25)] text-[var(--danger)]'
      : kind === 'topup'
        ? 'bg-[var(--gold-soft)] text-[oklch(0.42_0.10_75)]'
        : 'bg-[var(--paper-3)] text-[var(--ink)]';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]',
        tone,
      )}
    >
      {label}
    </span>
  );
}
