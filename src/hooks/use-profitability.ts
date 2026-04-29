'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the per-project Profitability report.
 *
 * Per Phase 4 Session A architectural rules:
 *   - Revenue from `lagged_revenue_by_project_month` (per project).
 *   - Expenses from `expenses` filtered to lifecycle_status='confirmed',
 *     grouped by project_id.
 *   - Shared overhead (expenses with project_id IS NULL) is omitted —
 *     no allocation rule exists in schema; surfacing it would require
 *     either a manual allocation key or a heuristic. Deferred.
 *   - Headcount per (project, month) sourced from `agent_counts` for
 *     the scatter chart's circle size.
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const TREND_MONTHS = 6;

export type ProfitabilityRow = {
  id: string;
  name: string;
  revenueKes: number;
  expensesKes: number;
  grossProfitKes: number;
  marginPct: number;
  marginRank: number;
  /** Month-over-month delta in margin pts (current - prior). */
  momMarginDeltaPts: number;
  /** Headcount for the current month, when known. */
  headcount?: number;
};

export type ProfitabilitySummary = {
  monthLabel: string;
  totalRevenueKes: number;
  totalExpensesKes: number;
  totalGrossProfitKes: number;
  blendedMarginPct: number;
  topProject: { name: string; marginPct: number } | null;
  weakestProject: { name: string; marginPct: number } | null;
  projectCount: number;
};

export type ScatterPoint = {
  id: string;
  name: string;
  revenueKes: number;
  marginPct: number;
  /** Optional — drives the scatter circle radius. Omitted when no
   *  agent_counts row exists for (project, month). */
  headcount?: number;
};

export type ProjectTrendPoint = {
  month: string;
  label: string;
  revenueKes: number;
  expensesKes: number;
  marginPct: number;
};

export type ProjectTrend = {
  id: string;
  name: string;
  points: ProjectTrendPoint[];
};

type LaggedProjectRow = {
  project_id: string | null;
  expense_month: string;
  lagged_revenue_kes: number | string | null;
  current_expenses_kes: number | string | null;
  projects: { name?: string | null } | { name?: string | null }[] | null;
};

type ExpenseRow = {
  project_id: string | null;
  amount_kes: number | string | null;
  year_month: string;
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

function shortMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'short',
  })
    .format(new Date(y, m - 1, 1))
    .toUpperCase();
}

function prevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function lookbackMonths(yearMonth: string, count: number): string[] {
  const out: string[] = [];
  let cur = yearMonth;
  for (let i = 0; i < count; i++) {
    out.unshift(cur);
    cur = prevYearMonth(cur);
  }
  return out;
}

function firstName<T extends { name?: string | null }>(
  rel: T | T[] | null,
): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0]?.name ?? null;
  return rel.name ?? null;
}

function marginPctFor(revenueKes: number, expensesKes: number): number {
  if (revenueKes <= 0) return 0;
  return ((revenueKes - expensesKes) / revenueKes) * 100;
}

export function useProfitability(yearMonth: string) {
  const [summary, setSummary] = useState<ProfitabilitySummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    totalRevenueKes: 0,
    totalExpensesKes: 0,
    totalGrossProfitKes: 0,
    blendedMarginPct: 0,
    topProject: null,
    weakestProject: null,
    projectCount: 0,
  }));
  const [projects, setProjects] = useState<ProfitabilityRow[]>([]);
  const [scatter, setScatter] = useState<ScatterPoint[]>([]);
  const [trend, setTrend] = useState<ProjectTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const prev = prevYearMonth(yearMonth);
    const trail = lookbackMonths(yearMonth, TREND_MONTHS);

    try {
      const [
        currentRevenueRes,
        priorRevenueRes,
        currentExpensesRes,
        priorExpensesRes,
        trailingRevenueRes,
        trailingExpensesRes,
        agentCountsRes,
      ] = await Promise.all([
        supabase
          .from('lagged_revenue_by_project_month')
          .select(
            'project_id, expense_month, lagged_revenue_kes, current_expenses_kes, projects(name)',
          )
          .eq('expense_month', yearMonth),
        supabase
          .from('lagged_revenue_by_project_month')
          .select(
            'project_id, expense_month, lagged_revenue_kes, current_expenses_kes, projects(name)',
          )
          .eq('expense_month', prev),
        supabase
          .from('expenses')
          .select('project_id, amount_kes, year_month')
          .eq('year_month', yearMonth)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .not('project_id', 'is', null),
        supabase
          .from('expenses')
          .select('project_id, amount_kes, year_month')
          .eq('year_month', prev)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .not('project_id', 'is', null),
        supabase
          .from('lagged_revenue_by_project_month')
          .select(
            'project_id, expense_month, lagged_revenue_kes, current_expenses_kes, projects(name)',
          )
          .in('expense_month', trail),
        supabase
          .from('expenses')
          .select('project_id, amount_kes, year_month')
          .in('year_month', trail)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .not('project_id', 'is', null),
        supabase
          .from('agent_counts')
          .select('project_id, agent_count')
          .eq('year_month', yearMonth),
      ]);

      const currentRevenue = (currentRevenueRes.data ?? []) as LaggedProjectRow[];
      const priorRevenue = (priorRevenueRes.data ?? []) as LaggedProjectRow[];
      const currentExpenses = (currentExpensesRes.data ?? []) as ExpenseRow[];
      const priorExpenses = (priorExpensesRes.data ?? []) as ExpenseRow[];
      const trailingRevenue = (trailingRevenueRes.data ?? []) as LaggedProjectRow[];
      const trailingExpenses = (trailingExpensesRes.data ?? []) as ExpenseRow[];
      const agentCounts = (agentCountsRes.data ?? []) as Array<{
        project_id: string | null;
        agent_count: number | string | null;
      }>;

      // ---- Per-project current month rollup ----
      const currentByProject = new Map<
        string,
        { name: string; revenueKes: number; expensesKes: number }
      >();
      for (const r of currentRevenue) {
        if (!r.project_id) continue;
        const name = firstName(r.projects) ?? 'Unattributed';
        const existing = currentByProject.get(r.project_id) ?? {
          name,
          revenueKes: 0,
          expensesKes: 0,
        };
        existing.revenueKes += Number(r.lagged_revenue_kes ?? 0);
        if (!existing.name || existing.name === 'Unattributed') existing.name = name;
        currentByProject.set(r.project_id, existing);
      }
      // The lagged view's current_expenses_kes folds in confirmed
      // expenses already, but we re-aggregate from the expenses table to
      // honor the architectural rule literally and avoid drifting if
      // the view's filter behavior changes later.
      for (const e of currentExpenses) {
        if (!e.project_id) continue;
        const existing = currentByProject.get(e.project_id) ?? {
          name: 'Unattributed',
          revenueKes: 0,
          expensesKes: 0,
        };
        existing.expensesKes += Number(e.amount_kes ?? 0);
        currentByProject.set(e.project_id, existing);
      }

      // ---- Per-project prior month rollup (for MoM margin delta) ----
      const priorByProject = new Map<
        string,
        { revenueKes: number; expensesKes: number }
      >();
      for (const r of priorRevenue) {
        if (!r.project_id) continue;
        const existing = priorByProject.get(r.project_id) ?? {
          revenueKes: 0,
          expensesKes: 0,
        };
        existing.revenueKes += Number(r.lagged_revenue_kes ?? 0);
        priorByProject.set(r.project_id, existing);
      }
      for (const e of priorExpenses) {
        if (!e.project_id) continue;
        const existing = priorByProject.get(e.project_id) ?? {
          revenueKes: 0,
          expensesKes: 0,
        };
        existing.expensesKes += Number(e.amount_kes ?? 0);
        priorByProject.set(e.project_id, existing);
      }

      // ---- Headcount lookup ----
      const headcountByProject = new Map<string, number>();
      for (const ac of agentCounts) {
        if (!ac.project_id) continue;
        headcountByProject.set(ac.project_id, Number(ac.agent_count ?? 0));
      }

      // ---- Build ProfitabilityRow[] sorted by margin desc ----
      const unranked: Omit<ProfitabilityRow, 'marginRank'>[] = Array.from(
        currentByProject.entries(),
      ).map(([id, agg]) => {
        const grossProfitKes = agg.revenueKes - agg.expensesKes;
        const marginPct = marginPctFor(agg.revenueKes, agg.expensesKes);
        const prior = priorByProject.get(id);
        const priorMarginPct = prior
          ? marginPctFor(prior.revenueKes, prior.expensesKes)
          : 0;
        const momMarginDeltaPts = prior
          ? marginPct - priorMarginPct
          : 0;
        return {
          id,
          name: agg.name,
          revenueKes: agg.revenueKes,
          expensesKes: agg.expensesKes,
          grossProfitKes,
          marginPct,
          momMarginDeltaPts,
          headcount: headcountByProject.get(id),
        };
      });

      const sorted = unranked
        .slice()
        .sort((a, b) => b.marginPct - a.marginPct)
        .map<ProfitabilityRow>((row, idx) => ({
          ...row,
          marginRank: idx + 1,
        }));

      // ---- KPI summary ----
      const totalRevenueKes = sorted.reduce((s, r) => s + r.revenueKes, 0);
      const totalExpensesKes = sorted.reduce((s, r) => s + r.expensesKes, 0);
      const totalGrossProfitKes = totalRevenueKes - totalExpensesKes;
      const blendedMarginPct =
        totalRevenueKes > 0 ? (totalGrossProfitKes / totalRevenueKes) * 100 : 0;

      const topProject =
        sorted.length > 0
          ? { name: sorted[0].name, marginPct: sorted[0].marginPct }
          : null;
      const weakestProject =
        sorted.length > 0
          ? {
              name: sorted[sorted.length - 1].name,
              marginPct: sorted[sorted.length - 1].marginPct,
            }
          : null;

      const newSummary: ProfitabilitySummary = {
        monthLabel: shortMonth(yearMonth),
        totalRevenueKes,
        totalExpensesKes,
        totalGrossProfitKes,
        blendedMarginPct,
        topProject,
        weakestProject,
        projectCount: sorted.length,
      };

      // ---- Scatter points ----
      const scatterOut: ScatterPoint[] = sorted.map((row) => ({
        id: row.id,
        name: row.name,
        revenueKes: row.revenueKes,
        marginPct: row.marginPct,
        headcount: row.headcount,
      }));

      // ---- 6-month per-project trend ----
      // Build a Map<projectId, Map<month, { revenue, expenses }>> first.
      const trendByProject = new Map<
        string,
        { name: string; byMonth: Map<string, { revenueKes: number; expensesKes: number }> }
      >();
      for (const r of trailingRevenue) {
        if (!r.project_id) continue;
        const name = firstName(r.projects) ?? 'Unattributed';
        const proj = trendByProject.get(r.project_id) ?? {
          name,
          byMonth: new Map<string, { revenueKes: number; expensesKes: number }>(),
        };
        const monthRec = proj.byMonth.get(r.expense_month) ?? {
          revenueKes: 0,
          expensesKes: 0,
        };
        monthRec.revenueKes += Number(r.lagged_revenue_kes ?? 0);
        proj.byMonth.set(r.expense_month, monthRec);
        if (!proj.name || proj.name === 'Unattributed') proj.name = name;
        trendByProject.set(r.project_id, proj);
      }
      for (const e of trailingExpenses) {
        if (!e.project_id) continue;
        const proj = trendByProject.get(e.project_id) ?? {
          name: 'Unattributed',
          byMonth: new Map<string, { revenueKes: number; expensesKes: number }>(),
        };
        const monthRec = proj.byMonth.get(e.year_month) ?? {
          revenueKes: 0,
          expensesKes: 0,
        };
        monthRec.expensesKes += Number(e.amount_kes ?? 0);
        proj.byMonth.set(e.year_month, monthRec);
        trendByProject.set(e.project_id, proj);
      }

      const trendOut: ProjectTrend[] = Array.from(trendByProject.entries()).map(
        ([id, agg]) => ({
          id,
          name: agg.name,
          points: trail.map<ProjectTrendPoint>((m) => {
            const rec = agg.byMonth.get(m) ?? { revenueKes: 0, expensesKes: 0 };
            return {
              month: m,
              label: shortMonthLabel(m),
              revenueKes: rec.revenueKes,
              expensesKes: rec.expensesKes,
              marginPct: marginPctFor(rec.revenueKes, rec.expensesKes),
            };
          }),
        }),
      );

      setSummary(newSummary);
      setProjects(sorted);
      setScatter(scatterOut);
      setTrend(trendOut);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    summary,
    projects,
    scatter,
    trend,
    monthLabel: summary.monthLabel,
    loading,
    error,
    refresh: load,
  };
}
