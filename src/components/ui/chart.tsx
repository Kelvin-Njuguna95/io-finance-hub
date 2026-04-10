'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared chart chrome. Thin, dependency-light wrappers around Recharts'
 * Tooltip / Legend content so every chart in the app uses the same
 * typography, radii, shadows, and semantic colors.
 *
 * Phase 1 only ships the primitives. Consumers are migrated in a
 * follow-up pass (see "deferred enhancements").
 */

type ChartContainerProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Fixed aspect ratio wrapper; defaults to 16/9. */
  ratio?: number | string;
};

function ChartContainer({
  className,
  ratio = '16 / 9',
  style,
  ...props
}: ChartContainerProps) {
  return (
    <div
      data-slot="chart-container"
      className={cn(
        'relative w-full text-xs text-muted-foreground',
        '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
        '[&_.recharts-cartesian-grid_line]:stroke-border-subtle',
        '[&_.recharts-polar-grid_line]:stroke-border-subtle',
        '[&_.recharts-tooltip-cursor]:stroke-border-strong',
        '[&_.recharts-dot]:stroke-background',
        className,
      )}
      style={{ aspectRatio: ratio, ...style }}
      {...props}
    />
  );
}

type ChartTooltipContentProps = {
  active?: boolean;
  payload?: Array<{
    name?: string | number;
    value?: number | string;
    color?: string;
    dataKey?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string | number;
  formatter?: (value: number | string, name?: string | number) => React.ReactNode;
  labelFormatter?: (label: string | number) => React.ReactNode;
  className?: string;
};

function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  className,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      data-slot="chart-tooltip"
      className={cn(
        'rounded-lg border border-border-subtle bg-popover px-3 py-2 text-xs text-popover-foreground shadow-elev-2',
        'min-w-[9rem] tabular-nums',
        className,
      )}
    >
      {label != null && (
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {labelFormatter ? labelFormatter(label) : label}
        </div>
      )}
      <ul className="space-y-1">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="text-[11px] text-muted-foreground">
                {entry.name}
              </span>
            </span>
            <span className="font-medium text-foreground">
              {entry.value != null && formatter
                ? formatter(entry.value, entry.name)
                : entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ChartLegendContentProps = {
  payload?: Array<{ value?: string; color?: string; id?: string }>;
  className?: string;
};

function ChartLegendContent({ payload, className }: ChartLegendContentProps) {
  if (!payload || payload.length === 0) return null;

  return (
    <ul
      data-slot="chart-legend"
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {payload.map((entry, i) => (
        <li key={entry.id ?? i} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span>{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

export { ChartContainer, ChartTooltipContent, ChartLegendContent };
