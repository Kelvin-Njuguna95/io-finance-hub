'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getBudgetsByMonth } from '@/lib/queries/budgets';
import { EXPENSE_STATUS } from '@/lib/constants/status';

/**
 * Row shape consumed by the redesigned budgets list page.
 * Camel-case mirror of the existing (snake-case) BudgetRow used in
 * `budgets/page.tsx`, augmented with a confirmed-expense aggregate.
 *
 * Field semantics match the underlying queries — `getBudgetsByMonth` for
 * the main rows, and a separate `expenses` aggregate filtered to
 * `lifecycle_status='confirmed'` for `spentKes`. Per AGENTS.md, the
 * confirmed filter is non-negotiable.
 */
export type BudgetListRow = {
  id: string;
  yearMonth: string;
  currentVersion: number;
  projectId: string | null;
  scopeName: string;
  scopeKey: string;
  isProjectScope: boolean;
  latestStatus: string;
  approvedKes: number;
  spentKes: number;
  createdBy: string;
  createdByName: string;
  submittedByRole: string;
  submittedAt: string | null;
  pendingExpenseCount: number;
};

export type BudgetKpiSummary = {
  monthLabel: string;
  totalCommittedKes: number;
  prevMonthCommittedKes: number;
  committedDeltaPct: number | null;
  budgetsCount: number;
  totalSpentKes: number;
  utilisationPct: number;
  awaitingCount: number;
  oldestAwaitingDays: number;
  overCount: number;
  overAggregateKes: number;
};

const AWAITING_STATUSES = new Set(['submitted', 'pm_review', 'pm_approved', 'under_review']);

function shortMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
  }).format(new Date(y, m - 1, 1));
}

function prevYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

export function useBudgetsList(yearMonth: string) {
  const [rows, setRows] = useState<BudgetListRow[]>([]);
  const [kpis, setKpis] = useState<BudgetKpiSummary>(() => ({
    monthLabel: shortMonthLabel(yearMonth),
    totalCommittedKes: 0,
    prevMonthCommittedKes: 0,
    committedDeltaPct: null,
    budgetsCount: 0,
    totalSpentKes: 0,
    utilisationPct: 0,
    awaitingCount: 0,
    oldestAwaitingDays: 0,
    overCount: 0,
    overAggregateKes: 0,
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      const prev = prevYearMonth(yearMonth);

      const [budgetsRes, prevBudgetsRes, expensesRes] = await Promise.all([
        getBudgetsByMonth(supabase, yearMonth),
        getBudgetsByMonth(supabase, prev),
        supabase
          .from('expenses')
          .select('budget_id, amount_kes')
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)
          .eq('year_month', yearMonth),
      ]);

      const budgetsData = (budgetsRes.data ?? []) as Array<Record<string, unknown>>;
      const prevData = (prevBudgetsRes.data ?? []) as Array<Record<string, unknown>>;
      const expensesData = (expensesRes.data ?? []) as Array<{
        budget_id: string | null;
        amount_kes: number | string;
      }>;

      const userIds = new Set<string>();
      for (const b of budgetsData) {
        if (typeof b.created_by === 'string') userIds.add(b.created_by);
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

      const spentByBudget = new Map<string, number>();
      for (const e of expensesData) {
        if (!e.budget_id) continue;
        spentByBudget.set(
          e.budget_id,
          (spentByBudget.get(e.budget_id) ?? 0) + Number(e.amount_kes ?? 0),
        );
      }

      const mapped: BudgetListRow[] = budgetsData.map((b) => {
        const versions = (b.budget_versions as Array<Record<string, unknown>> | undefined) ?? [];
        const latest =
          versions.find(
            (v) => Number(v.version_number) === Number(b.current_version),
          ) ?? versions[0];
        const projectName = (b.projects as { name?: string } | null)?.name;
        const departmentName = (b.departments as { name?: string } | null)?.name;
        const id = b.id as string;

        return {
          id,
          yearMonth: b.year_month as string,
          currentVersion: Number(b.current_version ?? 1),
          projectId: (b.project_id as string | null) ?? null,
          scopeName: projectName ?? departmentName ?? '—',
          scopeKey: projectName ?? departmentName ?? id,
          isProjectScope: Boolean(projectName),
          latestStatus: (latest?.status as string) ?? 'draft',
          approvedKes: Number(latest?.total_amount_kes ?? 0),
          spentKes: spentByBudget.get(id) ?? 0,
          createdBy: b.created_by as string,
          createdByName: nameMap.get(b.created_by as string) ?? '—',
          submittedByRole: (b.submitted_by_role as string) ?? 'team_leader',
          submittedAt: (latest?.submitted_at as string | null) ?? null,
          pendingExpenseCount: 0,
        };
      });

      // Pending-expense counts (preserve existing logic — used for
      // "Populate Expenses" gate on approved budgets).
      const ids = mapped.map((r) => r.id);
      if (ids.length > 0) {
        const { data: pending } = await supabase
          .from('pending_expenses')
          .select('budget_id')
          .in('budget_id', ids);
        const counts = new Map<string, number>();
        for (const p of (pending ?? []) as Array<{ budget_id: string | null }>) {
          if (!p.budget_id) continue;
          counts.set(p.budget_id, (counts.get(p.budget_id) ?? 0) + 1);
        }
        for (const row of mapped) {
          row.pendingExpenseCount = counts.get(row.id) ?? 0;
        }
      }

      // Sort newest submitted first; nulls last.
      mapped.sort((a, b) => {
        if (!a.submittedAt && !b.submittedAt) return 0;
        if (!a.submittedAt) return 1;
        if (!b.submittedAt) return -1;
        return b.submittedAt.localeCompare(a.submittedAt);
      });

      const totalCommittedKes = mapped
        .filter((r) => r.latestStatus === 'approved')
        .reduce((s, r) => s + r.approvedKes, 0);

      const prevCommittedKes = prevData.reduce((s, b) => {
        const versions = (b.budget_versions as Array<Record<string, unknown>> | undefined) ?? [];
        const latest =
          versions.find(
            (v) => Number(v.version_number) === Number(b.current_version),
          ) ?? versions[0];
        if ((latest?.status as string) !== 'approved') return s;
        return s + Number(latest?.total_amount_kes ?? 0);
      }, 0);

      const committedDeltaPct =
        prevCommittedKes > 0
          ? ((totalCommittedKes - prevCommittedKes) / prevCommittedKes) * 100
          : null;

      const totalSpentKes = mapped.reduce((s, r) => s + r.spentKes, 0);
      const utilisationPct =
        totalCommittedKes > 0 ? (totalSpentKes / totalCommittedKes) * 100 : 0;

      const awaiting = mapped.filter((r) => AWAITING_STATUSES.has(r.latestStatus));
      const oldestAwaitingDays = awaiting.reduce((max, r) => {
        const d = daysSince(r.submittedAt);
        return d > max ? d : max;
      }, 0);

      const overRows = mapped.filter(
        (r) => r.approvedKes > 0 && r.spentKes > r.approvedKes,
      );
      const overAggregateKes = overRows.reduce(
        (s, r) => s + (r.spentKes - r.approvedKes),
        0,
      );

      setRows(mapped);
      setKpis({
        monthLabel: shortMonthLabel(yearMonth),
        totalCommittedKes,
        prevMonthCommittedKes: prevCommittedKes,
        committedDeltaPct,
        budgetsCount: mapped.length,
        totalSpentKes,
        utilisationPct,
        awaitingCount: awaiting.length,
        oldestAwaitingDays,
        overCount: overRows.length,
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

  return { rows, kpis, loading, error, refresh: load };
}
