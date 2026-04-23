import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Executive-grade hero panel for dashboards. Hero surface is ink with
 * gold-tinted radial accents — see globals.css .hero-surface and
 * _design-system/ui_kits/finance-hub/kit.css:117-125.
 *
 * Palette: 5 tones. Brand tile uses gold-soft + gold-lo per kit.css:110.
 * Success/warning/danger/info tiles follow the bg-*-soft +
 * text-*-soft-foreground + ring pattern used in stat-card.tsx.
 */

export type HeroStatTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type HeroStat = {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: HeroStatTone;
};

type HeroCardProps = {
  stats?: HeroStat[];
  /** Optional right-aligned actions (buttons). Rendered in the header. */
  actions?: React.ReactNode;
  /** Override the title. Defaults to "Finance Hub". */
  title?: string;
  /** Override the eyebrow. Defaults to "Impact Outsourcing". */
  eyebrow?: string;
  /** Additional content rendered below the stat grid. */
  children?: React.ReactNode;
  className?: string;
};

const TILE_TONES: Record<HeroStatTone, string> = {
  brand:
    'bg-gold-soft text-gold-lo ring-1 ring-inset ring-gold/30',
  success:
    'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
  warning:
    'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/35',
  danger:
    'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/25',
  info:
    'bg-info-soft text-info-soft-foreground ring-1 ring-inset ring-info/25',
};

export function HeroCard({
  stats,
  actions,
  title = 'Finance Hub',
  eyebrow = 'Impact Outsourcing',
  children,
  className,
}: HeroCardProps) {
  const today = new Intl.DateTimeFormat('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  }).format(new Date());

  const count = stats?.length ?? 0;
  const gridCols =
    count <= 3
      ? 'sm:grid-cols-3'
      : count === 4
        ? 'sm:grid-cols-2 lg:grid-cols-4'
        : 'sm:grid-cols-2 lg:grid-cols-5';

  return (
    <section
      className={cn('hero-surface p-6 md:p-7', className)}
      aria-label={title}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-paper/65">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-paper md:text-[22px]">
            {title}
          </h1>
          <p className="mt-1.5 text-[13px] text-paper/65">{today}</p>
        </div>
        {actions && (
          <div className="flex items-center gap-2">{actions}</div>
        )}
      </div>

      {/* Stat tiles */}
      {stats && stats.length > 0 && (
        <div className={cn('mt-6 grid grid-cols-1 gap-3', gridCols)}>
          {stats.map((stat, i) => {
            const Icon = stat.icon;
            const tone = stat.tone ?? 'brand';
            return (
              <div
                key={i}
                className={cn(
                  'group/hero-stat relative overflow-hidden rounded-[var(--radius-lg)] p-4',
                  'bg-paper/[0.04] ring-1 ring-inset ring-paper/10 backdrop-blur-[2px]',
                  'transition-all duration-[var(--dur-base)] ease-[cubic-bezier(0.2,0,0,1)]',
                  'hover:bg-paper/[0.07] hover:ring-paper/15',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-paper/65">
                      {stat.label}
                    </p>
                    <p className="text-[1.5rem] font-semibold leading-none tracking-tight text-paper tabular-nums md:text-[1.625rem]">
                      {stat.value}
                    </p>
                    {stat.subtitle && (
                      <p className="text-[11px] text-paper/60">
                        {stat.subtitle}
                      </p>
                    )}
                  </div>
                  {Icon && (
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)]',
                        TILE_TONES[tone],
                      )}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.75} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {children}
    </section>
  );
}
