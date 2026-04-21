import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Executive-grade hero panel for dashboards. Navy surface with a subtle
 * navy-tint radial accent (see .hero-surface in globals.css), branded
 * eyebrow, up to five stat tiles, and an optional right-side actions
 * slot.
 *
 * Palette: 5 tones. Brand is the neutral default ("normal is silent"
 * per .impeccable.md). Success/warning/danger/info are semantic
 * anchors reserved for legitimate state signals — not aesthetic variety.
 * Gold (accent), electric-blue, violet, and teal were removed per the
 * chart-only rule; any non-chart UI occurrence was a brand violation.
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
    'bg-white/10 text-white ring-1 ring-inset ring-white/15',
  success:
    'bg-[oklch(0.70_0.16_158_/_0.18)] text-[oklch(0.90_0.14_158)] ring-1 ring-inset ring-[oklch(0.70_0.16_158_/_0.28)]',
  warning:
    'bg-[oklch(0.82_0.16_78_/_0.18)] text-[oklch(0.95_0.14_80)] ring-1 ring-inset ring-[oklch(0.82_0.16_78_/_0.28)]',
  danger:
    'bg-[oklch(0.70_0.19_25_/_0.20)] text-[oklch(0.92_0.16_25)] ring-1 ring-inset ring-[oklch(0.70_0.19_25_/_0.30)]',
  info:
    'bg-[oklch(0.72_0.14_240_/_0.20)] text-[oklch(0.92_0.12_240)] ring-1 ring-inset ring-[oklch(0.72_0.14_240_/_0.30)]',
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-[20px] font-semibold tracking-tight text-white md:text-[22px]">
            {title}
          </h1>
          <p className="mt-1.5 text-[13px] text-white/65">{today}</p>
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
                  'group/hero-stat relative overflow-hidden rounded-xl p-4',
                  'bg-white/[0.04] ring-1 ring-inset ring-white/10 backdrop-blur-[2px]',
                  'transition-all duration-[var(--dur-base)] ease-[cubic-bezier(0.2,0,0,1)]',
                  'hover:bg-white/[0.07] hover:ring-white/15',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65">
                      {stat.label}
                    </p>
                    <p className="text-[1.5rem] font-semibold leading-none tracking-tight text-white tabular-nums md:text-[1.625rem]">
                      {stat.value}
                    </p>
                    {stat.subtitle && (
                      <p className="text-[11px] text-white/60">
                        {stat.subtitle}
                      </p>
                    )}
                  </div>
                  {Icon && (
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl',
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
