import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Editorial page title — Fraunces serif primary phrase with an optional
 * italic gold accent phrase, separated by a middle-dot. Mirrors the
 * treatment used across _design-system/*.html mockups.
 *
 * The accent phrase is caller-chosen and meaningful (e.g. "7 pending
 * review" rather than marketing flourishes). Subtitle, meta, and action
 * slots compose underneath / alongside.
 */
export type PageTitleProps = {
  primary: string;
  accent?: string;
  subtitle?: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function PageTitle({
  primary,
  accent,
  subtitle,
  meta,
  action,
  className,
}: PageTitleProps) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-6 gap-y-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <h1
          className="font-display text-[28px] font-normal leading-[1.1] tracking-[-0.01em] text-foreground"
          style={{ fontVariationSettings: '"opsz" 72' }}
        >
          {primary}
          {accent && (
            <>
              <span
                aria-hidden
                className="mx-2 text-muted-foreground/70"
              >
                ·
              </span>
              <em
                className="font-normal italic"
                style={{ color: 'var(--gold-lo)' }}
              >
                {accent}
              </em>
            </>
          )}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
