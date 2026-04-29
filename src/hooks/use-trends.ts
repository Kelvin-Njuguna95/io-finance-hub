'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Read-side composer for the Trends & Analytics report.
 *
 * Per Phase 4 Session B D6:
 *   - Revenue from `lagged_revenue_company_month` (the company-level
 *     aggregate view) — total_revenue_kes per expense_month.
 *   - Expenses from `expenses` filtered to lifecycle_status='confirmed',
 *     grouped by year_month and expense_type
 *     (`project_expense` vs `shared_expense`).
 *   - Headcount per month from `agent_counts` summed across projects.
 *
 * Window: trailing 12 months from the requested `yearMonth`. The
 * seasonality series additionally pulls the prior 12-month window so we
 * can place a YoY comparison alongside when 13+ months of data exist.
 *
 * No project-name resolution — this is a company-level view. We never
 * embed `projects(name)` against a SQL view (lesson banked from the
 * profitability hotfix), but here we simply do not need it.
 *
 * TODO: Phase 4 Session B+ — YoY compare and Forecast tabs.
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const TREND_MONTHS = 12;
const MOVING_AVG_WINDOW = 3;

export type TrendsSummary = {
  monthLabel: string;
  /** Compounded month-on-month over the window. Null when fewer than
   *  2 months of revenue data are available. */
  revenueCAGR: number | null;
  /** Margin% (latest) − Margin% (12 months ago), in pts. Null when the
   *  start month has zero revenue. */
  marginTrajectoryPts: number | null;
  /** Latest-month total expenses / total headcount. Null when headcount
   *  is missing. */
  costPerAgentLatest: number | null;
  /** YoY delta of cost per agent. Null when prior-year data unavailable. */
  costPerAgentYoYDeltaPct: number | null;
  /** Calendar month label (e.g. "November") of the highest-revenue month
   *  in the trailing window. Null when no revenue data. */
  seasonalityPeak: string | null;
};

export type RevenueTrendPoint = {
  month: string;
  label: string;
  revenueKes: number;
  /** 3-month trailing simple moving average. Null until we have
   *  MOVING_AVG_WINDOW points worth of data. */
  threeMonthMA: number | null;
};

export type MarginTrendPoint = {
  month: string;
  label: string;
  marginPct: number;
  marginKes: number;
};

export type CostStructurePoint = {
  month: string;
  label: string;
  projectExpensesKes: number;
  sharedExpensesKes: number;
};

export type SeasonalityPoint = {
  /** "JAN", "FEB", … — calendar month, year-agnostic. */
  monthShort: string;
  /** ISO calendar-month index 1..12, used for x-axis ordering. */
  monthIndex: number;
  currentYearKes: number;
  /** Prior year value if a 13+-month window has data; null otherwise. */
  priorYearKes: number | null;
};

type LaggedCompanyRow = {
  expense_month: string;
  total_revenue_kes: number | string | null;
  total_expenses_kes: number | string | null;
};

type ExpenseAggRow = {
  year_month: string;
  expense_type: 'project_expense' | 'shared_expense';
  amount_kes: number | string | null;
};

type AgentCountRow = {
  year_month: string;
  agent_count: number | string | null;
};

// ---------- helpers ----------

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

function fullMonthName(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'long',
  }).format(new Date(y, m - 1, 1));
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

function monthIndex(yearMonth: string): number {
  const [, m] = yearMonth.split('-').map(Number);
  return Number.isFinite(m) ? m : 0;
}

function marginPctFor(revenueKes: number, expensesKes: number): number {
  if (revenueKes <= 0) return 0;
  return ((revenueKes - expensesKes) / revenueKes) * 100;
}

// ---------- hook ----------

export function useTrends(yearMonth: string) {
  const [summary, setSummary] = useState<TrendsSummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    revenueCAGR: null,
    marginTrajectoryPts: null,
    costPerAgentLatest: null,
    costPerAgentYoYDeltaPct: null,
    seasonalityPeak: null,
  }));
  const [revenueTrend, setRevenueTrend] = useState<RevenueTrendPoint[]>([]);
  const [marginTrend, setMarginTrend] = useState<MarginTrendPoint[]>([]);
  const [costStructure, setCostStructure] = useState<CostStructurePoint[]>([]);
  const [seasonality, setSeasonality] = useState<SeasonalityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const window12 = lookbackMonths(yearMonth, TREND_MONTHS);
    // Pull 24 months for seasonality YoY when available.
    const window24 = lookbackMonths(yearMonth, TREND_MONTHS * 2);

    try {
      const [
        companyRes,
        expensesRes,
        agentCountsRes,
      ] = await Promise.all([
        supabase
          .from('lagged_revenue_company_month')
          .select('expense_month, total_revenue_kes, total_expenses_kes')
          .in('expense_month', window24),
        supabase
          .from('expenses')
          .select('year_month, expense_type, amount_kes')
          .in('year_month', window24)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('agent_counts')
          .select('year_month, agent_count')
          .in('year_month', window24),
      ]);

      const companyRows = (companyRes.data ?? []) as LaggedCompanyRow[];
      const expenseRows = (expensesRes.data ?? []) as ExpenseAggRow[];
      const agentRows = (agentCountsRes.data ?? []) as AgentCountRow[];

      // ---- Bucket by month ----
      const revenueByMonth = new Map<string, number>();
      const expensesFromViewByMonth = new Map<string, number>();
      for (const r of companyRows) {
        revenueByMonth.set(
          r.expense_month,
          (revenueByMonth.get(r.expense_month) ?? 0) +
            Number(r.total_revenue_kes ?? 0),
        );
        expensesFromViewByMonth.set(
          r.expense_month,
          (expensesFromViewByMonth.get(r.expense_month) ?? 0) +
            Number(r.total_expenses_kes ?? 0),
        );
      }
      const projectExpensesByMonth = new Map<string, number>();
      const sharedExpensesByMonth = new Map<string, number>();
      for (const e of expenseRows) {
        const amt = Number(e.amount_kes ?? 0);
        if (e.expense_type === 'project_expense') {
          projectExpensesByMonth.set(
            e.year_month,
            (projectExpensesByMonth.get(e.year_month) ?? 0) + amt,
          );
        } else if (e.expense_type === 'shared_expense') {
          sharedExpensesByMonth.set(
            e.year_month,
            (sharedExpensesByMonth.get(e.year_month) ?? 0) + amt,
          );
        }
      }
      const headcountByMonth = new Map<string, number>();
      for (const a of agentRows) {
        headcountByMonth.set(
          a.year_month,
          (headcountByMonth.get(a.year_month) ?? 0) +
            Number(a.agent_count ?? 0),
        );
      }

      // Total expenses per month: prefer the explicit project+shared sum
      // (architectural rule says expense aggregates feeding numbers must
      // filter lifecycle_status='confirmed'; doing that on the source
      // table here is the single source of truth).
      const totalExpensesByMonth = new Map<string, number>();
      const allMonths = new Set<string>([
        ...projectExpensesByMonth.keys(),
        ...sharedExpensesByMonth.keys(),
      ]);
      for (const m of allMonths) {
        totalExpensesByMonth.set(
          m,
          (projectExpensesByMonth.get(m) ?? 0) +
            (sharedExpensesByMonth.get(m) ?? 0),
        );
      }

      // ---- Revenue trend (12 months, with 3-month MA) ----
      const revenueTrendOut: RevenueTrendPoint[] = window12.map((m, idx) => {
        const rev = revenueByMonth.get(m) ?? 0;
        // 3-mo MA: average of windows[idx-2..idx] when all three exist.
        let threeMonthMA: number | null = null;
        if (idx >= MOVING_AVG_WINDOW - 1) {
          let sum = 0;
          for (let k = idx - (MOVING_AVG_WINDOW - 1); k <= idx; k++) {
            sum += revenueByMonth.get(window12[k]) ?? 0;
          }
          threeMonthMA = sum / MOVING_AVG_WINDOW;
        }
        return {
          month: m,
          label: shortMonthLabel(m),
          revenueKes: rev,
          threeMonthMA,
        };
      });

      // ---- Margin trend (12 months) ----
      const marginTrendOut: MarginTrendPoint[] = window12.map((m) => {
        const rev = revenueByMonth.get(m) ?? 0;
        const exp = totalExpensesByMonth.get(m) ?? 0;
        return {
          month: m,
          label: shortMonthLabel(m),
          marginKes: rev - exp,
          marginPct: marginPctFor(rev, exp),
        };
      });

      // ---- Cost structure (12 months, stacked) ----
      const costStructureOut: CostStructurePoint[] = window12.map((m) => ({
        month: m,
        label: shortMonthLabel(m),
        projectExpensesKes: projectExpensesByMonth.get(m) ?? 0,
        sharedExpensesKes: sharedExpensesByMonth.get(m) ?? 0,
      }));

      // ---- Seasonality (current 12mo vs same calendar months a year
      //      prior, when available) ----
      const seasonalityOut: SeasonalityPoint[] = window12.map((m) => {
        const yearMonths = m.split('-').map(Number);
        const prevYearKey = `${yearMonths[0] - 1}-${String(yearMonths[1]).padStart(2, '0')}`;
        const priorYearKes = revenueByMonth.has(prevYearKey)
          ? revenueByMonth.get(prevYearKey) ?? 0
          : null;
        return {
          monthShort: shortMonthLabel(m),
          monthIndex: monthIndex(m),
          currentYearKes: revenueByMonth.get(m) ?? 0,
          priorYearKes,
        };
      });

      // ---- KPI summary ----
      // Revenue CAGR over the 12-month window: (latest/start)^(1/n)-1.
      const startKey = window12[0];
      const endKey = window12[window12.length - 1];
      const startRev = revenueByMonth.get(startKey) ?? 0;
      const endRev = revenueByMonth.get(endKey) ?? 0;
      const periods = window12.length - 1;
      const revenueCAGR =
        startRev > 0 && endRev > 0 && periods > 0
          ? (Math.pow(endRev / startRev, 1 / periods) - 1) * 100
          : null;

      const startMargin = marginPctFor(
        revenueByMonth.get(startKey) ?? 0,
        totalExpensesByMonth.get(startKey) ?? 0,
      );
      const endMargin = marginPctFor(
        revenueByMonth.get(endKey) ?? 0,
        totalExpensesByMonth.get(endKey) ?? 0,
      );
      const marginTrajectoryPts =
        revenueByMonth.get(startKey)
          ? endMargin - startMargin
          : null;

      const headLatest = headcountByMonth.get(endKey) ?? 0;
      const expLatest = totalExpensesByMonth.get(endKey) ?? 0;
      const costPerAgentLatest =
        headLatest > 0 ? expLatest / headLatest : null;

      // YoY for cost per agent: same-month-prior-year.
      const yoyEndKey = (() => {
        const [y, m] = endKey.split('-').map(Number);
        return `${y - 1}-${String(m).padStart(2, '0')}`;
      })();
      const headPrior = headcountByMonth.get(yoyEndKey) ?? 0;
      const expPrior = totalExpensesByMonth.get(yoyEndKey) ?? 0;
      const costPerAgentPrior =
        headPrior > 0 ? expPrior / headPrior : null;
      const costPerAgentYoYDeltaPct =
        costPerAgentLatest !== null && costPerAgentPrior !== null && costPerAgentPrior > 0
          ? ((costPerAgentLatest - costPerAgentPrior) / costPerAgentPrior) * 100
          : null;

      // Seasonality peak: highest-revenue month in window12.
      let peakMonth: string | null = null;
      let peakRev = -Infinity;
      for (const m of window12) {
        const rev = revenueByMonth.get(m) ?? 0;
        if (rev > peakRev) {
          peakRev = rev;
          peakMonth = m;
        }
      }
      const seasonalityPeak =
        peakMonth !== null && peakRev > 0 ? fullMonthName(peakMonth) : null;

      const newSummary: TrendsSummary = {
        monthLabel: shortMonth(yearMonth),
        revenueCAGR,
        marginTrajectoryPts,
        costPerAgentLatest,
        costPerAgentYoYDeltaPct,
        seasonalityPeak,
      };

      setSummary(newSummary);
      setRevenueTrend(revenueTrendOut);
      setMarginTrend(marginTrendOut);
      setCostStructure(costStructureOut);
      setSeasonality(seasonalityOut);
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
    revenueTrend,
    marginTrend,
    costStructure,
    seasonality,
    monthLabel: summary.monthLabel,
    loading,
    error,
    refresh: load,
  };
}
