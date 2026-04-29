'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Composes the expenses list page's read-side data:
 *
 *   1. All `expenses` for the selected month — display rows include every
 *      lifecycle status (users want to see voided / pending / etc).
 *   2. Confirmed-only aggregate sum for KPI display — AGENTS.md rule 2.
 *      The pre-existing list page violated this by summing all statuses;
 *      this hook corrects it.
 *   3. Previous-month confirmed sum for the +/-X% delta.
 *   4. `pending_expenses` (separate table — see Phase 1 diagnostic) for
 *      the "Awaiting approval" KPI surface — these are budget-derived
 *      projections, not list-page expenses.
 *   5. Per-budget aggregates for the budget chip on each row plus the
 *      "Driving budget overrun" KPI.
 *
 * Categories and submitter names are resolved with secondary lookups.
 */

const NAIROBI_TZ = 'Africa/Nairobi';

export type ExpenseListRow = {
  id: string;
  expenseDate: string;
  createdAt: string;
  description: string;
  vendor: string | null;
  projectName: string | null;
  budgetId: string | null;
  budgetLabel: string;
  budgetUtilizationPct: number;
  budgetIsOver: boolean;
  categoryName: string | null;
  amountKes: number;
  lifecycleStatus: string;
  receiptReference: string | null;
  enteredBy: string;
  enteredByName: string;
};

export type ExpenseDayGroup = {
  /** ISO YYYY-MM-DD key (server-truth date string). */
  dateKey: string;
  date: Date;
  rows: ExpenseListRow[];
  totalKes: number;
  count: number;
  isToday: boolean;
};

export type ExpenseKpiSummary = {
  monthLabel: string;
  totalSpentKes: number;
  prevMonthSpentKes: number;
  spentDeltaPct: number | null;
  expenseCount: number;
  awaitingCount: number;
  awaitingTotalKes: number;
  oldestAwaitingDays: number;
  missingReceiptCount: number;
  missingReceiptOver7Days: number;
  overCount: number;
  overAggregateKes: number;
};

function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'short',
  }).format(new Date(y, m - 1, 1));
}

function prevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function compactBudgetLabel(yearMonth: string, id: string): string {
  const [y, m] = yearMonth.split('-');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `BUD-${y}${m}-${tail}`;
}

function todayKeyNairobi(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function useExpensesList(yearMonth: string) {
  const [rows, setRows] = useState<ExpenseListRow[]>([]);
  const [dayGroups, setDayGroups] = useState<ExpenseDayGroup[]>([]);
  const [kpis, setKpis] = useState<ExpenseKpiSummary>(() => ({
    monthLabel: shortMonth(yearMonth),
    totalSpentKes: 0,
    prevMonthSpentKes: 0,
    spentDeltaPct: null,
    expenseCount: 0,
    awaitingCount: 0,
    awaitingTotalKes: 0,
    oldestAwaitingDays: 0,
    missingReceiptCount: 0,
    missingReceiptOver7Days: 0,
    overCount: 0,
    overAggregateKes: 0,
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const prev = prevYearMonth(yearMonth);

    try {
      const [expensesRes, pendingRes, prevConfirmedRes] = await Promise.all([
        supabase
          .from('expenses')
          .select(
            '*, projects(name), expense_categories(name), budgets(id, year_month, current_version, budget_versions(version_number, total_amount_kes))',
          )
          .eq('year_month', yearMonth)
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('pending_expenses')
          .select('id, status, budgeted_amount_kes, created_at')
          .eq('year_month', yearMonth)
          .eq('status', EXPENSE_STATUS.PENDING_AUTH),
        supabase
          .from('expenses')
          .select('amount_kes')
          .eq('year_month', prev)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expensesData = (expensesRes.data ?? []) as any[];

      // Resolve user names for submitter display.
      const userIds = new Set<string>();
      for (const e of expensesData) {
        if (e.entered_by) userIds.add(e.entered_by);
      }
      const { data: users } = userIds.size
        ? await supabase
            .from('users')
            .select('id, full_name')
            .in('id', Array.from(userIds))
        : { data: [] as Array<{ id: string; full_name: string }> };
      const nameMap = new Map<string, string>(
        (users ?? []).map((u) => [u.id, u.full_name]),
      );

      // Build per-budget approved + confirmed-spent maps.
      const approvedByBudget = new Map<
        string,
        { totalKes: number; label: string; yearMonth: string }
      >();
      const spentByBudget = new Map<string, number>();

      for (const e of expensesData) {
        const budget = e.budgets;
        if (budget && !approvedByBudget.has(e.budget_id)) {
          const versions = (budget.budget_versions ?? []) as Array<{
            version_number: number;
            total_amount_kes: number | string;
          }>;
          const active =
            versions.find((v) => v.version_number === budget.current_version) ??
            versions[0];
          const totalKes = Number(active?.total_amount_kes ?? 0);
          approvedByBudget.set(e.budget_id, {
            totalKes,
            label: compactBudgetLabel(budget.year_month ?? yearMonth, e.budget_id),
            yearMonth: budget.year_month ?? yearMonth,
          });
        }
        if (e.lifecycle_status === EXPENSE_STATUS.CONFIRMED && e.budget_id) {
          spentByBudget.set(
            e.budget_id,
            (spentByBudget.get(e.budget_id) ?? 0) + Number(e.amount_kes ?? 0),
          );
        }
      }

      const mapped: ExpenseListRow[] = expensesData.map((e) => {
        const budgetRecord = e.budget_id
          ? approvedByBudget.get(e.budget_id)
          : undefined;
        const budgetSpent = e.budget_id
          ? spentByBudget.get(e.budget_id) ?? 0
          : 0;
        const budgetApproved = budgetRecord?.totalKes ?? 0;
        const utilizationPct =
          budgetApproved > 0 ? (budgetSpent / budgetApproved) * 100 : 0;
        const isOver = budgetApproved > 0 && budgetSpent > budgetApproved;

        return {
          id: e.id as string,
          expenseDate: e.expense_date as string,
          createdAt: e.created_at as string,
          description: (e.description as string) ?? '',
          vendor: (e.vendor as string | null) ?? null,
          projectName: (e.projects?.name as string | undefined) ?? null,
          budgetId: (e.budget_id as string | null) ?? null,
          budgetLabel: budgetRecord?.label ?? '—',
          budgetUtilizationPct: utilizationPct,
          budgetIsOver: isOver,
          categoryName: (e.expense_categories?.name as string | undefined) ?? null,
          amountKes: Number(e.amount_kes ?? 0),
          lifecycleStatus:
            (e.lifecycle_status as string) ?? EXPENSE_STATUS.CONFIRMED,
          receiptReference: (e.receipt_reference as string | null) ?? null,
          enteredBy: (e.entered_by as string) ?? '',
          enteredByName: nameMap.get(e.entered_by as string) ?? '—',
        };
      });

      // KPIs.
      const confirmed = mapped.filter(
        (r) => r.lifecycleStatus === EXPENSE_STATUS.CONFIRMED,
      );
      const totalSpentKes = confirmed.reduce((s, r) => s + r.amountKes, 0);

      const prevTotal = (
        (prevConfirmedRes.data ?? []) as Array<{ amount_kes: number | string }>
      ).reduce((s, e) => s + Number(e.amount_kes ?? 0), 0);
      const spentDeltaPct =
        prevTotal > 0
          ? ((totalSpentKes - prevTotal) / prevTotal) * 100
          : null;

      const pendingItems = (pendingRes.data ?? []) as Array<{
        id: string;
        status: string;
        budgeted_amount_kes: number | string;
        created_at: string;
      }>;
      const awaitingCount = pendingItems.length;
      const awaitingTotalKes = pendingItems.reduce(
        (s, p) => s + Number(p.budgeted_amount_kes ?? 0),
        0,
      );
      const oldestAwaitingDays = pendingItems.reduce((max, p) => {
        const d = daysSince(p.created_at);
        return d > max ? d : max;
      }, 0);

      const missingReceipt = confirmed.filter(
        (r) => !r.receiptReference || !r.receiptReference.trim(),
      );
      const missingReceiptCount = missingReceipt.length;
      const missingReceiptOver7Days = missingReceipt.filter(
        (r) => daysSince(r.expenseDate) > 7,
      ).length;

      let overCount = 0;
      let overAggregateKes = 0;
      for (const [budgetId, approved] of approvedByBudget) {
        const spent = spentByBudget.get(budgetId) ?? 0;
        if (approved.totalKes > 0 && spent > approved.totalKes) {
          overCount += 1;
          overAggregateKes += spent - approved.totalKes;
        }
      }

      // Day groups.
      const todayKey = todayKeyNairobi();
      const groupMap = new Map<string, ExpenseListRow[]>();
      for (const r of mapped) {
        const key = r.expenseDate;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(r);
      }
      const groups: ExpenseDayGroup[] = Array.from(groupMap.entries())
        .map(([dateKey, groupRows]) => ({
          dateKey,
          date: new Date(`${dateKey}T00:00:00`),
          rows: groupRows,
          totalKes: groupRows.reduce((s, r) => s + r.amountKes, 0),
          count: groupRows.length,
          isToday: dateKey === todayKey,
        }))
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

      setRows(mapped);
      setDayGroups(groups);
      setKpis({
        monthLabel: shortMonth(yearMonth),
        totalSpentKes,
        prevMonthSpentKes: prevTotal,
        spentDeltaPct,
        expenseCount: mapped.length,
        awaitingCount,
        awaitingTotalKes,
        oldestAwaitingDays,
        missingReceiptCount,
        missingReceiptOver7Days,
        overCount,
        overAggregateKes,
      });
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, dayGroups, kpis, loading, error, refresh: load };
}
