'use client';

import { cn } from '@/lib/utils';

/**
 * 5-layer variance bullet matching `.bullet` in
 * _design-system/variance.html. New primitive per Phase 2 D4 (does NOT
 * reuse `UtilisationBar` — that primitive only does 2 layers).
 *
 * Layers (back to front):
 *   1. Track — paper-3 background.
 *   2. Actual bar — ink fill from 0 to actual position; recolors to
 *      danger when over plan.
 *   3. Over-bar extension — separate red bar past plan-end with a
 *      paper-coloured left notch when actual > plan.
 *   4. Period-elapsed tick — gold vertical hairline at "where you should
 *      be" given today's day-in-month.
 *   5. Plan-end tick — ink vertical hairline at the plan position.
 *
 * Bar scale (`barMax`): when over plan, scale to actual + 5% headroom so
 * the over-bar has visual room. When under plan, scale to plan so the
 * plan-end tick anchors at 100%.
 */

type VarianceBulletProps = {
  planKes: number;
  actualKes: number;
  /** 0..100. Where today sits in the month. Ignored in `mode='margin'`. */
  periodElapsedPct: number;
  /**
   * Visual semantic.
   *   `variance` (default): the original 5-layer vocabulary — track,
   *     ink/red actual bar, red over-bar extension when actual > plan,
   *     gold period-elapsed tick, ink plan-end tick.
   *   `margin`: re-purposed for revenue → margin display. The actual
   *     bar fills gold (the retained portion); over-bar and period
   *     tick are suppressed; plan-end stays at 100% as the revenue
   *     boundary. Use with `planKes=revenue`, `actualKes=grossProfit`.
   */
  mode?: 'variance' | 'margin';
  className?: string;
};

type Geometry = {
  isOver: boolean;
  planEndPct: number;
  actualBarPct: number;
  overBarStart: number;
  overBarWidth: number;
  targetPct: number;
};

function computeGeometry(
  planKes: number,
  actualKes: number,
  periodElapsedPct: number,
): Geometry {
  if (planKes <= 0) {
    return {
      isOver: false,
      planEndPct: 0,
      actualBarPct: 0,
      overBarStart: 0,
      overBarWidth: 0,
      targetPct: 0,
    };
  }

  const isOver = actualKes > planKes;
  const elapsed = Math.max(0, Math.min(100, periodElapsedPct));

  if (!isOver) {
    return {
      isOver: false,
      planEndPct: 100,
      actualBarPct: Math.max(0, Math.min(100, (actualKes / planKes) * 100)),
      overBarStart: 100,
      overBarWidth: 0,
      targetPct: elapsed,
    };
  }

  // Over-plan: scale to actual + 5% headroom.
  const barMax = actualKes * 1.05;
  const planEndPct = (planKes / barMax) * 100;
  const actualBarPct = (actualKes / barMax) * 100;
  return {
    isOver: true,
    planEndPct,
    actualBarPct,
    overBarStart: planEndPct,
    overBarWidth: actualBarPct - planEndPct,
    // Where you should be (linear plan elapsed) on the over-plan scale.
    targetPct: (planEndPct * elapsed) / 100,
  };
}

export function VarianceBullet({
  planKes,
  actualKes,
  periodElapsedPct,
  mode = 'variance',
  className,
}: VarianceBulletProps) {
  const geom = computeGeometry(planKes, actualKes, periodElapsedPct);
  const isMargin = mode === 'margin';

  return (
    <div
      className={cn(
        'relative h-[22px] w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--paper-3)]',
        className,
      )}
      role="presentation"
    >
      {/* 2. Actual bar — ink/red when variance, gold when margin */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 rounded-l-[var(--radius-sm)]',
          isMargin
            ? 'bg-[var(--gold)]'
            : geom.isOver
              ? 'bg-[var(--danger)]'
              : 'bg-foreground',
        )}
        style={{ width: `${geom.actualBarPct}%` }}
      />
      {/* 3. Over-bar extension past plan-end (only when over plan in
          variance mode; suppressed in margin mode — gross profit can
          never exceed revenue). */}
      {!isMargin && geom.overBarWidth > 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0 rounded-r-[var(--radius-sm)] border-l-2 border-background bg-[var(--danger)]"
          style={{
            left: `${geom.overBarStart}%`,
            width: `${geom.overBarWidth}%`,
          }}
        />
      )}
      {/* 4. Period-elapsed tick — gold hairline. Suppressed in margin
          mode (no period concept for a fait-accompli profit). */}
      {!isMargin && (
        <span
          aria-hidden
          className="absolute -top-1 -bottom-1 w-[2px] rounded-[1px] bg-[var(--gold)] shadow-[0_0_0_3px_var(--paper)]"
          style={{ left: `${geom.targetPct}%` }}
          title="Period elapsed"
        />
      )}
      {/* 5. Plan-end tick — ink hairline (variance) or revenue
          boundary (margin). Always shown. */}
      <span
        aria-hidden
        className="absolute -top-0.5 -bottom-0.5 w-[1.5px] rounded-[1px] bg-foreground"
        style={{ left: `${geom.planEndPct}%` }}
        title={isMargin ? 'Total revenue' : 'End of plan'}
      />
    </div>
  );
}
