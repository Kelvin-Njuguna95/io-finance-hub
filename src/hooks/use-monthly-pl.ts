'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import type { WaterfallData, WaterfallSegment } from '@/hooks/use-variance';

/**
 * Read-side composer for the Monthly P&L report.
 *
 * Per Phase 4 Session A architectural rules:
 *   - Revenue from `lagged_revenue_by_project_month` (per-project) and
 *     `lagged_revenue_company_month` (totals). Books-of-record source.
 *   - Expenses from `expenses` filtered to lifecycle_status='confirmed'.
 *   - No materialized P&L table — everything composed at read time.
 *
 * Classification:
 *   `expenses.expense_type='project_expense'` → Cost of service (COGS),
 *      grouped by `expense_categories.name`.
 *   `expenses.expense_type='shared_expense'` → Operating expenses,
 *      grouped by `overhead_categories.name`.
 *   "Below the line" — no schema concept (depreciation, interest are
 *      not separately classified). Section omitted.
 *
 * Plan/variance columns: `planKes` and `varianceKes` are populated as
 * `0` for now — current-month plan-by-category aggregation requires
 * joining `budget_items` filtered to approved budgets, which is
 * deferred. The page renders the 4 informative columns (account /
 * current / prior / MoM) and ignores plan/variance until a follow-up
 * wires the per-category plan source.
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const REVENUE_VS_EXPENSES_MONTHS = 6;

export type PLRow = {
  account: string;
  currentKes: number;
  priorKes: number;
  momDeltaPct: number;
  planKes: number;
  varianceKes: number;
};

export type PLSectionLabel =
  | 'Revenue'
  | 'Cost of service'
  | 'Operating expenses'
  | 'Below the line';

export type PLSection = {
  label: PLSectionLabel;
  rows: PLRow[];
  subtotal: { label: string; kes: number };
};

export type RevenueVsExpensesPoint = {
  month: string;
  label: string;
  revenueKes: number;
  expensesKes: number;
};

export type MonthlyPLSummary = {
  monthLabel: string;
  netProfitKes: number;
  netMarginPct: number;
  /** Net margin movement vs prior month, in percentage points. */
  netMarginDeltaPts: number;
  revenueKes: number;
  revenueMomDeltaPct: number | null;
  expensesKes: number;
  expensesMomDeltaPct: number | null;
  /** Sum of (current - approved budget) across approved budgets this month;
   *  positive when over plan. Set to 0 when not yet wired. */
  expensesOverPlanKes: number;
  grossMarginPct: number;
  grossMarginDeltaPts: number;
  totalCogsKes: number;
  totalOpexKes: number;
};

type LaggedCompanyRow = {
  expense_month: string;
  total_revenue_kes: number | string | null;
  total_expenses_kes: number | string | null;
  gross_profit_kes: number | string | null;
};

type LaggedProjectRow = {
  project_id: string | null;
  expense_month: string;
  lagged_revenue_kes: number | string | null;
  current_expenses_kes: number | string | null;
  projects: { name?: string | null } | { name?: string | null }[] | null;
};

type ExpenseRow = {
  amount_kes: number | string | null;
  expense_type: 'project_expense' | 'shared_expense';
  expense_category_id: string | null;
  overhead_category_id: string | null;
  expense_categories: { name?: string | null } | { name?: string | null }[] | null;
  overhead_categories: { name?: string | null } | { name?: string | null }[] | null;
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

function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function buildExpenseSection(
  rows: ExpenseRow[],
  priorRows: ExpenseRow[],
  expenseType: 'project_expense' | 'shared_expense',
): { rows: PLRow[]; subtotal: number } {
  const filtered = rows.filter((r) => r.expense_type === expenseType);
  const priorFiltered = priorRows.filter((r) => r.expense_type === expenseType);

  const labelFor = (r: ExpenseRow): string => {
    if (expenseType === 'project_expense') {
      return firstName(r.expense_categories) ?? 'Uncategorized';
    }
    return firstName(r.overhead_categories) ?? 'Uncategorized overhead';
  };

  const currentByLabel = new Map<string, number>();
  for (const r of filtered) {
    const k = labelFor(r);
    currentByLabel.set(k, (currentByLabel.get(k) ?? 0) + Number(r.amount_kes ?? 0));
  }
  const priorByLabel = new Map<string, number>();
  for (const r of priorFiltered) {
    const k = labelFor(r);
    priorByLabel.set(k, (priorByLabel.get(k) ?? 0) + Number(r.amount_kes ?? 0));
  }

  const allLabels = new Set([...currentByLabel.keys(), ...priorByLabel.keys()]);
  const plRows: PLRow[] = Array.from(allLabels)
    .map((label) => {
      const currentKes = currentByLabel.get(label) ?? 0;
      const priorKes = priorByLabel.get(label) ?? 0;
      const delta = pctDelta(currentKes, priorKes);
      return {
        account: label,
        currentKes,
        priorKes,
        momDeltaPct: delta ?? 0,
        planKes: 0,
        varianceKes: currentKes,
      };
    })
    .sort((a, b) => b.currentKes - a.currentKes);

  const subtotal = plRows.reduce((s, r) => s + r.currentKes, 0);
  return { rows: plRows, subtotal };
}

export function useMonthlyPL(yearMonth: string) {
  const [summary, setSummary] = useState<MonthlyPLSummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    netProfitKes: 0,
    netMarginPct: 0,
    netMarginDeltaPts: 0,
    revenueKes: 0,
    revenueMomDeltaPct: null,
    expensesKes: 0,
    expensesMomDeltaPct: null,
    expensesOverPlanKes: 0,
    grossMarginPct: 0,
    grossMarginDeltaPts: 0,
    totalCogsKes: 0,
    totalOpexKes: 0,
  }));
  const [sections, setSections] = useState<PLSection[]>([]);
  const [revenueVsExpenses, setRevenueVsExpenses] = useState<RevenueVsExpensesPoint[]>([]);
  const [waterfall, setWaterfall] = useState<WaterfallData>({
    planKes: 0,
    segments: [],
    actualKes: 0,
    netVarianceKes: 0,
    netVariancePct: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const prev = prevYearMonth(yearMonth);
    const trail = lookbackMonths(yearMonth, REVENUE_VS_EXPENSES_MONTHS);

    try {
      const [
        currentExpensesRes,
        priorExpensesRes,
        currentRevenueRes,
        priorRevenueRes,
        revenueByProjectRes,
        trailingRevenueRes,
        trailingExpensesRes,
      ] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            'amount_kes, expense_type, expense_category_id, overhead_category_id, expense_categories(name), overhead_categories(name)',
          )
          .eq('year_month', yearMonth)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('expenses')
          .select(
            'amount_kes, expense_type, expense_category_id, overhead_category_id, expense_categories(name), overhead_categories(name)',
          )
          .eq('year_month', prev)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('lagged_revenue_company_month')
          .select('expense_month, total_revenue_kes, total_expenses_kes, gross_profit_kes')
          .eq('expense_month', yearMonth)
          .maybeSingle(),
        supabase
          .from('lagged_revenue_company_month')
          .select('expense_month, total_revenue_kes, total_expenses_kes, gross_profit_kes')
          .eq('expense_month', prev)
          .maybeSingle(),
        supabase
          .from('lagged_revenue_by_project_month')
          .select(
            'project_id, expense_month, lagged_revenue_kes, current_expenses_kes, projects(name)',
          )
          .eq('expense_month', yearMonth),
        supabase
          .from('lagged_revenue_company_month')
          .select('expense_month, total_revenue_kes, total_expenses_kes')
          .in('expense_month', trail),
        supabase
          .from('expenses')
          .select('year_month, amount_kes')
          .in('year_month', trail)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
      ]);

      const currentExpenses = (currentExpensesRes.data ?? []) as ExpenseRow[];
      const priorExpenses = (priorExpensesRes.data ?? []) as ExpenseRow[];
      const currentRevenueRow = (currentRevenueRes.data ?? null) as
        | LaggedCompanyRow
        | null;
      const priorRevenueRow = (priorRevenueRes.data ?? null) as
        | LaggedCompanyRow
        | null;
      const revenueByProject = (revenueByProjectRes.data ?? []) as LaggedProjectRow[];
      const trailingRevenue = (trailingRevenueRes.data ?? []) as Array<{
        expense_month: string;
        total_revenue_kes: number | string | null;
        total_expenses_kes: number | string | null;
      }>;
      const trailingExpenses = (trailingExpensesRes.data ?? []) as Array<{
        year_month: string;
        amount_kes: number | string | null;
      }>;

      // ---- Revenue rows (per project) ----
      const revenueRows: PLRow[] = revenueByProject.map((r) => {
        const projectName = firstName(r.projects) ?? 'Unattributed';
        const currentKes = Number(r.lagged_revenue_kes ?? 0);
        // Per-project prior revenue not loaded as a join — leave at 0 for now.
        return {
          account: `Service revenue · ${projectName}`,
          currentKes,
          priorKes: 0,
          momDeltaPct: 0,
          planKes: 0,
          varianceKes: currentKes,
        };
      });
      const totalRevenueKes = Number(currentRevenueRow?.total_revenue_kes ?? 0);
      const priorRevenueKes = Number(priorRevenueRow?.total_revenue_kes ?? 0);

      // ---- Cost of service / Operating expenses ----
      const cogs = buildExpenseSection(currentExpenses, priorExpenses, 'project_expense');
      const opex = buildExpenseSection(currentExpenses, priorExpenses, 'shared_expense');

      const totalCogs = cogs.subtotal;
      const totalOpex = opex.subtotal;
      const totalExpenses = totalCogs + totalOpex;
      const priorTotalCogs = priorExpenses
        .filter((r) => r.expense_type === 'project_expense')
        .reduce((s, r) => s + Number(r.amount_kes ?? 0), 0);
      const priorTotalOpex = priorExpenses
        .filter((r) => r.expense_type === 'shared_expense')
        .reduce((s, r) => s + Number(r.amount_kes ?? 0), 0);
      const priorTotalExpenses = priorTotalCogs + priorTotalOpex;

      // ---- Sections (Below-the-line omitted; no schema) ----
      const allSections: PLSection[] = [
        {
          label: 'Revenue',
          rows: revenueRows.sort((a, b) => b.currentKes - a.currentKes),
          subtotal: { label: 'Total revenue', kes: totalRevenueKes },
        },
        {
          label: 'Cost of service',
          rows: cogs.rows,
          subtotal: { label: 'Total cost of service', kes: totalCogs },
        },
        {
          label: 'Operating expenses',
          rows: opex.rows,
          subtotal: { label: 'Total operating expenses', kes: totalOpex },
        },
      ];

      // ---- KPI summary ----
      const grossProfitKes = totalRevenueKes - totalCogs;
      const netProfitKes = totalRevenueKes - totalExpenses;
      const netMarginPct = totalRevenueKes > 0 ? (netProfitKes / totalRevenueKes) * 100 : 0;
      const grossMarginPct = totalRevenueKes > 0 ? (grossProfitKes / totalRevenueKes) * 100 : 0;
      const priorNetProfit = priorRevenueKes - priorTotalExpenses;
      const priorNetMargin = priorRevenueKes > 0 ? (priorNetProfit / priorRevenueKes) * 100 : 0;
      const priorGrossMargin = priorRevenueKes > 0 ? ((priorRevenueKes - priorTotalCogs) / priorRevenueKes) * 100 : 0;

      const newSummary: MonthlyPLSummary = {
        monthLabel: shortMonth(yearMonth),
        netProfitKes,
        netMarginPct,
        netMarginDeltaPts: netMarginPct - priorNetMargin,
        revenueKes: totalRevenueKes,
        revenueMomDeltaPct: pctDelta(totalRevenueKes, priorRevenueKes),
        expensesKes: totalExpenses,
        expensesMomDeltaPct: pctDelta(totalExpenses, priorTotalExpenses),
        expensesOverPlanKes: 0,
        grossMarginPct,
        grossMarginDeltaPts: grossMarginPct - priorGrossMargin,
        totalCogsKes: totalCogs,
        totalOpexKes: totalOpex,
      };

      // ---- 6-month revenue vs expenses ----
      const revByMonth = new Map<string, number>();
      for (const r of trailingRevenue) {
        revByMonth.set(r.expense_month, Number(r.total_revenue_kes ?? 0));
      }
      const expByMonth = new Map<string, number>();
      for (const r of trailingExpenses) {
        expByMonth.set(
          r.year_month,
          (expByMonth.get(r.year_month) ?? 0) + Number(r.amount_kes ?? 0),
        );
      }
      const revVsExp: RevenueVsExpensesPoint[] = trail.map((m) => ({
        month: m,
        label: shortMonthLabel(m),
        revenueKes: revByMonth.get(m) ?? 0,
        expensesKes: expByMonth.get(m) ?? 0,
      }));

      // ---- Waterfall: revenue → expense category bars → net profit ----
      // Pull top 4 cost categories (largest absolute amounts) for the
      // intermediate segments; bundle the remainder under "Other".
      const allCostRows = [...cogs.rows, ...opex.rows].sort(
        (a, b) => b.currentKes - a.currentKes,
      );
      const topCosts = allCostRows.slice(0, 4);
      const restCosts = allCostRows.slice(4);
      const restTotal = restCosts.reduce((s, r) => s + r.currentKes, 0);

      const waterfallSegments: WaterfallSegment[] = topCosts.map((r, i) => ({
        id: `cost-${i}`,
        label: r.account,
        deltaKes: -r.currentKes,
        tone: 'bad',
      }));
      if (restTotal > 0) {
        waterfallSegments.push({
          id: 'cost-rest',
          label: 'Other costs',
          deltaKes: -restTotal,
          tone: 'bad',
        });
      }

      const newWaterfall: WaterfallData = {
        planKes: totalRevenueKes,
        segments: waterfallSegments,
        actualKes: netProfitKes,
        netVarianceKes: netProfitKes - totalRevenueKes,
        netVariancePct: totalRevenueKes > 0 ? (netProfitKes / totalRevenueKes) * 100 : 0,
      };

      setSummary(newSummary);
      setSections(allSections);
      setRevenueVsExpenses(revVsExp);
      setWaterfall(newWaterfall);
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
    sections,
    revenueVsExpenses,
    waterfall,
    monthLabel: summary.monthLabel,
    loading,
    error,
    refresh: load,
  };
}
