import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Executive-grade hero panel for dashboards. Layered navy surface with a
 * gradient accent, a branded eyebrow, five (or fewer) stat tiles with
 * tinted icon tiles, and an optional right-side actions slot.
 *
 * All color comes from `hero-surface` in globals.css + inline tokens so
 * dark mode just works.
 */

export type HeroStatTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'
  | 'teal'
  | 'accent';

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
  accent:
    'bg-[oklch(0.85_0.17_88_/_0.18)] text-[oklch(0.95_0.14_88)] ring-1 ring-inset ring-[oklch(0.85_0.17_88_/_0.28)]',
  success:
    'bg-[oklch(0.70_0.16_158_/_0.18)] text-[oklch(0.90_0.14_158)] ring-1 ring-inset ring-[oklch(0.70_0.16_158_/_0.28)]',
  warning:
    'bg-[oklch(0.82_0.16_78_/_0.18)] text-[oklch(0.95_0.14_80)] ring-1 ring-inset ring-[oklch(0.82_0.16_78_/_0.28)]',
  danger:
    'bg-[oklch(0.70_0.19_25_/_0.20)] text-[oklch(0.92_0.16_25)] ring-1 ring-inset ring-[oklch(0.70_0.19_25_/_0.30)]',
  info:
    'bg-[oklch(0.72_0.14_240_/_0.20)] text-[oklch(0.92_0.12_240)] ring-1 ring-inset ring-[oklch(0.72_0.14_240_/_0.30)]',
  violet:
    'bg-[oklch(0.72_0.18_290_/_0.20)] text-[oklch(0.92_0.15_290)] ring-1 ring-inset ring-[oklch(0.72_0.18_290_/_0.30)]',
  teal:
    'bg-[oklch(0.75_0.11_195_/_0.20)] text-[oklch(0.92_0.11_195)] ring-1 ring-inset ring-[oklch(0.75_0.11_195_/_0.30)]',
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white md:text-[1.65rem]">
            {title}
          </h1>
          <p className="mt-1 text-sm text-white/55">{today}</p>
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
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-white/55">
                      {stat.label}
                    </p>
                    <p className="text-[1.25rem] font-semibold leading-none tracking-tight text-white tabular-nums">
                      {stat.value}
                    </p>
                    {stat.subtitle && (
                      <p className="text-[11px] text-white/55">
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
