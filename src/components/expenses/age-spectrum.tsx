'use client';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { AgeBand } from '@/hooks/use-expense-queue';

/**
 * Section 4 — queue ageing histogram. Four bands ( <24h / 1-2d / 2-3d
 * / 3d+ ) sized roughly proportionally to count, so "fresh" is widest
 * when the queue is healthy and "danger" stays visually small unless
 * stuff really is sliding.
 */

type AgeSpectrumProps = {
  bands: AgeBand[];
  totalCount: number;
  className?: string;
};

const TONE_BORDER: Record<AgeBand['tone'], string> = {
  cool: 'border-[var(--success-soft)]',
  warm: 'border-[var(--gold)]',
  danger: 'border-[var(--danger-soft)]',
};

const TONE_BG: Record<AgeBand['tone'], string> = {
  cool: 'bg-[var(--paper-2)]',
  warm: 'bg-[var(--gold-soft)]',
  danger: 'bg-danger-soft',
};

const TONE_AGE: Record<AgeBand['tone'], string> = {
  cool: 'text-muted-foreground',
  warm: 'text-[oklch(0.40_0.10_75)]',
  danger: 'text-[var(--danger)]',
};

const TONE_COUNT: Record<AgeBand['tone'], string> = {
  cool: 'text-foreground',
  warm: 'text-foreground',
  danger: 'text-[var(--danger)]',
};

function flexFor(count: number, totalCount: number): number {
  // Floor to keep tiny bands visible; total proportional otherwise.
  const minFlex = 1;
  if (totalCount <= 0) return minFlex;
  const proportion = count / totalCount;
  return Math.max(minFlex, Math.round(proportion * 12));
}

export function AgeSpectrum({
  bands,
  totalCount,
  className,
}: AgeSpectrumProps) {
  const overSlaCount = bands
    .filter((b) => b.tone === 'warm' || b.tone === 'danger')
    .reduce((s, b) => s + b.count, 0);
  const totalGridFlex = bands.reduce(
    (s, b) => s + flexFor(b.count, totalCount),
    0,
  );

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card px-6 py-4',
        'grid items-center gap-6',
        'grid-cols-1 md:grid-cols-[200px_1fr]',
        className,
      )}
    >
      <div>
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Queue ageing
        </p>
        <p className="mt-1.5 font-display text-[16px] font-medium leading-tight text-foreground">
          {totalCount === 0
            ? 'Queue clear'
            : `${totalCount} expense${totalCount === 1 ? '' : 's'}`}
          {overSlaCount > 0 && (
            <>
              {' · '}
              <em className="not-italic italic text-[var(--gold-lo)]">
                {overSlaCount} over 48h SLA
              </em>
            </>
          )}
        </p>
      </div>

      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: bands
            .map((b) => `${flexFor(b.count, totalCount)}fr`)
            .join(' '),
        }}
      >
        {bands.map((band) => (
          <div
            key={band.key}
            className={cn(
              'flex flex-col gap-1 rounded-[var(--radius)] border px-3.5 py-3',
              TONE_BORDER[band.tone],
              TONE_BG[band.tone],
            )}
          >
            <span
              className={cn(
                'font-mono text-[10px] font-medium uppercase tracking-[0.14em]',
                TONE_AGE[band.tone],
              )}
            >
              {band.label}
            </span>
            <span
              className={cn(
                'font-mono text-[18px] font-medium leading-none tabular-nums',
                TONE_COUNT[band.tone],
              )}
            >
              {band.count}
              <span className="ml-1.5 text-[10.5px] font-normal text-muted-foreground">
                {band.tone === 'danger'
                  ? band.count === 1
                    ? 'over SLA'
                    : 'over SLA'
                  : band.count === 1
                    ? 'expense'
                    : 'expenses'}
              </span>
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--warm-grey-3)]">
              {formatCompactKES(band.totalKes)}
            </span>
          </div>
        ))}
        {/* Suppress unused warning when grid template is computed inline. */}
        <span aria-hidden hidden>{totalGridFlex}</span>
      </div>
    </section>
  );
}
