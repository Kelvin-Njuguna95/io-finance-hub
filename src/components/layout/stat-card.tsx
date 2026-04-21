import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Finance Hub KPI card.
 *
 * Variants communicate domain semantics through a tinted icon tile and
 * subtle hover motion. All color comes from design tokens so dark mode
 * and future palette changes are free.
 *
 * Usage:
 *   <StatCard
 *     title="Revenue"
 *     value="KES 12.4M"
 *     subtitle="From Jun invoices"
 *     icon={DollarSign}
 *     tone="brand"
 *     trend={{ value: "4.2%", direction: "up" }}
 *   />
 */

export type StatCardTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Full trend shape.
 * `positive` is inferred from `direction` but can be overridden — e.g. a
 * -5% expense is actually a *positive* signal.
 */
type StatCardTrendFull = {
  value: string;
  direction: TrendDirection;
  label?: string;
  positive?: boolean;
};

/**
 * Legacy trend shape from the pre-refactor StatCard. Kept so existing
 * call sites compile without modification.
 */
type StatCardTrendLegacy = {
  value: string;
  positive: boolean;
};

type StatCardProps = {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: StatCardTone;
  trend?: StatCardTrendFull | StatCardTrendLegacy;
  loading?: boolean;
  className?: string;
};

function normalizeTrend(
  trend: StatCardTrendFull | StatCardTrendLegacy,
): StatCardTrendFull {
  if ('direction' in trend) return trend;
  return {
    value: trend.value,
    direction: trend.positive ? 'up' : 'down',
    positive: trend.positive,
  };
}

const TONE_TILE: Record<StatCardTone, string> = {
  brand:
    'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
  success:
    'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
  warning:
    'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/35',
  danger:
    'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/25',
  info:
    'bg-info-soft text-info-soft-foreground ring-1 ring-inset ring-info/25',
};

const TONE_ACCENT_RAIL: Record<StatCardTone, string> = {
  brand: 'before:bg-primary/60',
  success: 'before:bg-success/70',
  warning: 'before:bg-warning/70',
  danger: 'before:bg-danger/70',
  info: 'before:bg-info/70',
};

function Delta({ trend }: { trend: StatCardTrendFull }) {
  const positive = trend.positive ?? trend.direction === 'up';
  const Icon =
    trend.direction === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        positive
          ? 'bg-success-soft text-success-soft-foreground'
          : 'bg-danger-soft text-danger-soft-foreground',
      )}
      aria-label={`${positive ? 'Up' : 'Down'} ${trend.value}${trend.label ? ' ' + trend.label : ''}`}
    >
      {trend.direction !== 'flat' && (
        <Icon className="size-3" aria-hidden strokeWidth={2.25} />
      )}
      <span>{trend.value}</span>
    </span>
  );
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone = 'brand',
  trend,
  loading,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border border-border bg-card p-4',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="size-10 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Surface — flat per .impeccable.md; no shadow, no hover lift.
        'group/stat relative overflow-hidden rounded-lg border border-border bg-card p-4',
        'transition-colors duration-[var(--dur-fast)] ease-[cubic-bezier(0.2,0,0,1)]',
        'hover:border-border-strong hover:bg-muted/40',
        // Left accent rail
        'before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:opacity-80',
        TONE_ACCENT_RAIL[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </p>
          <p
            data-slot="stat-card-value"
            className="font-mono text-[2rem] font-semibold leading-none tracking-tight text-foreground tabular-nums"
          >
            {value}
          </p>
          {(subtitle || trend) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {trend && <Delta trend={normalizeTrend(trend)} />}
              {subtitle && (
                <span className="text-[11px] text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <span
            aria-hidden
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              TONE_TILE[tone],
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
        )}
      </div>
    </div>
  );
}
