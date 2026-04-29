'use client';

import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { HeatmapCell, HeatmapData } from '@/hooks/use-variance';

/**
 * 2D variance heatmap matching `.heatmap` in
 * _design-system/variance.html (lines 194-269).
 *
 * Rows = projects (+ "Total" row). Cols = categories (+ "Total" col).
 * Cells colour-shaded across a 6-step diverging scale on `variance_pct`
 * (D9). Toggle between signed compact KES and signed percent.
 */

export type VarianceHeatmapMode = 'kes' | 'pct';

type VarianceHeatmapProps = {
  heatmap: HeatmapData;
  mode: VarianceHeatmapMode;
  onModeChange(next: VarianceHeatmapMode): void;
  className?: string;
};

type Shade =
  | 'good-strong'
  | 'good'
  | 'zero'
  | 'warn'
  | 'bad'
  | 'bad-strong'
  | 'na';

function shadeFor(cell: HeatmapCell): Shade {
  if (!cell.hasData) return 'na';
  const pct = cell.variancePct;
  if (pct < -10) return 'good-strong';
  if (pct < -2) return 'good';
  if (pct <= 2) return 'zero';
  if (pct <= 5) return 'warn';
  if (pct <= 10) return 'bad';
  return 'bad-strong';
}

const SHADE_CLASS: Record<Shade, string> = {
  'good-strong':
    'bg-emerald-200 border-emerald-300 text-emerald-900',
  good:
    'bg-emerald-100 border-emerald-200 text-emerald-900',
  zero:
    'bg-[var(--paper-2)] border-border-subtle text-muted-foreground',
  warn:
    'bg-amber-100 border-amber-200 text-amber-900',
  bad:
    'bg-rose-100 border-rose-200 text-rose-900',
  'bad-strong':
    'bg-rose-200 border-rose-300 text-rose-900',
  na:
    'bg-card border-dashed border-border-subtle text-[var(--paper-4)]',
};

const LEGEND_SHADES: Shade[] = ['good-strong', 'good', 'zero', 'warn', 'bad', 'bad-strong'];

function formatCell(cell: HeatmapCell, mode: VarianceHeatmapMode): string {
  if (!cell.hasData) return '—';
  if (mode === 'pct') {
    if (Math.abs(cell.variancePct) < 0.05) return '0.0%';
    const sign = cell.variancePct >= 0 ? '+' : '−';
    return `${sign}${Math.abs(cell.variancePct).toFixed(1)}%`;
  }
  if (Math.abs(cell.varianceKes) < 1) return '±0';
  const sign = cell.varianceKes >= 0 ? '+ ' : '− ';
  return `${sign}${formatCompactKES(Math.abs(cell.varianceKes)).replace('KES ', '')}`;
}

function subFor(cell: HeatmapCell, mode: VarianceHeatmapMode): string {
  if (!cell.hasData) return 'n/a';
  if (mode === 'pct') {
    if (Math.abs(cell.varianceKes) < 1) return '±0';
    const sign = cell.varianceKes >= 0 ? '+ ' : '− ';
    return `${sign}${formatCompactKES(Math.abs(cell.varianceKes)).replace('KES ', '')}`;
  }
  if (Math.abs(cell.variancePct) < 0.05) return 'on plan';
  const sign = cell.variancePct >= 0 ? '+' : '−';
  return `${sign}${Math.abs(cell.variancePct).toFixed(1)}%`;
}

export function VarianceHeatmap({
  heatmap,
  mode,
  onModeChange,
  className,
}: VarianceHeatmapProps) {
  const { categories, rows, total } = heatmap;
  // Grid template: row label column (220px) + N category cols + total col.
  const gridCols = useMemo(
    () => `220px repeat(${categories.length + 1}, minmax(92px, 1fr))`,
    [categories.length],
  );

  if (categories.length === 0 || rows.length === 0) {
    return (
      <section
        className={cn(
          'rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        No variance data to chart for this month.
      </section>
    );
  }

  return (
    <section
      className={cn(
        'rounded-lg border border-border bg-card px-6 py-6',
        className,
      )}
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Cross-cut · variance
          </p>
          <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
            By project ×{' '}
            <em className="not-italic italic text-[var(--gold-lo)]">category</em>
          </h3>
        </div>
        <ModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <div className="overflow-auto">
        <div
          className="grid items-stretch gap-1.5 text-[12px]"
          style={{ gridTemplateColumns: gridCols }}
          role="table"
          aria-label="Variance heatmap by project and category"
        >
          {/* Header row — column labels */}
          <span aria-hidden />
          {categories.map((c) => (
            <span
              key={`h-${c}`}
              className="border-b border-border-subtle px-2.5 pb-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground"
              role="columnheader"
            >
              {c}
            </span>
          ))}
          <span
            className="border-b border-border bg-[var(--paper-2)] px-2.5 pb-2 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-foreground"
            role="columnheader"
          >
            Total
          </span>

          {/* Project rows */}
          {rows.map((row) => (
            <RowRender
              key={row.projectKey}
              label={row.projectLabel}
              cells={categories.map((c) => row.cellsByCategory.get(c)!)}
              total={row.total}
              mode={mode}
            />
          ))}

          {/* Totals row */}
          <span className="px-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-foreground">
            Total · all projects
            <span className="mt-0.5 block font-mono text-[9.5px] font-normal text-muted-foreground">
              net variance
            </span>
          </span>
          {categories.map((c) => {
            const cell = total.cellsByCategory.get(c)!;
            return (
              <span
                key={`tot-${c}`}
                role="cell"
                className={cn(
                  'flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border border-dashed bg-[var(--paper-2)] px-1.5',
                )}
              >
                <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
                  {formatCell(cell, mode)}
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground">
                  {subFor(cell, mode)}
                </span>
              </span>
            );
          })}
          <span
            role="cell"
            className="flex h-[52px] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border border-dashed bg-[var(--paper-2)] px-1.5"
          >
            <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
              {formatCell(total.total, mode)}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground">
              {subFor(total.total, mode)}
            </span>
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4 font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
        <span>Under plan</span>
        <span className="inline-flex items-center overflow-hidden rounded-[var(--radius-sm)]">
          {LEGEND_SHADES.map((s) => (
            <span
              key={s}
              className={cn('block h-3.5 w-7 border', SHADE_CLASS[s])}
            />
          ))}
        </span>
        <span>Over plan</span>
        <span className="ml-auto">Variance vs approved plan</span>
      </div>
    </section>
  );
}

function RowRender({
  label,
  cells,
  total,
  mode,
}: {
  label: string;
  cells: HeatmapCell[];
  total: HeatmapCell;
  mode: VarianceHeatmapMode;
}) {
  return (
    <>
      <span className="px-1 py-2 text-[13px] font-medium text-foreground" role="rowheader">
        {label}
      </span>
      {cells.map((cell, i) => {
        const shade = shadeFor(cell);
        return (
          <span
            key={`c-${i}`}
            role="cell"
            className={cn(
              'flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border px-1.5 transition-transform',
              'hover:z-10 hover:scale-[1.04] hover:border-foreground',
              SHADE_CLASS[shade],
            )}
          >
            <span className="font-mono text-[12px] font-medium tabular-nums">
              {formatCell(cell, mode)}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] opacity-70">
              {subFor(cell, mode)}
            </span>
          </span>
        );
      })}
      <span
        role="cell"
        className={cn(
          'flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-[var(--radius-sm)] border bg-[var(--paper-2)] px-1.5 transition-transform',
          'hover:z-10 hover:scale-[1.04] hover:border-foreground',
        )}
      >
        <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
          {formatCell(total, mode)}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground">
          {subFor(total, mode)}
        </span>
      </span>
    </>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: VarianceHeatmapMode;
  onChange(next: VarianceHeatmapMode): void;
}) {
  return (
    <div
      role="group"
      aria-label="Heatmap value mode"
      className="inline-flex rounded-full border border-border bg-card p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('pct')}
        className={cn(
          'h-7 rounded-full px-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
          mode === 'pct'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        % of plan
      </button>
      <button
        type="button"
        onClick={() => onChange('kes')}
        className={cn(
          'h-7 rounded-full px-3 font-mono text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
          mode === 'kes'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        KES
      </button>
    </div>
  );
}
