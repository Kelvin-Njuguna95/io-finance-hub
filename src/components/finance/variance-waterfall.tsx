'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import type { WaterfallData, WaterfallSegment } from '@/hooks/use-variance';

/**
 * Hand-rolled SVG plan→actual waterfall matching the specimen in
 * _design-system/variance.html (lines 881-955).
 *
 * Segments left-to-right:
 *   1. Plan anchor (ink, full-height bar at planKes)
 *   2..N-1. Variance segments — over (red, hanging upward) and savings
 *           (green, hanging downward)
 *   N. Actual terminal (gold, full-height bar at actualKes)
 *
 * Dashed connector lines between segment tops show the running total.
 * Top labels = signed KES; bottom labels = uppercase category name.
 * Bottom callout: "NET VARIANCE · {signed} · {pct} OVER/UNDER PLAN".
 */

type VarianceWaterfallProps = {
  data: WaterfallData;
  /** Anchor (left) bar bottom label. Defaults to "PLAN". */
  anchorLabel?: string;
  /** Terminal (right) bar bottom label. Defaults to "ACTUAL". */
  terminalLabel?: string;
  /** Override the bottom callout. When omitted, renders the default
   *  "NET VARIANCE · {signed} · {pct}% OVER/UNDER PLAN" format. */
  calloutOverride?: string;
  className?: string;
};

const VIEW_W = 880;
const VIEW_H = 240;
const M = { top: 40, right: 24, bottom: 40, left: 60 };

function compactNum(kes: number): string {
  if (Math.abs(kes) >= 1_000_000) return `${(kes / 1_000_000).toFixed(2)}M`;
  if (Math.abs(kes) >= 1_000) return `${Math.round(kes / 1_000)}K`;
  return `${Math.round(kes)}`;
}

function signedNum(kes: number): string {
  const sign = kes >= 0 ? '+' : '−';
  return `${sign}${compactNum(Math.abs(kes))}`;
}

export function VarianceWaterfall({
  data,
  anchorLabel = 'PLAN',
  terminalLabel = 'ACTUAL',
  calloutOverride,
  className,
}: VarianceWaterfallProps) {
  const plotW = VIEW_W - M.left - M.right;
  const plotH = VIEW_H - M.top - M.bottom;

  // Determine bar geometry. The plan and actual bars sit at full height
  // anchored on the baseline; intermediate segments hang from the running
  // total at their respective vertical position.
  const { bars, connectors, maxValue } = useMemo(() => {
    const segments = data.segments;
    const totalBars = segments.length + 2;
    const gap = 12;
    const barWidth = (plotW - gap * (totalBars - 1)) / totalBars;

    const allValues = [data.planKes, data.actualKes];
    let runningTotal = data.planKes;
    for (const seg of segments) {
      runningTotal += seg.deltaKes;
      allValues.push(runningTotal);
    }
    const maxValue = Math.max(...allValues, 1);

    const yForValue = (v: number) =>
      M.top + plotH - (Math.abs(v) / maxValue) * plotH;
    const baselineY = M.top + plotH;

    type Bar =
      | { kind: 'anchor'; id: string; label: string; x: number; y: number; height: number; fill: string; topLabel: string }
      | {
          kind: 'segment';
          id: string;
          label: string;
          x: number;
          y: number;
          height: number;
          fill: string;
          topLabel: string;
          deltaKes: number;
        };

    const bars: Bar[] = [];
    const connectors: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    let cursorX = M.left;

    // Plan / anchor bar.
    const planY = yForValue(data.planKes);
    const planHeight = baselineY - planY;
    bars.push({
      kind: 'anchor',
      id: 'plan',
      label: anchorLabel,
      x: cursorX,
      y: planY,
      height: planHeight,
      fill: 'var(--ink)',
      topLabel: compactNum(data.planKes),
    });

    let prevTopX = cursorX + barWidth;
    let prevTopY = planY;
    runningTotal = data.planKes;

    cursorX += barWidth + gap;

    // Variance segments.
    for (const seg of segments) {
      const newTotal = runningTotal + seg.deltaKes;
      const topRunning = Math.max(runningTotal, newTotal);
      const bottomRunning = Math.min(runningTotal, newTotal);
      const yTop = yForValue(topRunning);
      const yBot = yForValue(bottomRunning);
      const segHeight = Math.max(yBot - yTop, 4);

      bars.push({
        kind: 'segment',
        id: seg.id,
        label: seg.label.toUpperCase(),
        x: cursorX,
        y: yTop,
        height: segHeight,
        fill: seg.tone === 'bad' ? 'var(--danger)' : 'var(--success)',
        topLabel: signedNum(seg.deltaKes),
        deltaKes: seg.deltaKes,
      });

      // Connector from previous top to this segment's "starting" edge.
      const segStartY = yForValue(runningTotal);
      connectors.push({
        x1: prevTopX,
        y1: prevTopY,
        x2: cursorX,
        y2: segStartY,
      });

      prevTopX = cursorX + barWidth;
      prevTopY = yForValue(newTotal);
      runningTotal = newTotal;
      cursorX += barWidth + gap;
    }

    // Actual / terminal bar.
    const actualY = yForValue(data.actualKes);
    const actualHeight = baselineY - actualY;
    bars.push({
      kind: 'anchor',
      id: 'actual',
      label: terminalLabel,
      x: cursorX,
      y: actualY,
      height: actualHeight,
      fill: 'var(--gold)',
      topLabel: compactNum(data.actualKes),
    });

    // Connector from last segment top to actual bar top.
    connectors.push({
      x1: prevTopX,
      y1: prevTopY,
      x2: cursorX,
      y2: actualY,
    });

    return { bars, connectors, maxValue, barWidth };
  }, [data, plotW, plotH, anchorLabel, terminalLabel]);

  // Suppress unused-var lint for maxValue (returned for parity).
  void maxValue;

  const baselineY = M.top + plotH;
  const barWidth = useMemo(() => {
    const totalBars = data.segments.length + 2;
    return (plotW - 12 * (totalBars - 1)) / totalBars;
  }, [data.segments.length, plotW]);

  const defaultCallout = `NET VARIANCE · ${signedNum(data.netVarianceKes)} · ${data.netVariancePct >= 0 ? '+' : '−'}${Math.abs(data.netVariancePct).toFixed(2)}% ${data.netVarianceKes >= 0 ? 'OVER' : 'UNDER'} PLAN`;
  const calloutText = calloutOverride ?? defaultCallout;

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-7',
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        height="240"
        className="block"
        role="img"
        aria-label={`Plan to actual waterfall: ${calloutText}`}
      >
        {/* Baseline */}
        <line
          x1={M.left}
          y1={baselineY}
          x2={VIEW_W - M.right}
          y2={baselineY}
          stroke="var(--border)"
          strokeWidth={1}
        />

        {/* Connector dashes */}
        <g stroke="var(--paper-4)" strokeWidth={1} strokeDasharray="2 3">
          {connectors.map((c, i) => (
            <line key={`c-${i}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
          ))}
        </g>

        {/* Bars */}
        <g>
          {bars.map((b) => (
            <rect
              key={b.id}
              x={b.x}
              y={b.y}
              width={barWidth}
              height={b.height}
              rx={2}
              fill={b.fill}
            />
          ))}
        </g>

        {/* Top labels (signed KES) */}
        <g
          fontFamily="var(--font-mono)"
          fontSize={9.5}
          letterSpacing="0.14em"
          fontWeight={600}
        >
          {bars.map((b) => {
            const isOver = b.kind === 'segment' && b.deltaKes > 0;
            const isUnder = b.kind === 'segment' && b.deltaKes < 0;
            const fill = isOver
              ? 'var(--danger)'
              : isUnder
                ? 'var(--success-soft-foreground)'
                : 'var(--ink)';
            return (
              <text
                key={`t-${b.id}`}
                x={b.x + barWidth / 2}
                y={Math.max(b.y - 8, M.top - 6)}
                textAnchor="middle"
                fill={fill}
              >
                {b.topLabel}
              </text>
            );
          })}
        </g>

        {/* Bottom labels */}
        <g
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--muted-foreground)"
          letterSpacing="0.14em"
        >
          {bars.map((b) => (
            <text
              key={`b-${b.id}`}
              x={b.x + barWidth / 2}
              y={baselineY + 18}
              textAnchor="middle"
            >
              {b.label}
            </text>
          ))}
        </g>

        {/* Bottom callout */}
        <g>
          <line
            x1={M.left}
            y1={baselineY + 30}
            x2={VIEW_W - M.right}
            y2={baselineY + 30}
            stroke="var(--paper-4)"
            strokeWidth={1}
          />
          <text
            x={VIEW_W / 2}
            y={baselineY + 32}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={10}
            fill="var(--ink)"
            letterSpacing="0.14em"
            fontWeight={600}
          >
            {calloutText}
          </text>
        </g>
      </svg>
    </div>
  );
}
