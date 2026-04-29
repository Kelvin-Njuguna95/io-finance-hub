'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { DailyBurnPoint } from '@/hooks/use-variance';

/**
 * Hand-rolled SVG divergence chart matching the divergence specimen in
 * _design-system/variance.html (lines 462-525).
 *
 * Renders:
 *   - Gold dashed plan baseline (linear cumulative).
 *   - Ink polyline for actual cumulative through TODAY, with anchor dots.
 *   - Variance band: red where actual > plan, green where actual < plan.
 *   - Vertical gold "TODAY" marker with label pill.
 *   - Faint dashed forecast cone past TODAY (decorative; D8).
 *   - Legend underneath.
 *
 * Per D8: the daily-burn data feeding this chart sources from `expenses`
 * filtered to lifecycle_status='confirmed'. Plan baseline is linear:
 * (planTotal / daysInMonth) * day_index.
 */

type VarianceDivergenceChartProps = {
  dailyBurn: DailyBurnPoint[];
  daysInMonth: number;
  /** 1..daysInMonth. 0 if before period start; daysInMonth if past period. */
  todayDayIndex: number;
  planTotalKes: number;
  className?: string;
};

const VIEW_W = 720;
const VIEW_H = 280;
const M = { top: 30, right: 36, bottom: 50, left: 56 };

function formatYTick(kes: number): string {
  if (kes >= 1_000_000) return `${(kes / 1_000_000).toFixed(1)}M`;
  if (kes >= 1_000) return `${Math.round(kes / 1_000)}K`;
  return `${Math.round(kes)}`;
}

function formatXTick(day: number): string {
  return `APR ${day}`;
}

export function VarianceDivergenceChart({
  dailyBurn,
  daysInMonth,
  todayDayIndex,
  planTotalKes,
  className,
}: VarianceDivergenceChartProps) {
  const plotW = VIEW_W - M.left - M.right;
  const plotH = VIEW_H - M.top - M.bottom;

  const maxY = useMemo(() => {
    const candidates = [planTotalKes, ...dailyBurn.map((d) => d.actualCumulativeKes)];
    const m = Math.max(...candidates, 1);
    return m * 1.15;
  }, [planTotalKes, dailyBurn]);

  const xScale = (day: number) =>
    M.left + ((day - 0) / Math.max(1, daysInMonth)) * plotW;
  const yScale = (kes: number) =>
    M.top + plotH - (kes / maxY) * plotH;

  const planLineX1 = xScale(0);
  const planLineY1 = yScale(0);
  const planLineX2 = xScale(daysInMonth);
  const planLineY2 = yScale(planTotalKes);

  // Actual polyline through todayDayIndex; if beyond, render full series.
  const actualPoints = useMemo(() => {
    const cap = todayDayIndex > 0 ? todayDayIndex : daysInMonth;
    return dailyBurn
      .filter((p) => p.day <= cap)
      .map((p) => ({ x: xScale(p.day), y: yScale(p.actualCumulativeKes) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyBurn, todayDayIndex, daysInMonth, maxY]);

  const actualPolyline = actualPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // Variance bands: walk through dailyBurn, accumulate contiguous over /
  // under segments, emit polygon paths.
  const { overPaths, underPaths } = useMemo(() => {
    const cap = todayDayIndex > 0 ? todayDayIndex : daysInMonth;
    const visible = dailyBurn.filter((p) => p.day <= cap);
    const overPaths: string[] = [];
    const underPaths: string[] = [];

    let segment: Array<{ day: number; actual: number; plan: number; sign: 1 | -1 | 0 }> = [];
    let segmentSign: 1 | -1 | 0 = 0;

    function flushSegment() {
      if (segment.length < 2 || segmentSign === 0) {
        segment = [];
        return;
      }
      const upper = segment.map((p) => `${xScale(p.day)},${yScale(Math.max(p.actual, p.plan))}`);
      const lower = segment
        .slice()
        .reverse()
        .map((p) => `${xScale(p.day)},${yScale(Math.min(p.actual, p.plan))}`);
      const path = `M ${upper.join(' L ')} L ${lower.join(' L ')} Z`;
      if (segmentSign > 0) overPaths.push(path);
      else underPaths.push(path);
      segment = [];
    }

    for (const p of visible) {
      const sign: 1 | -1 | 0 =
        p.actualCumulativeKes > p.planCumulativeKes
          ? 1
          : p.actualCumulativeKes < p.planCumulativeKes
            ? -1
            : 0;

      if (sign === 0) {
        // Crossover point: include in current segment, then close.
        segment.push({ day: p.day, actual: p.actualCumulativeKes, plan: p.planCumulativeKes, sign });
        flushSegment();
        segmentSign = 0;
        continue;
      }

      if (segmentSign === 0 || segmentSign === sign) {
        segment.push({ day: p.day, actual: p.actualCumulativeKes, plan: p.planCumulativeKes, sign });
        segmentSign = sign;
      } else {
        // Sign flip: close current and start new with this point.
        // Add a synthetic crossover point at the previous day's
        // boundary for visual smoothness.
        const last = segment[segment.length - 1];
        if (last) {
          segment.push({
            day: last.day,
            actual: last.plan,
            plan: last.plan,
            sign: 0,
          });
        }
        flushSegment();
        segment = [
          { day: p.day, actual: p.actualCumulativeKes, plan: p.planCumulativeKes, sign },
        ];
        segmentSign = sign;
      }
    }
    flushSegment();

    return { overPaths, underPaths };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyBurn, todayDayIndex, daysInMonth, maxY]);

  // Y axis ticks — 4 evenly spaced.
  const yTicks = useMemo(() => {
    const stops = [0.25, 0.5, 0.75, 1];
    return stops.map((s) => ({
      value: maxY * s,
      y: yScale(maxY * s),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxY]);

  // X axis ticks — every 7 days.
  const xTicks = useMemo(() => {
    const out: Array<{ day: number; x: number }> = [];
    for (let d = 1; d <= daysInMonth; d += 7) out.push({ day: d, x: xScale(d) });
    if (out[out.length - 1]?.day !== daysInMonth) {
      out.push({ day: daysInMonth, x: xScale(daysInMonth) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysInMonth, maxY]);

  // TODAY marker x position.
  const todayX = todayDayIndex > 0 ? xScale(todayDayIndex) : null;

  // Forecast cone past TODAY (decorative): extend actual's last point
  // toward end-of-month plan position with ±10% spread.
  const forecastCone = useMemo(() => {
    if (todayDayIndex <= 0 || todayDayIndex >= daysInMonth) return null;
    const last = actualPoints[actualPoints.length - 1];
    if (!last) return null;
    const endX = xScale(daysInMonth);
    const endActualLinear =
      todayDayIndex > 0 ? (dailyBurn[todayDayIndex - 1]?.actualCumulativeKes ?? 0) * (daysInMonth / todayDayIndex) : 0;
    const endY = yScale(endActualLinear);
    const spread = (Math.abs(endActualLinear - planTotalKes)) * 0.4 + maxY * 0.04;
    const upperY = yScale(endActualLinear + spread);
    const lowerY = yScale(Math.max(0, endActualLinear - spread));
    return {
      path: `M ${last.x},${last.y} L ${endX},${upperY} L ${endX},${lowerY} Z`,
      labelX: endX - 18,
      labelY: endY,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualPoints, todayDayIndex, daysInMonth, planTotalKes, maxY]);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        height="280"
        className="block"
        role="img"
        aria-label="Variance divergence chart: actual vs plan, daily cumulative"
      >
        {/* Grid */}
        <g stroke="var(--border-subtle)" strokeWidth={1}>
          {yTicks.map((t, i) => (
            <line key={`g-${i}`} x1={M.left} y1={t.y} x2={VIEW_W - M.right} y2={t.y} />
          ))}
        </g>

        {/* Y-axis labels */}
        <g
          fontFamily="var(--font-mono)"
          fontSize={9.5}
          fill="var(--muted-foreground)"
          letterSpacing="0.04em"
        >
          {yTicks.map((t, i) => (
            <text key={`y-${i}`} x={M.left - 8} y={t.y + 3} textAnchor="end">
              {formatYTick(t.value)}
            </text>
          ))}
        </g>

        {/* X-axis labels */}
        <g
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--muted-foreground)"
          letterSpacing="0.12em"
        >
          {xTicks.map((t, i) => (
            <text key={`x-${i}`} x={t.x} y={VIEW_H - M.bottom + 16} textAnchor="middle">
              {formatXTick(t.day)}
            </text>
          ))}
        </g>

        {/* Variance bands */}
        <g>
          {underPaths.map((p, i) => (
            <path key={`u-${i}`} d={p} fill="var(--success)" fillOpacity={0.18} />
          ))}
          {overPaths.map((p, i) => (
            <path key={`o-${i}`} d={p} fill="var(--danger)" fillOpacity={0.18} />
          ))}
        </g>

        {/* Plan baseline */}
        <line
          x1={planLineX1}
          y1={planLineY1}
          x2={planLineX2}
          y2={planLineY2}
          stroke="var(--gold)"
          strokeWidth={2}
          strokeDasharray="4 4"
        />

        {/* Actual polyline */}
        {actualPoints.length >= 2 && (
          <polyline
            points={actualPolyline}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Anchor dots every 5 days */}
        <g fill="var(--ink)">
          {actualPoints.map((p, i) =>
            i === 0 || i === actualPoints.length - 1 || i % 5 === 0 ? (
              <circle key={`d-${i}`} cx={p.x} cy={p.y} r={3.5} />
            ) : null,
          )}
          {/* Highlight latest point in gold */}
          {actualPoints.length > 0 && (
            <circle
              cx={actualPoints[actualPoints.length - 1].x}
              cy={actualPoints[actualPoints.length - 1].y}
              r={4.5}
              fill="var(--gold)"
              stroke="var(--ink)"
              strokeWidth={1.5}
            />
          )}
        </g>

        {/* Forecast cone (decorative, past TODAY) */}
        {forecastCone && (
          <g opacity={0.5}>
            <path
              d={forecastCone.path}
              fill="var(--ink)"
              fillOpacity={0.06}
              stroke="var(--ink)"
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
            />
            <text
              x={forecastCone.labelX}
              y={forecastCone.labelY}
              fontFamily="var(--font-mono)"
              fontSize={9}
              fill="var(--muted-foreground)"
              letterSpacing="0.12em"
              textAnchor="middle"
            >
              FORECAST
            </text>
          </g>
        )}

        {/* TODAY marker */}
        {todayX !== null && (
          <g>
            <line
              x1={todayX}
              y1={M.top}
              x2={todayX}
              y2={VIEW_H - M.bottom}
              stroke="var(--gold)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <rect
              x={todayX - 28}
              y={M.top - 16}
              width={56}
              height={16}
              rx={3}
              fill="var(--gold)"
            />
            <text
              x={todayX}
              y={M.top - 5}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={9}
              fill="var(--ink)"
              letterSpacing="0.12em"
              fontWeight={600}
            >
              TODAY · {todayDayIndex}
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
        <Legend swatchClass="bg-[var(--gold)]" label="Plan baseline" />
        <Legend swatchClass="bg-foreground" label="Actual MTD" />
        <Legend swatchClass="bg-[var(--danger)]" label="Over plan" />
        <Legend swatchClass="bg-[var(--success)]" label="Under plan" />
      </div>
    </div>
  );
}

function Legend({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-[11px] w-[11px] rounded-[2px]', swatchClass)} />
      {label}
    </span>
  );
}
