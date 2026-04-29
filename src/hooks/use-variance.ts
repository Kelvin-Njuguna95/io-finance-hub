'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { getPendingExpensesByMonth } from '@/lib/queries/expenses';

/**
 * Read-side composer for the variance dashboard.
 *
 * Per Phase 2 D-decisions:
 *   D2 — Aggregates (KPI strip, byBudget/byProject/byCategory, drivers,
 *        heatmap, waterfall) source from `pending_expenses`. The queue
 *        table is the canonical variance surface — it tracks budgeted
 *        vs actual through the lifecycle.
 *   D8 — Daily burn line (divergence chart) sources from `expenses`
 *        filtered to lifecycle_status='confirmed'. This is the only
 *        section where AGENTS.md rule 2 applies.
 *   D9 — Heatmap is 2D project × category aggregation.
 *   D11 — 5% tolerance constant lives only here; no UI surfaces it.
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const TOLERANCE_PCT = 5;
const DRIVERS_TOP_N = 7;
const CONCENTRATION_TOP_N = 3;
const WATERFALL_OVER_SEGMENTS = 4;
const WATERFALL_UNDER_SEGMENTS = 2;

export type VarianceTone = 'bad' | 'good' | 'neutral';

export type AggregatedRow = {
  id: string;
  label: string;
  meta?: string;
  planKes: number;
  actualKes: number;
  varianceKes: number;
  variancePct: number;
  count: number;
  isOverTolerance: boolean;
};

export type DriverRow = AggregatedRow & {
  rank: number;
  project: string;
  category: string;
  tone: VarianceTone;
};

export type HeatmapCell = {
  planKes: number;
  actualKes: number;
  varianceKes: number;
  variancePct: number;
  hasData: boolean;
};

export type HeatmapRow = {
  projectKey: string;
  projectLabel: string;
  cellsByCategory: Map<string, HeatmapCell>;
  total: HeatmapCell;
};

export type HeatmapData = {
  categories: string[];
  rows: HeatmapRow[];
  total: {
    cellsByCategory: Map<string, HeatmapCell>;
    total: HeatmapCell;
  };
};

export type DailyBurnPoint = {
  day: number;
  planCumulativeKes: number;
  actualCumulativeKes: number;
};

export type WaterfallSegment = {
  id: string;
  label: string;
  deltaKes: number;
  tone: 'bad' | 'good';
};

export type WaterfallData = {
  planKes: number;
  segments: WaterfallSegment[];
  actualKes: number;
  netVarianceKes: number;
  netVariancePct: number;
};

export type VarianceSummary = {
  monthLabel: string;
  netVarianceKes: number;
  netVariancePct: number;
  /** Number of categories driving most of the overage. */
  concentrationTopN: number;
  /** Share of net positive variance contributed by the top-N. */
  concentrationShare: number;
  spentKes: number;
  planKes: number;
  periodElapsedPct: number;
  overToleranceCount: number;
  /** Project name with the most over-tolerance budgets, or null. */
  overToleranceCluster: string | null;
  underspendingCount: number;
  underspendingProjectedSavingsKes: number;
  /** Project name leading the underspending, or null. */
  underspendingLeader: string | null;
  totalActiveBudgets: number;
};

type PendingExpenseLite = {
  id: string;
  budget_id: string | null;
  project_id: string | null;
  department_id: string | null;
  category: string | null;
  budgeted_amount_kes: number | string | null;
  actual_amount_kes: number | string | null;
  status: string;
  year_month: string;
  created_at: string;
  projects: { id?: string; name?: string } | null;
  departments: { id?: string; name?: string } | null;
};

function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1));
}

function daysInMonthFor(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
  return new Date(y, m, 0).getDate();
}

function todayDayInMonth(yearMonth: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const ty = Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '', 10);
  const tm = Number.parseInt(parts.find((p) => p.type === 'month')?.value ?? '', 10);
  const td = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '', 10);
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 1;
  if (ty < y || (ty === y && tm < m)) return 0;
  if (ty > y || (ty === y && tm > m)) return daysInMonthFor(yearMonth);
  return Math.min(td, daysInMonthFor(yearMonth));
}

function compactBudgetLabel(yearMonth: string, id: string): string {
  const [y, m] = yearMonth.split('-');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `BUD-${y}${m}-${tail}`;
}

function buildAggregated(
  rows: PendingExpenseLite[],
  keyFn: (row: PendingExpenseLite) => { id: string; label: string; meta?: string } | null,
): AggregatedRow[] {
  const map = new Map<
    string,
    { label: string; meta?: string; planKes: number; actualKes: number; count: number }
  >();

  for (const row of rows) {
    const k = keyFn(row);
    if (!k) continue;
    const existing = map.get(k.id) ?? {
      label: k.label,
      meta: k.meta,
      planKes: 0,
      actualKes: 0,
      count: 0,
    };
    existing.planKes += Number(row.budgeted_amount_kes ?? 0);
    existing.actualKes += Number(row.actual_amount_kes ?? 0);
    existing.count += 1;
    if (k.meta && !existing.meta) existing.meta = k.meta;
    map.set(k.id, existing);
  }

  return Array.from(map.entries()).map(([id, data]) => {
    const varianceKes = data.actualKes - data.planKes;
    const variancePct =
      data.planKes === 0 ? 0 : (varianceKes / data.planKes) * 100;
    return {
      id,
      label: data.label,
      meta: data.meta,
      planKes: data.planKes,
      actualKes: data.actualKes,
      varianceKes,
      variancePct,
      count: data.count,
      isOverTolerance: variancePct > TOLERANCE_PCT,
    };
  });
}

function projectKeyOf(row: PendingExpenseLite): { id: string; label: string } {
  const projectName = row.projects?.name;
  const departmentName = row.departments?.name;
  if (row.project_id && projectName) return { id: row.project_id, label: projectName };
  if (row.department_id && departmentName) return { id: `dept:${row.department_id}`, label: departmentName };
  return { id: '__shared__', label: 'Shared' };
}

function categoryKeyOf(row: PendingExpenseLite): { id: string; label: string } {
  const cat = row.category?.trim();
  if (!cat) return { id: '__uncategorized__', label: 'Uncategorized' };
  return { id: cat, label: cat };
}

function buildHeatmap(rows: PendingExpenseLite[]): HeatmapData {
  // First pass — collect categories + project rows.
  const categorySet = new Set<string>();
  const projectsMap = new Map<
    string,
    {
      label: string;
      cells: Map<string, { planKes: number; actualKes: number }>;
      total: { planKes: number; actualKes: number };
    }
  >();

  // Total row across all projects.
  const totalRow = {
    cells: new Map<string, { planKes: number; actualKes: number }>(),
    total: { planKes: 0, actualKes: 0 },
  };

  for (const row of rows) {
    const proj = projectKeyOf(row);
    const cat = categoryKeyOf(row);
    categorySet.add(cat.label);

    const projRecord =
      projectsMap.get(proj.id) ??
      {
        label: proj.label,
        cells: new Map<string, { planKes: number; actualKes: number }>(),
        total: { planKes: 0, actualKes: 0 },
      };

    const cell = projRecord.cells.get(cat.label) ?? { planKes: 0, actualKes: 0 };
    cell.planKes += Number(row.budgeted_amount_kes ?? 0);
    cell.actualKes += Number(row.actual_amount_kes ?? 0);
    projRecord.cells.set(cat.label, cell);
    projRecord.total.planKes += Number(row.budgeted_amount_kes ?? 0);
    projRecord.total.actualKes += Number(row.actual_amount_kes ?? 0);
    projectsMap.set(proj.id, projRecord);

    const tcell = totalRow.cells.get(cat.label) ?? { planKes: 0, actualKes: 0 };
    tcell.planKes += Number(row.budgeted_amount_kes ?? 0);
    tcell.actualKes += Number(row.actual_amount_kes ?? 0);
    totalRow.cells.set(cat.label, tcell);
    totalRow.total.planKes += Number(row.budgeted_amount_kes ?? 0);
    totalRow.total.actualKes += Number(row.actual_amount_kes ?? 0);
  }

  function toCell(c: { planKes: number; actualKes: number } | undefined): HeatmapCell {
    if (!c) {
      return { planKes: 0, actualKes: 0, varianceKes: 0, variancePct: 0, hasData: false };
    }
    const varianceKes = c.actualKes - c.planKes;
    const variancePct = c.planKes === 0 ? 0 : (varianceKes / c.planKes) * 100;
    return { planKes: c.planKes, actualKes: c.actualKes, varianceKes, variancePct, hasData: true };
  }

  const categories = Array.from(categorySet).sort();

  const rowsOut: HeatmapRow[] = Array.from(projectsMap.entries())
    .map(([projectKey, record]) => {
      const cellsByCategory = new Map<string, HeatmapCell>();
      for (const cat of categories) cellsByCategory.set(cat, toCell(record.cells.get(cat)));
      return {
        projectKey,
        projectLabel: record.label,
        cellsByCategory,
        total: toCell(record.total),
      };
    })
    .sort((a, b) => a.projectLabel.localeCompare(b.projectLabel));

  const totalCellsByCategory = new Map<string, HeatmapCell>();
  for (const cat of categories) totalCellsByCategory.set(cat, toCell(totalRow.cells.get(cat)));

  return {
    categories,
    rows: rowsOut,
    total: { cellsByCategory: totalCellsByCategory, total: toCell(totalRow.total) },
  };
}

export function useVariance(yearMonth: string) {
  const [items, setItems] = useState<PendingExpenseLite[]>([]);
  const [dailyConfirmed, setDailyConfirmed] = useState<Map<number, number>>(new Map());
  const [approvedBudgetTotalKes, setApprovedBudgetTotalKes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      // Pending_expenses (queue table) — canonical variance source per D2.
      const pendingRes = await getPendingExpensesByMonth(supabase, yearMonth);
      const pendingData = (pendingRes.data ?? []) as unknown as PendingExpenseLite[];

      // D8: divergence chart's daily burn — confirmed expenses only.
      const { data: confirmedRows } = await supabase
        .from('expenses')
        .select('expense_date, amount_kes')
        .eq('year_month', yearMonth)
        .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED);

      // Approved-budget total for the divergence chart's plan baseline.
      const { data: approvedBudgets } = await supabase
        .from('budgets')
        .select('budget_versions!inner(total_amount_kes, status)')
        .eq('year_month', yearMonth)
        .eq('budget_versions.status', 'approved');

      const totalApproved = (approvedBudgets ?? []).reduce(
        (s, b) => {
          const versions = (b as { budget_versions?: Array<{ total_amount_kes: number | string }> })
            .budget_versions ?? [];
          return s + versions.reduce((s2, v) => s2 + Number(v.total_amount_kes ?? 0), 0);
        },
        0,
      );

      const dailyMap = new Map<number, number>();
      for (const r of (confirmedRows ?? []) as Array<{
        expense_date: string;
        amount_kes: number | string;
      }>) {
        const day = Number.parseInt(r.expense_date?.slice(8, 10) ?? '', 10);
        if (!Number.isFinite(day)) continue;
        dailyMap.set(day, (dailyMap.get(day) ?? 0) + Number(r.amount_kes ?? 0));
      }

      setItems(pendingData);
      setDailyConfirmed(dailyMap);
      setApprovedBudgetTotalKes(totalApproved);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  const daysInMonth = useMemo(() => daysInMonthFor(yearMonth), [yearMonth]);
  const todayDayIndex = useMemo(() => todayDayInMonth(yearMonth), [yearMonth]);
  const periodElapsedPct = useMemo(
    () => Math.max(0, Math.min(100, (todayDayIndex / daysInMonth) * 100)),
    [todayDayIndex, daysInMonth],
  );

  // ---- Aggregations ----

  const byBudget = useMemo(
    () =>
      buildAggregated(items, (row) => {
        if (!row.budget_id) return null;
        const projectLabel = row.projects?.name ?? row.departments?.name ?? '—';
        return {
          id: row.budget_id,
          label: compactBudgetLabel(yearMonth, row.budget_id),
          meta: projectLabel,
        };
      }).sort((a, b) => Math.abs(b.varianceKes) - Math.abs(a.varianceKes)),
    [items, yearMonth],
  );

  const byProject = useMemo(
    () =>
      buildAggregated(items, (row) => {
        const k = projectKeyOf(row);
        return { id: k.id, label: k.label };
      }).sort((a, b) => Math.abs(b.varianceKes) - Math.abs(a.varianceKes)),
    [items],
  );

  const byCategory = useMemo(
    () =>
      buildAggregated(items, (row) => {
        const k = categoryKeyOf(row);
        return { id: k.id, label: k.label };
      }).sort((a, b) => Math.abs(b.varianceKes) - Math.abs(a.varianceKes)),
    [items],
  );

  const drivers = useMemo<DriverRow[]>(() => {
    const top = byCategory.slice(0, DRIVERS_TOP_N);
    return top.map((row, idx) => {
      const tone: VarianceTone =
        Math.abs(row.variancePct) < 2
          ? 'neutral'
          : row.varianceKes > 0
            ? 'bad'
            : 'good';
      // Find the dominant project for this category — the one with the
      // largest absolute contribution from items in this category.
      const projectsForCat = items.filter((r) => (r.category ?? 'Uncategorized') === row.label);
      const projectMap = new Map<string, number>();
      for (const r of projectsForCat) {
        const key =
          r.projects?.name ?? r.departments?.name ?? 'Shared';
        projectMap.set(key, (projectMap.get(key) ?? 0) + Math.abs(Number(r.actual_amount_kes ?? 0)));
      }
      const topProject =
        Array.from(projectMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
      return {
        ...row,
        rank: idx + 1,
        project: topProject,
        category: row.label,
        tone,
      };
    });
  }, [byCategory, items]);

  const heatmap = useMemo(() => buildHeatmap(items), [items]);

  const dailyBurn = useMemo<DailyBurnPoint[]>(() => {
    const planPerDay = daysInMonth > 0 ? approvedBudgetTotalKes / daysInMonth : 0;
    let runningActual = 0;
    const out: DailyBurnPoint[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      runningActual += dailyConfirmed.get(day) ?? 0;
      out.push({
        day,
        planCumulativeKes: planPerDay * day,
        actualCumulativeKes: runningActual,
      });
    }
    return out;
  }, [dailyConfirmed, approvedBudgetTotalKes, daysInMonth]);

  const summary = useMemo<VarianceSummary>(() => {
    const planKes = items.reduce((s, r) => s + Number(r.budgeted_amount_kes ?? 0), 0);
    const spentKes = items.reduce((s, r) => s + Number(r.actual_amount_kes ?? 0), 0);
    const netVarianceKes = spentKes - planKes;
    const netVariancePct = planKes === 0 ? 0 : (netVarianceKes / planKes) * 100;

    // Concentration: share of positive variance attributable to top-N
    // budgets.
    const overBudgets = byBudget.filter((b) => b.varianceKes > 0);
    const totalOver = overBudgets.reduce((s, b) => s + b.varianceKes, 0);
    const topOver = overBudgets
      .slice(0, CONCENTRATION_TOP_N)
      .reduce((s, b) => s + b.varianceKes, 0);
    const concentrationShare = totalOver > 0 ? (topOver / totalOver) * 100 : 0;

    const overTol = byBudget.filter((b) => b.isOverTolerance);
    const overTolByProject = new Map<string, number>();
    for (const r of overTol) {
      const meta = r.meta ?? '—';
      overTolByProject.set(meta, (overTolByProject.get(meta) ?? 0) + 1);
    }
    const overToleranceCluster =
      Array.from(overTolByProject.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const under = byBudget.filter((b) => b.variancePct < -TOLERANCE_PCT);
    const underProjectedSavings = under.reduce((s, b) => s + Math.abs(b.varianceKes), 0);
    const underByProject = new Map<string, number>();
    for (const r of under) {
      const meta = r.meta ?? '—';
      underByProject.set(meta, (underByProject.get(meta) ?? 0) + Math.abs(r.varianceKes));
    }
    const underspendingLeader =
      Array.from(underByProject.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return {
      monthLabel: shortMonth(yearMonth),
      netVarianceKes,
      netVariancePct,
      concentrationTopN: Math.min(CONCENTRATION_TOP_N, overBudgets.length),
      concentrationShare,
      spentKes,
      planKes,
      periodElapsedPct,
      overToleranceCount: overTol.length,
      overToleranceCluster,
      underspendingCount: under.length,
      underspendingProjectedSavingsKes: underProjectedSavings,
      underspendingLeader,
      totalActiveBudgets: byBudget.length,
    };
  }, [items, byBudget, yearMonth, periodElapsedPct]);

  const waterfall = useMemo<WaterfallData>(() => {
    const overSegments = byCategory
      .filter((c) => c.varianceKes > 0)
      .slice(0, WATERFALL_OVER_SEGMENTS)
      .map<WaterfallSegment>((c) => ({
        id: `over-${c.id}`,
        label: c.label,
        deltaKes: c.varianceKes,
        tone: 'bad',
      }));
    const underSegments = byCategory
      .filter((c) => c.varianceKes < 0)
      .slice(0, WATERFALL_UNDER_SEGMENTS)
      .map<WaterfallSegment>((c) => ({
        id: `under-${c.id}`,
        label: c.label,
        deltaKes: c.varianceKes,
        tone: 'good',
      }));
    return {
      planKes: summary.planKes,
      segments: [...overSegments, ...underSegments],
      actualKes: summary.spentKes,
      netVarianceKes: summary.netVarianceKes,
      netVariancePct: summary.netVariancePct,
    };
  }, [byCategory, summary]);

  return {
    items,
    summary,
    byBudget,
    byProject,
    byCategory,
    drivers,
    heatmap,
    dailyBurn,
    waterfall,
    monthLabel: summary.monthLabel,
    daysInMonth,
    todayDayIndex,
    periodElapsedPct,
    approvedBudgetTotalKes,
    loading,
    error,
    refresh: load,
  };
}
