import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/utils/currency';
import { UtilisationBar } from './utilisation-bar';

/**
 * Variance hero panel matching _design-system/budget-detail.html.
 *
 * Three flat cells (Approved / Spent / Variance) with a large bullet bar
 * below carrying a vertical period-elapsed marker. Footer renders the
 * period range under the bar.
 *
 * Variance cell tone:
 *   variance > 0 → danger
 *   variance < 0 → success-soft
 *   variance === 0 → muted
 */

type VarianceHeroProps = {
  approvedKes: number;
  spentKes: number;
  /** YYYY-MM */
  yearMonth: string;
  daysElapsed: number;
  daysInMonth: number;
  className?: string;
};

const NAIROBI_TZ = 'Africa/Nairobi';

function dateLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
}

function formatKesInteger(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return (
    sign +
    'KES ' +
    new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.abs(amount))
  );
}

export function VarianceHero({
  approvedKes,
  spentKes,
  yearMonth,
  daysElapsed,
  daysInMonth,
  className,
}: VarianceHeroProps) {
  const variance = spentKes - approvedKes;
  const utilisationPct =
    approvedKes > 0 ? (spentKes / approvedKes) * 100 : 0;
  const periodElapsedPct =
    daysInMonth > 0 ? Math.max(0, Math.min(100, (daysElapsed / daysInMonth) * 100)) : 0;
  const burnPerDay = daysElapsed > 0 ? spentKes / daysElapsed : 0;

  const [yStr, mStr] = yearMonth.split('-');
  const y = Number.parseInt(yStr ?? '', 10);
  const m = Number.parseInt(mStr ?? '', 10);
  const periodStart = Number.isFinite(y) && Number.isFinite(m)
    ? new Date(y, m - 1, 1)
    : null;
  const periodEnd = Number.isFinite(y) && Number.isFinite(m)
    ? new Date(y, m - 1, daysInMonth)
    : null;
  const todayLabel = periodStart
    ? dateLabel(new Date(periodStart.getTime() + Math.min(daysElapsed, daysInMonth) * 86_400_000))
    : '—';

  let varianceTone: 'danger' | 'success' | 'muted' = 'muted';
  if (variance > 0) varianceTone = 'danger';
  else if (variance < 0) varianceTone = 'success';

  const varianceClass =
    varianceTone === 'danger'
      ? 'text-[var(--danger)]'
      : varianceTone === 'success'
        ? 'text-[var(--success-soft-foreground)]'
        : 'text-muted-foreground';

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card px-6 py-5',
        className,
      )}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Cell
          label="Approved budget"
          value={formatKES(approvedKes).replace(/\.00$/, '')}
          sub={`Period · ${daysInMonth} day window`}
        />
        <Cell
          label={`Spent · ${daysElapsed} of ${daysInMonth} days`}
          value={formatKES(spentKes).replace(/\.00$/, '')}
          sub={`Burn rate ${formatKesInteger(Math.round(burnPerDay))} / day`}
        />
        <Cell
          label="Variance"
          value={
            <span className={varianceClass}>
              {variance >= 0 ? '+ ' : '− '}
              {formatKES(Math.abs(variance)).replace(/\.00$/, '')}
            </span>
          }
          sub={`${utilisationPct.toFixed(0)}% utilised · ${periodElapsedPct.toFixed(0)}% of period elapsed`}
        />
      </div>

      <div className="mt-6">
        <UtilisationBar
          approvedKes={approvedKes}
          spentKes={spentKes}
          periodElapsedPct={periodElapsedPct}
          size="large"
          showCaption={false}
        />
        <div className="mt-3 flex items-baseline justify-between font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Period start · {periodStart ? dateLabel(periodStart) : '—'}</span>
          <span>
            Today · {todayLabel} ({periodElapsedPct.toFixed(0)}%)
          </span>
          <span>Period end · {periodEnd ? dateLabel(periodEnd) : '—'}</span>
        </div>
      </div>
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
}) {
  return (
    <div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 font-mono text-[26px] font-medium leading-none tabular-nums tracking-[-0.01em] text-foreground">
        {value}
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}
