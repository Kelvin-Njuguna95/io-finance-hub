import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

/**
 * Bullet-progress utilisation bar matching _design-system/budgets.html.
 *
 * Tone derivation:
 *   spentKes === 0                                    → not-started (muted)
 *   spent / approved > 1                              → over (danger)
 *   spent / approved < 0.5 && periodElapsedPct > 50   → under (success)
 *   else                                              → default (gold)
 */

type Tone = 'default' | 'over' | 'under' | 'not-started';

type UtilisationBarProps = {
  approvedKes: number;
  spentKes: number;
  /** 0..100. When provided, enables the "under plan" tone. */
  periodElapsedPct?: number;
  /** Compact = small (in-row). Larger = more breathing room. Default true. */
  compact?: boolean;
  className?: string;
};

const TONE_BAR: Record<Tone, string> = {
  default: 'bg-[var(--gold)]',
  over: 'bg-[var(--danger)]',
  under: 'bg-[var(--success)]',
  'not-started': 'bg-[var(--paper-3)]',
};

const TONE_NUM: Record<Tone, string> = {
  default: 'text-foreground',
  over: 'text-[var(--danger)]',
  under: 'text-[var(--success-soft-foreground)]',
  'not-started': 'text-muted-foreground',
};

const LABEL: Record<Tone, string> = {
  default: 'on plan',
  over: 'over plan',
  under: 'under plan',
  'not-started': 'not started',
};

function deriveTone(approved: number, spent: number, periodPct: number): Tone {
  if (spent <= 0) return 'not-started';
  if (approved <= 0) return 'default';
  const ratio = spent / approved;
  if (ratio > 1) return 'over';
  if (ratio < 0.5 && periodPct > 50) return 'under';
  return 'default';
}

export function UtilisationBar({
  approvedKes,
  spentKes,
  periodElapsedPct = 0,
  compact = true,
  className,
}: UtilisationBarProps) {
  const tone = deriveTone(approvedKes, spentKes, periodElapsedPct);
  const ratioPct =
    approvedKes > 0 ? Math.min(100, (spentKes / approvedKes) * 100) : 0;
  const labelPct = approvedKes > 0 ? Math.round((spentKes / approvedKes) * 100) : 0;

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          'overflow-hidden rounded-full bg-[var(--paper-3)]',
          compact ? 'h-1.5' : 'h-2.5',
        )}
      >
        <div
          className={cn('h-full rounded-full', TONE_BAR[tone])}
          style={{ width: `${ratioPct}%` }}
        />
      </div>
      <div
        className={cn(
          'mt-1.5 flex items-baseline justify-between font-mono uppercase tracking-[0.10em] text-muted-foreground',
          compact ? 'text-[10.5px]' : 'text-xs',
        )}
      >
        <span>{LABEL[tone]}</span>
        <span className={cn('tabular-nums', TONE_NUM[tone])}>
          {tone === 'not-started'
            ? '0%'
            : `${labelPct}% · ${formatCompactKES(spentKes).replace('KES ', '')}`}
        </span>
      </div>
    </div>
  );
}
