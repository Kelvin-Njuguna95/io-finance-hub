import * as React from 'react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Inverted KPI card — ink background, gold eyebrow, paper text.
 * Mirrors `.strip .stat.headline` from _design-system/variance.html.
 *
 * Used as the leading card of the variance dashboard's KPI strip.
 * Same outer geometry as `StatCard` so the strip aligns when this card
 * sits beside vanilla cards.
 */

export type HeadlineStatTone = 'bad' | 'good' | 'neutral';

type HeadlineStatCardProps = {
  eyebrow: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: HeadlineStatTone;
  loading?: boolean;
  className?: string;
};

const TONE_VALUE: Record<HeadlineStatTone, string> = {
  bad: 'text-[var(--danger-soft)]',
  good: 'text-[var(--success-soft)]',
  neutral: 'text-background',
};

export function HeadlineStatCard({
  eyebrow,
  value,
  sub,
  tone = 'neutral',
  loading,
  className,
}: HeadlineStatCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border border-foreground bg-foreground p-4',
          className,
        )}
      >
        <div className="space-y-2">
          <Skeleton className="h-3 w-32 bg-background/15" />
          <Skeleton className="h-8 w-40 bg-background/15" />
          <Skeleton className="h-3 w-48 bg-background/15" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-foreground bg-foreground p-4',
        className,
      )}
    >
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--gold)]">
          {eyebrow}
        </p>
        <p
          className={cn(
            'font-mono text-[2rem] font-semibold leading-none tracking-tight tabular-nums',
            TONE_VALUE[tone],
          )}
        >
          {value}
        </p>
        {sub && (
          <p className="pt-0.5 text-[11px] text-background/65">{sub}</p>
        )}
      </div>
    </div>
  );
}
