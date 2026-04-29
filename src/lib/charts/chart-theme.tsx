import * as React from 'react';
import type { TooltipContentProps } from 'recharts/types/component/Tooltip';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

import { formatCurrency } from '@/lib/format';

/**
 * Locked chart vocabulary. Source values extracted from
 * _design-system/chart-vocabulary.html (axis chrome, tooltip capsule,
 * area gradient stops) and _design-system/colors_and_type.css (token names).
 *
 * Values are spec-literal where Recharts demands string colours, and CSS
 * variables where the consumer is a styled element. Keep in sync with the
 * design package — that file is the canonical source.
 */
export const ChartTheme = {
  axisStroke: 'var(--paper-4)',
  axisStrokeOpacity: 0.6,
  axisLabelStyle: {
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    fill: 'var(--muted-foreground)',
    fontFamily: 'var(--font-mono)',
  },
  axisNumStyle: {
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: '0.04em',
    fill: 'var(--muted-foreground)',
    fontFamily: 'var(--font-mono)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  gridStroke: 'var(--paper-4)',
  gridStrokeOpacity: 0.45,
  lineWeight: 2,
  series: {
    primary: 'var(--ink)',
    secondary: 'var(--gold)',
    tertiary: 'var(--success)',
    quaternary: 'var(--violet)',
    quinary: 'var(--teal)',
    danger: 'var(--danger)',
  },
  areaGradient: {
    gold: { topOpacity: 0.14, bottomOpacity: 0 },
    ink: { topOpacity: 0.10, bottomOpacity: 0 },
  },
  tooltipStyle: {
    backgroundColor: 'var(--ink)',
    color: 'var(--paper)',
    borderRadius: 8,
    padding: '12px 14px',
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    boxShadow:
      '0 8px 24px -8px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.08)',
    border: 'none',
  },
} as const;

const SERIES_DOT_COLORS = ChartTheme.series;

/**
 * Dark capsule tooltip matching _design-system/chart-vocabulary.html.
 * Eyebrow renders the period label uppercase; rows show colored dot,
 * series name, and mono-formatted value.
 *
 * Currency formatting defaults to KES; pass `currency="USD"` to switch.
 * Pass a custom `formatValue` to override entirely.
 */
export type CustomTooltipProps = TooltipContentProps<ValueType, NameType> & {
  currency?: 'KES' | 'USD';
  formatValue?: (value: ValueType, name: NameType) => string;
  /** Override the eyebrow label; defaults to the active payload's `label`. */
  periodLabel?: string;
};

export function CustomTooltip({
  active,
  payload,
  label,
  currency = 'KES',
  formatValue,
  periodLabel,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const eyebrow =
    periodLabel ?? (typeof label === 'string' ? label.toUpperCase() : String(label ?? ''));

  return (
    <div
      style={{
        backgroundColor: 'var(--ink)',
        color: 'var(--paper)',
        borderRadius: 8,
        padding: '12px 14px',
        fontFamily: 'var(--font-mono)',
        boxShadow:
          '0 8px 24px -8px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.08)',
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'rgba(250,250,247,0.55)',
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </div>
      {payload.map((entry, idx) => {
        const dotColor = (entry.color as string) ?? SERIES_DOT_COLORS.primary;
        const formattedValue = formatValue
          ? formatValue(entry.value as ValueType, entry.name as NameType)
          : typeof entry.value === 'number'
            ? formatCurrency(entry.value, currency)
            : String(entry.value ?? '');
        return (
          <div
            key={`${entry.dataKey ?? entry.name ?? idx}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '4px 0',
              borderTop:
                idx === 0 ? 'none' : '1px solid rgba(245,241,226,0.08)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: dotColor,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                color: 'rgba(250,250,247,0.7)',
                flex: 1,
              }}
            >
              {entry.name}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--paper)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formattedValue}
            </span>
          </div>
        );
      })}
    </div>
  );
}

CustomTooltip.displayName = 'ChartCustomTooltip';
