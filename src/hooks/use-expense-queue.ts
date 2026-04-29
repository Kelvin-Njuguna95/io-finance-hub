'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { getPendingExpensesByMonth } from '@/lib/queries/expenses';
import type { UserRole } from '@/types/database';

/**
 * Read-side composer for the expense queue surface.
 *
 * Composes:
 *   1. `pending_expenses` rows for the month (preserves the existing
 *      query helper).
 *   2. Confirmed expenses for the same month, grouped by `budget_id` —
 *      used to detect already-over-plan budgets and to compute the
 *      "would lift line to N%" projection per row.
 *   3. The active version's approved totals for each linked budget.
 *   4. User-name resolution for stalled-cell display.
 *
 * Schema reality (vs the design's 6-stage kanban):
 *   - `pending_expenses.status` has 6 values: pending_auth, confirmed,
 *     under_review, modified, voided, carried_forward.
 *   - terminal: confirmed / voided / carried_forward (drop from queue).
 *   - in queue: pending_auth / under_review / modified.
 *   - "your turn" for accountant + CFO = pending_auth rows.
 *   - "in flight elsewhere" = under_review + modified, plus pending_auth
 *     when the viewer is a non-decider role (PM/TL/dept head).
 */

const NAIROBI_TZ = 'Africa/Nairobi';
const QUEUE_STATUSES = new Set<string>([
  EXPENSE_STATUS.PENDING_AUTH,
  EXPENSE_STATUS.UNDER_REVIEW,
  EXPENSE_STATUS.MODIFIED,
]);

const SLA_THRESHOLD_HOURS = 48;
const STALLED_THRESHOLD_HOURS = 48;

export type PendingExpenseRow = {
  id: string;
  description: string;
  category: string | null;
  projectId: string | null;
  departmentId: string | null;
  projectName: string | null;
  departmentName: string | null;
  budgetId: string;
  budgetLabel: string;
  /** 0..100, computed from already-confirmed spend on the linked budget. */
  budgetUtilizationPct: number;
  /** Projected utilization if this item is approved. */
  budgetProjectedPct: number;
  budgetIsOver: boolean;
  /** True when approving this item would push the budget over plan. */
  wouldPushOver: boolean;
  budgetedAmountKes: number;
  actualAmountKes: number | null;
  status: string;
  reason: string | null;
  yearMonth: string;
  createdAt: string;
  ageHours: number;
  isOverSla: boolean;
  reviewerName: string | null;
  /** Two-letter initials for avatar tile. */
  submitterInitials: string;
};

export type AgeBand = {
  key: 'fresh' | 'recent' | 'warm' | 'overdue';
  label: string;
  count: number;
  totalKes: number;
  tone: 'cool' | 'warm' | 'danger';
};

export type QueueSummary = {
  inQueue: { totalKes: number; count: number; medianAgeHours: number };
  yourTurn: {
    role: string;
    count: number;
    totalKes: number;
    oldestAgeHours: number;
  };
  overPlan: {
    count: number;
    budgetLabels: string[];
    comboOverKes: number;
  };
  stalled: {
    count: number;
    reviewerNames: string[];
    thresholdHours: number;
  };
};

export type TriageSection = {
  key: 'your-turn' | 'in-flight';
  title: string;
  totalKes: number;
  count: number;
  rows: PendingExpenseRow[];
  isYourTurn: boolean;
};

function compactBudgetLabel(yearMonth: string, id: string): string {
  const [y, m] = yearMonth.split('-');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `BUD-${y}${m}-${tail}`;
}

function initialsFor(name: string | undefined | null): string {
  if (!name) return '—';
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '—';
}

function ageHours(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function isDeciderRole(role: UserRole | null | undefined): boolean {
  return role === 'cfo' || role === 'accountant';
}

function shortRoleLabel(role: UserRole | null | undefined): string {
  if (role === 'cfo') return 'CFO';
  if (role === 'accountant') return 'Accountant';
  if (role === 'project_manager') return 'PM';
  if (role === 'team_leader') return 'TL';
  if (role === 'department_head') return 'Dept head';
  return 'Viewer';
}

function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'short',
  }).format(new Date(y, m - 1, 1));
}

export function useExpenseQueue(
  yearMonth: string,
  userRole: UserRole | null | undefined,
) {
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      // Existing query helper — preserves the canonical fetch shape.
      const pendingRes = await getPendingExpensesByMonth(supabase, yearMonth);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pendingData = (pendingRes.data ?? []) as any[];

      // Confirmed expenses for this month — used for both per-budget
      // utilization and the "would push over" projection.
      const { data: confirmedRows } = await supabase
        .from('expenses')
        .select('budget_id, amount_kes')
        .eq('year_month', yearMonth)
        .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED);

      const spentByBudget = new Map<string, number>();
      for (const e of (confirmedRows ?? []) as Array<{
        budget_id: string | null;
        amount_kes: number | string;
      }>) {
        if (!e.budget_id) continue;
        spentByBudget.set(
          e.budget_id,
          (spentByBudget.get(e.budget_id) ?? 0) + Number(e.amount_kes ?? 0),
        );
      }

      // Approved totals per linked budget. Pull each budget's active
      // version row.
      const budgetIds = Array.from(
        new Set(
          pendingData
            .map((p) => p.budget_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const approvedByBudget = new Map<
        string,
        { totalKes: number; label: string }
      >();

      if (budgetIds.length > 0) {
        const { data: budgets } = await supabase
          .from('budgets')
          .select(
            'id, year_month, current_version, budget_versions(version_number, total_amount_kes)',
          )
          .in('id', budgetIds);

        for (const b of (budgets ?? []) as Array<{
          id: string;
          year_month: string;
          current_version: number;
          budget_versions: Array<{
            version_number: number;
            total_amount_kes: number | string;
          }>;
        }>) {
          const versions = b.budget_versions ?? [];
          const active =
            versions.find((v) => v.version_number === b.current_version) ??
            versions[0];
          approvedByBudget.set(b.id, {
            totalKes: Number(active?.total_amount_kes ?? 0),
            label: compactBudgetLabel(b.year_month, b.id),
          });
        }
      }

      // Resolve user names for "stalled" cell + reviewer column.
      // pending_expenses doesn't store the reviewer-of-record yet;
      // we surface the role-based name from the page's user.
      // For submitter initials, we derive from `description` is not
      // ideal, but pending_expenses has no `submitted_by` column. Use
      // a fallback "—" until a future change wires it in.
      const mapped: PendingExpenseRow[] = pendingData.map((p) => {
        const budgetId = p.budget_id as string;
        const approved = approvedByBudget.get(budgetId);
        const spent = spentByBudget.get(budgetId) ?? 0;
        const approvedKes = approved?.totalKes ?? 0;
        const utilizationPct =
          approvedKes > 0 ? (spent / approvedKes) * 100 : 0;
        const projectedSpent = spent + Number(p.budgeted_amount_kes ?? 0);
        const projectedPct =
          approvedKes > 0 ? (projectedSpent / approvedKes) * 100 : 0;
        const wouldPushOver =
          approvedKes > 0 &&
          spent <= approvedKes &&
          projectedSpent > approvedKes;
        const isOver = approvedKes > 0 && spent > approvedKes;

        const hours = ageHours(p.created_at as string);

        return {
          id: p.id as string,
          description: (p.description as string) ?? '',
          category: (p.category as string | null) ?? null,
          projectId: (p.project_id as string | null) ?? null,
          departmentId: (p.department_id as string | null) ?? null,
          projectName:
            (p.projects?.name as string | undefined) ?? null,
          departmentName:
            (p.departments?.name as string | undefined) ?? null,
          budgetId,
          budgetLabel: approved?.label ?? '—',
          budgetUtilizationPct: utilizationPct,
          budgetProjectedPct: projectedPct,
          budgetIsOver: isOver,
          wouldPushOver,
          budgetedAmountKes: Number(p.budgeted_amount_kes ?? 0),
          actualAmountKes:
            p.actual_amount_kes != null
              ? Number(p.actual_amount_kes)
              : null,
          status: (p.status as string) ?? EXPENSE_STATUS.PENDING_AUTH,
          reason: (p.reason as string | null) ?? null,
          yearMonth: (p.year_month as string) ?? yearMonth,
          createdAt: p.created_at as string,
          ageHours: hours,
          isOverSla: hours >= SLA_THRESHOLD_HOURS,
          reviewerName: null,
          submitterInitials: initialsFor(
            (p.projects?.name as string | undefined) ??
              (p.departments?.name as string | undefined),
          ),
        };
      });

      setItems(mapped);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  // Items in queue (pending_auth / under_review / modified).
  const inQueueItems = useMemo(
    () => items.filter((i) => QUEUE_STATUSES.has(i.status)),
    [items],
  );

  const isDecider = isDeciderRole(userRole);

  // Your-turn items: pending_auth, viewer is decider role.
  const yourTurnItems = useMemo(
    () =>
      isDecider
        ? inQueueItems.filter((i) => i.status === EXPENSE_STATUS.PENDING_AUTH)
        : [],
    [inQueueItems, isDecider],
  );

  const inFlightItems = useMemo(
    () =>
      inQueueItems.filter((i) => !yourTurnItems.includes(i)),
    [inQueueItems, yourTurnItems],
  );

  const summary = useMemo<QueueSummary>(() => {
    const queueAges = inQueueItems.map((i) => i.ageHours);
    const queueTotal = inQueueItems.reduce(
      (s, i) => s + i.budgetedAmountKes,
      0,
    );

    const yourTurnTotal = yourTurnItems.reduce(
      (s, i) => s + i.budgetedAmountKes,
      0,
    );
    const yourTurnOldest = yourTurnItems.reduce(
      (max, i) => (i.ageHours > max ? i.ageHours : max),
      0,
    );

    const overPlanItems = inQueueItems.filter((i) => i.budgetIsOver);
    const overPlanLabels = Array.from(
      new Set(overPlanItems.map((i) => i.budgetLabel).filter(Boolean)),
    );
    const overPlanCombo = overPlanItems.reduce(
      (s, i) => s + i.budgetedAmountKes,
      0,
    );

    const stalled = inQueueItems.filter(
      (i) => i.ageHours >= STALLED_THRESHOLD_HOURS,
    );
    const stalledNames = Array.from(
      new Set(stalled.map((i) => i.reviewerName).filter((n): n is string => Boolean(n))),
    );

    return {
      inQueue: {
        totalKes: queueTotal,
        count: inQueueItems.length,
        medianAgeHours: median(queueAges),
      },
      yourTurn: {
        role: shortRoleLabel(userRole),
        count: yourTurnItems.length,
        totalKes: yourTurnTotal,
        oldestAgeHours: yourTurnOldest,
      },
      overPlan: {
        count: overPlanItems.length,
        budgetLabels: overPlanLabels,
        comboOverKes: overPlanCombo,
      },
      stalled: {
        count: stalled.length,
        reviewerNames: stalledNames,
        thresholdHours: STALLED_THRESHOLD_HOURS,
      },
    };
  }, [inQueueItems, yourTurnItems, userRole]);

  const ageBands = useMemo<AgeBand[]>(() => {
    const bands: AgeBand[] = [
      { key: 'fresh', label: '< 24 hrs', count: 0, totalKes: 0, tone: 'cool' },
      {
        key: 'recent',
        label: '1 – 2 days',
        count: 0,
        totalKes: 0,
        tone: 'cool',
      },
      {
        key: 'warm',
        label: '2 – 3 days',
        count: 0,
        totalKes: 0,
        tone: 'warm',
      },
      {
        key: 'overdue',
        label: '3 days +',
        count: 0,
        totalKes: 0,
        tone: 'danger',
      },
    ];

    for (const item of inQueueItems) {
      const h = item.ageHours;
      const band =
        h < 24
          ? bands[0]
          : h < 48
            ? bands[1]
            : h < 72
              ? bands[2]
              : bands[3];
      band.count += 1;
      band.totalKes += item.budgetedAmountKes;
    }

    return bands;
  }, [inQueueItems]);

  const triageSections = useMemo<TriageSection[]>(() => {
    return [
      {
        key: 'your-turn',
        title: `Your turn · ${shortRoleLabel(userRole)}`,
        totalKes: yourTurnItems.reduce(
          (s, i) => s + i.budgetedAmountKes,
          0,
        ),
        count: yourTurnItems.length,
        rows: yourTurnItems,
        isYourTurn: true,
      },
      {
        key: 'in-flight',
        title: 'In flight · awaiting other reviewers',
        totalKes: inFlightItems.reduce(
          (s, i) => s + i.budgetedAmountKes,
          0,
        ),
        count: inFlightItems.length,
        rows: inFlightItems,
        isYourTurn: false,
      },
    ];
  }, [yourTurnItems, inFlightItems, userRole]);

  return {
    items,
    inQueueItems,
    yourTurnItems,
    inFlightItems,
    summary,
    ageBands,
    triageSections,
    monthLabel: shortMonth(yearMonth),
    loading,
    error,
    refresh: load,
  };
}
