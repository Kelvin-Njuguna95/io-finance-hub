'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the per-project Profitability report.
 *
 * Per Phase 4 Session A architectural rules:
 *   - Revenue from `lagged_revenue_by_project_month` (per project).
 *   - Direct expenses from `expenses` filtered to
 *     lifecycle_status='confirmed' AND expense_type='project_expense'.
 *   - Shared overhead allocated to projects by headcount proportion.
 *     Two-tier source:
 *       1. Read materialised `overhead_allocations.allocated_amount_kes`
 *          when rows exist for the month (closed months / post-recompute).
 *       2. Otherwise compute client-side from
 *          totalSharedExpensesKes × (projectAgents / totalAgents) —
 *          mirrors fn_calculate_overhead_allocations' headcount_based
 *          method. Open months that have not been recomputed land here.
 *   - We do NOT read `project_profitability` directly: its revenue side
 *     comes from invoices.billing_period (accrual basis), which
 *     disagrees with the lagged view that the rest of this page uses.
 *     Migration 00031 flags this as deferred work (G3).
 *   - Headcount per (project, month) sourced from `agent_counts` for
 *     the scatter chart's circle size and (now) the allocation pool.
 *
 * Trend (6mo) intentionally stays on direct margin — fully-loaded
 * trend would need 6 months of shared expenses + agent counts and is
 * deferred (only the current-month rollup is rendered).
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const TREND_MONTHS = 6;

export type ProfitabilityRow = {
  id: string;
  name: string;
  revenueKes: number;
  /** Direct project expenses only (lifecycle_status='confirmed',
   *  expense_type='project_expense'). Same value formerly named
   *  `expensesKes`; the alias is retained for back-compat. */
  directCostKes: number;
  /** Project's share of shared overhead. Materialised when
   *  overhead_allocations has a row, otherwise headcount-proportional. */
  allocatedOverheadKes: number;
  /** Fully-loaded cost = direct + allocated overhead. */
  totalCostKes: number;
  /** @deprecated alias for directCostKes — preserved so existing
   *  callers don't break in the same commit; remove after page
   *  migrates. */
  expensesKes: number;
  /** Net profit using fully-loaded cost (revenue - totalCost). */
  grossProfitKes: number;
  /** Net margin %, fully-loaded. This is what the page now shows. */
  marginPct: number;
  /** Direct margin %, retained for transparency / future drill-down. */
  directMarginPct: number;
  marginRank: number;
  /** Month-over-month delta in net margin pts (current - prior). */
  momMarginDeltaPts: number;
  /** Headcount for the current month, when known. */
  headcount?: number;
  /** This project's share of total agents in the allocation pool, e.g.
   *  48.1 for 50/104. Null when no agents in the pool. */
  headcountSharePct: number | null;
};

export type ProfitabilitySummary = {
  monthLabel: string;
  totalRevenueKes: number;
  /** Direct project expenses across all projects. */
  totalDirectCostKes: number;
  /** Total shared overhead this month (regardless of allocation). */
  totalSharedExpensesKes: number;
  /** Sum of allocated overhead across projects in the table. Equals
   *  totalSharedExpensesKes when every project in the pool has a
   *  headcount; less when some don't. */
  totalAllocatedOverheadKes: number;
  /** totalSharedExpensesKes - totalAllocatedOverheadKes. */
  unallocatedOverheadKes: number;
  /** Fully-loaded total cost across all projects. */
  totalCostKes: number;
  /** @deprecated retained as alias for totalCostKes. */
  totalExpensesKes: number;
  /** Net profit using fully-loaded cost. */
  totalGrossProfitKes: number;
  /** Blended net margin (fully-loaded). */
  blendedMarginPct: number;
  /** Truth: was the per-project allocation read from
   *  overhead_allocations (true) or computed client-side (false)? */
  allocationFromMaterializedTable: boolean;
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

function marginPctFor(revenueKes: number, expensesKes: number): number {
  if (revenueKes <= 0) return 0;
  return ((revenueKes - expensesKes) / revenueKes) * 100;
}

export function useProfitability(yearMonth: string) {
  const [summary, setSummary] = useState<ProfitabilitySummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    totalRevenueKes: 0,
    totalDirectCostKes: 0,
    totalSharedExpensesKes: 0,
    totalAllocatedOverheadKes: 0,
    unallocatedOverheadKes: 0,
    totalCostKes: 0,
    totalExpensesKes: 0,
    totalGrossProfitKes: 0,
    blendedMarginPct: 0,
    allocationFromMaterializedTable: false,
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
        projectsRes,
        overheadAllocationsRes,
        currentSharedExpensesRes,
      ] = await Promise.all([
        // The lagged view has no FK declared on projects — supabase-js
        // can't auto-resolve a projects(name) embed against it, and the
        // failed embed silently returns 0 rows. Query the view without
        // the embed and resolve names via a separate projects fetch
        // below.
        supabase
          .from('lagged_revenue_by_project_month')
          .select('project_id, expense_month, lagged_revenue_kes, current_expenses_kes')
          .eq('expense_month', yearMonth),
        supabase
          .from('lagged_revenue_by_project_month')
          .select('project_id, expense_month, lagged_revenue_kes, current_expenses_kes')
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
          .select('project_id, expense_month, lagged_revenue_kes, current_expenses_kes')
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
        // Direct projects fetch — name resolution. Same pattern as the
        // variance hook (which reads pending_expenses, a table with
        // declared FKs, and works).
        supabase.from('projects').select('id, name'),
        // Materialised per-project overhead allocation. Populated by
        // fn_calculate_overhead_allocations on month close / recompute.
        // Empty for never-recomputed months — we fall back to a
        // client-side headcount split using the next query's totals.
        supabase
          .from('overhead_allocations')
          .select(
            'project_id, allocated_amount_kes, headcount_share_pct, final_share_pct',
          )
          .eq('year_month', yearMonth),
        // Total shared overhead for the requested month — fallback
        // input when overhead_allocations is empty. Filtering by
        // expense_type='shared_expense' is the canonical "is this
        // overhead?" check (see expense_scope_check on expenses).
        supabase
          .from('expenses')
          .select('amount_kes')
          .eq('year_month', yearMonth)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .eq('expense_type', 'shared_expense'),
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
      const projectsList = (projectsRes.data ?? []) as Array<{
        id: string;
        name: string | null;
      }>;
      const overheadAllocations = (overheadAllocationsRes.data ?? []) as Array<{
        project_id: string;
        allocated_amount_kes: number | string | null;
        headcount_share_pct: number | string | null;
        final_share_pct: number | string | null;
      }>;
      const currentSharedExpenses = (currentSharedExpensesRes.data ?? []) as Array<{
        amount_kes: number | string | null;
      }>;

      // ---- Project-name resolver ----
      const projectNameById = new Map<string, string>();
      for (const p of projectsList) {
        if (p.id) projectNameById.set(p.id, p.name ?? 'Unattributed');
      }
      const nameFor = (id: string): string =>
        projectNameById.get(id) ?? 'Unattributed';

      // ---- Per-project current month rollup ----
      const currentByProject = new Map<
        string,
        { name: string; revenueKes: number; expensesKes: number }
      >();
      for (const r of currentRevenue) {
        if (!r.project_id) continue;
        const existing = currentByProject.get(r.project_id) ?? {
          name: nameFor(r.project_id),
          revenueKes: 0,
          expensesKes: 0,
        };
        existing.revenueKes += Number(r.lagged_revenue_kes ?? 0);
        currentByProject.set(r.project_id, existing);
      }
      // The lagged view's current_expenses_kes folds in confirmed
      // expenses already, but we re-aggregate from the expenses table to
      // honor the architectural rule literally and avoid drifting if
      // the view's filter behavior changes later.
      for (const e of currentExpenses) {
        if (!e.project_id) continue;
        const existing = currentByProject.get(e.project_id) ?? {
          name: nameFor(e.project_id),
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

      // ---- Shared overhead allocation ----
      // Tier 1: materialised overhead_allocations (closed / recomputed
      // months). Tier 2: client-side headcount split using
      // sum(shared_expense confirmed) / sum(agent_counts), keyed by
      // each project's headcount share.
      const totalSharedExpensesKes = currentSharedExpenses.reduce(
        (s, e) => s + Number(e.amount_kes ?? 0),
        0,
      );
      const allocatedByProject = new Map<string, number>();
      let allocationFromMaterializedTable = false;
      if (overheadAllocations.length > 0) {
        allocationFromMaterializedTable = true;
        for (const a of overheadAllocations) {
          if (!a.project_id) continue;
          allocatedByProject.set(
            a.project_id,
            Number(a.allocated_amount_kes ?? 0),
          );
        }
      } else {
        const totalAgents = Array.from(headcountByProject.values()).reduce(
          (s, n) => s + n,
          0,
        );
        if (totalAgents > 0 && totalSharedExpensesKes > 0) {
          for (const [pid, agents] of headcountByProject) {
            if (agents <= 0) continue;
            allocatedByProject.set(
              pid,
              totalSharedExpensesKes * (agents / totalAgents),
            );
          }
        }
      }

      // Total agents in the per-project pool (only projects that
      // appear in currentByProject + have headcount). Used for the
      // headcountSharePct field on each row.
      const poolAgents = Array.from(currentByProject.keys()).reduce(
        (s, pid) => s + (headcountByProject.get(pid) ?? 0),
        0,
      );

      // ---- Build ProfitabilityRow[] sorted by NET margin desc ----
      const unranked: Omit<ProfitabilityRow, 'marginRank'>[] = Array.from(
        currentByProject.entries(),
      ).map(([id, agg]) => {
        const directCostKes = agg.expensesKes;
        const allocatedOverheadKes = allocatedByProject.get(id) ?? 0;
        const totalCostKes = directCostKes + allocatedOverheadKes;
        const grossProfitKes = agg.revenueKes - totalCostKes;
        const marginPct = marginPctFor(agg.revenueKes, totalCostKes);
        const directMarginPct = marginPctFor(agg.revenueKes, directCostKes);
        const prior = priorByProject.get(id);
        // Prior delta intentionally compares direct margins (we don't
        // pull prior-month allocation here; doing so would need
        // another overhead_allocations fetch and a prior shared-expense
        // total). Rename to net once prior overhead is sourced.
        const priorMarginPct = prior
          ? marginPctFor(prior.revenueKes, prior.expensesKes)
          : 0;
        const momMarginDeltaPts = prior
          ? directMarginPct - priorMarginPct
          : 0;
        const agents = headcountByProject.get(id);
        const headcountSharePct =
          poolAgents > 0 && agents !== undefined
            ? (agents / poolAgents) * 100
            : null;
        return {
          id,
          name: agg.name,
          revenueKes: agg.revenueKes,
          directCostKes,
          allocatedOverheadKes,
          totalCostKes,
          expensesKes: directCostKes,
          grossProfitKes,
          marginPct,
          directMarginPct,
          momMarginDeltaPts,
          headcount: agents,
          headcountSharePct,
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
      const totalDirectCostKes = sorted.reduce((s, r) => s + r.directCostKes, 0);
      const totalAllocatedOverheadKes = sorted.reduce(
        (s, r) => s + r.allocatedOverheadKes,
        0,
      );
      const unallocatedOverheadKes = Math.max(
        0,
        Math.round(totalSharedExpensesKes - totalAllocatedOverheadKes),
      );
      const totalCostKes = totalDirectCostKes + totalAllocatedOverheadKes;
      const totalGrossProfitKes = totalRevenueKes - totalCostKes;
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
        totalDirectCostKes,
        totalSharedExpensesKes,
        totalAllocatedOverheadKes,
        unallocatedOverheadKes,
        totalCostKes,
        totalExpensesKes: totalCostKes,
        totalGrossProfitKes,
        blendedMarginPct,
        allocationFromMaterializedTable,
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
        const proj = trendByProject.get(r.project_id) ?? {
          name: nameFor(r.project_id),
          byMonth: new Map<string, { revenueKes: number; expensesKes: number }>(),
        };
        const monthRec = proj.byMonth.get(r.expense_month) ?? {
          revenueKes: 0,
          expensesKes: 0,
        };
        monthRec.revenueKes += Number(r.lagged_revenue_kes ?? 0);
        proj.byMonth.set(r.expense_month, monthRec);
        trendByProject.set(r.project_id, proj);
      }
      for (const e of trailingExpenses) {
        if (!e.project_id) continue;
        const proj = trendByProject.get(e.project_id) ?? {
          name: nameFor(e.project_id),
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
