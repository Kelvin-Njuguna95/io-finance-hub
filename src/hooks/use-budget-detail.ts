'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import type {
  Budget,
  BudgetVersion,
  BudgetItem,
  BudgetApproval,
} from '@/types/database';
import type { BudgetActivityEvent } from '@/components/budgets/activity-timeline';
import { formatKES } from '@/lib/utils/currency';

/**
 * Composes the existing 5 inline queries from `budgets/[id]/page.tsx`
 * with two new aggregates:
 *
 *   6. confirmed-expense roll-up for this budget (year-month-agnostic, by
 *      `budget_id`, filtered to `lifecycle_status='confirmed'` per
 *      AGENTS.md rule 2).
 *   7. `audit_logs` rows for this budget for the activity timeline.
 *
 * Schema note: the `audit_logs` table uses columns `user_id`, `action`,
 * `created_at`, `new_values`, `old_values`, `reason` (per
 * `src/types/database.ts:326-337` and migrations 00002 / 00043). The
 * Phase 2 spec listed placeholder names (`performed_by`, `performed_at`,
 * `metadata`) — we use the real columns.
 *
 * The hook does not modify any of the 5 existing query shapes; it
 * composes them. No data-layer change.
 */

type BudgetWithScope = Budget & {
  projects?: { name?: string | null } | null;
  departments?: { name?: string | null } | null;
};

type AuditLogRow = {
  id: string;
  action: string;
  user_id: string | null;
  created_at: string;
  reason: string | null;
  new_values: Record<string, unknown> | null;
};

const ACTION_VERB: Record<string, string> = {
  budget_submitted: 'submitted budget',
  budget_submitted_by_accountant: 'submitted (accountant) budget',
  budget_auto_rejected_on_cfo_approval: 'auto-rejected sibling budget',
  budget_deleted: 'deleted budget',
  cfo_budget_deleted: 'deleted budget (CFO)',
};

function humaniseAction(action: string): string {
  return (
    ACTION_VERB[action] ??
    action.replace(/_/g, ' ')
  );
}

function formatTotalIfPresent(values: Record<string, unknown> | null): string | undefined {
  if (!values) return undefined;
  const total = values.total_kes ?? values.total_amount_kes;
  if (typeof total === 'number') return formatKES(total).replace(/\.00$/, '');
  if (typeof total === 'string') {
    const n = Number(total);
    if (Number.isFinite(n)) return formatKES(n).replace(/\.00$/, '');
  }
  return undefined;
}

export function useBudgetDetail(budgetId: string | null | undefined) {
  const [budget, setBudget] = useState<BudgetWithScope | null>(null);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [approvals, setApprovals] = useState<BudgetApproval[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [spentKes, setSpentKes] = useState(0);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!budgetId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      const [budgetRes, versionsRes, expensesRes, auditRes] = await Promise.all([
        supabase
          .from('budgets')
          .select('*, projects(name), departments(name)')
          .eq('id', budgetId)
          .single(),
        supabase
          .from('budget_versions')
          .select('*')
          .eq('budget_id', budgetId)
          .order('version_number', { ascending: false }),
        supabase
          .from('expenses')
          .select('amount_kes, expense_date')
          .eq('budget_id', budgetId)
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('audit_logs')
          .select('id, action, user_id, created_at, reason, new_values')
          .eq('table_name', 'budgets')
          .eq('record_id', budgetId)
          .order('created_at', { ascending: false }),
      ]);

      const b = budgetRes.data as BudgetWithScope | null;
      if (!b) {
        setError(new Error('Budget not found'));
        setLoading(false);
        return;
      }
      setBudget(b);

      const versionRows = (versionsRes.data ?? []) as BudgetVersion[];
      setVersions(versionRows);

      // Resolve active version (default = current_version, fallback first).
      const initialActive =
        versionRows.find((v) => v.version_number === b.current_version) ??
        versionRows[0];
      setActiveVersionId((current) => current ?? initialActive?.id ?? null);

      const versionIds = versionRows.map((v) => v.id);
      const approvalsRes =
        versionIds.length > 0
          ? await supabase
              .from('budget_approvals')
              .select('*')
              .in('budget_version_id', versionIds)
              .order('created_at', { ascending: false })
          : { data: [] as BudgetApproval[] };
      setApprovals((approvalsRes.data ?? []) as BudgetApproval[]);

      // Confirmed expenses roll-up.
      const expensesData = (expensesRes.data ?? []) as Array<{
        amount_kes: number | string;
      }>;
      setSpentKes(
        expensesData.reduce((s, e) => s + Number(e.amount_kes ?? 0), 0),
      );

      // Audit logs + actor name resolution.
      const auditData = (auditRes.data ?? []) as AuditLogRow[];
      setAuditLogs(auditData);

      const userIds = new Set<string>();
      for (const row of auditData) if (row.user_id) userIds.add(row.user_id);
      for (const a of (approvalsRes.data ?? []) as BudgetApproval[]) {
        if (a.approved_by) userIds.add(a.approved_by);
      }
      for (const v of versionRows) {
        if (v.submitted_by) userIds.add(v.submitted_by);
      }

      if (userIds.size > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', Array.from(userIds));
        const map = new Map<string, string>(
          ((users ?? []) as Array<{ id: string; full_name: string }>).map(
            (u) => [u.id, u.full_name],
          ),
        );
        setUserNames(map);
      } else {
        setUserNames(new Map());
      }

      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    }
  }, [budgetId]);

  // Items are scoped to the active version — reload when switched.
  const loadItems = useCallback(async (versionId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('budget_items')
      .select('*')
      .eq('budget_version_id', versionId)
      .order('sort_order');
    setItems((data ?? []) as BudgetItem[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeVersionId) loadItems(activeVersionId);
  }, [activeVersionId, loadItems]);

  const activeVersion =
    versions.find((v) => v.id === activeVersionId) ?? null;

  // Compose events: audit_logs ∪ budget_approvals ∪ budget_versions.submitted.
  const events = useMemo<BudgetActivityEvent[]>(() => {
    const out: BudgetActivityEvent[] = [];

    for (const row of auditLogs) {
      out.push({
        at: row.created_at,
        who: row.user_id ? userNames.get(row.user_id) ?? 'Unknown' : 'System',
        verb: humaniseAction(row.action),
        num: formatTotalIfPresent(row.new_values),
        detail: row.reason ? ` · ${row.reason}` : undefined,
      });
    }

    for (const a of approvals) {
      out.push({
        at: a.created_at,
        who: userNames.get(a.approved_by) ?? 'Unknown',
        verb: a.action === 'approved' ? 'approved budget' : 'rejected budget',
        detail: a.reason ? ` · ${a.reason}` : undefined,
      });
    }

    for (const v of versions) {
      if (!v.submitted_at || !v.submitted_by) continue;
      out.push({
        at: v.submitted_at,
        who: userNames.get(v.submitted_by) ?? 'Unknown',
        verb: `submitted v${v.version_number}`,
        num: formatKES(Number(v.total_amount_kes)).replace(/\.00$/, ''),
      });
    }

    out.sort((a, b) => b.at.localeCompare(a.at));
    return out;
  }, [auditLogs, approvals, versions, userNames]);

  return {
    budget,
    versions,
    items,
    approvals,
    activeVersion,
    setActiveVersionId,
    spentKes,
    events,
    userNames,
    loading,
    error,
    refresh: load,
  };
}
