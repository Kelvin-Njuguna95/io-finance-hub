'use client';

import * as React from 'react';

/**
 * Resolves the design-system chart palette from the current theme.
 *
 * Charts should never hard-code colors. Use `useChartColors()` or the
 * semantic aliases below so light/dark mode stay consistent and the
 * palette can evolve from `globals.css` alone.
 *
 * Phase 1, non-breaking: consumers are additive. Existing charts already
 * read --chart-1..5 via Recharts' CSS variable support, so they pick up
 * the new palette automatically.
 */

export const CHART_CSS_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
] as const;

export type ChartRole =
  | 'revenue'
  | 'profit'
  | 'expenses'
  | 'budgets'
  | 'receivables'
  | 'variance';

export const CHART_ROLE_TO_VAR: Record<ChartRole, string> = {
  revenue: '--chart-1',
  profit: '--chart-2',
  expenses: '--chart-3',
  budgets: '--chart-4',
  receivables: '--chart-5',
  variance: '--chart-6',
};

/** SSR-safe palette fallbacks in case getComputedStyle is unavailable. */
const FALLBACK_LIGHT: Record<ChartRole, string> = {
  revenue: 'oklch(0.57 0.21 262)',
  profit: 'oklch(0.68 0.16 158)',
  expenses: 'oklch(0.73 0.17 55)',
  budgets: 'oklch(0.64 0.19 290)',
  receivables: 'oklch(0.70 0.11 195)',
  variance: 'oklch(0.63 0.23 25)',
};

function readVar(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || null;
}

export function readChartPalette(): Record<ChartRole, string> {
  const out: Record<ChartRole, string> = { ...FALLBACK_LIGHT };
  for (const role of Object.keys(CHART_ROLE_TO_VAR) as ChartRole[]) {
    const resolved = readVar(CHART_ROLE_TO_VAR[role]);
    if (resolved) out[role] = resolved;
  }
  return out;
}

/**
 * Subscribes to theme changes (by observing the `.dark` class on
 * document.documentElement) and re-reads the palette.
 */
export function useChartColors(): Record<ChartRole, string> {
  const [palette, setPalette] = React.useState<Record<ChartRole, string>>(
    () => ({ ...FALLBACK_LIGHT }),
  );

  React.useEffect(() => {
    setPalette(readChartPalette());

    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      setPalette(readChartPalette());
    });
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}
