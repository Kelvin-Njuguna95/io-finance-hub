'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useBudgetsList } from '@/hooks/use-budgets-list';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DashboardAlert } from '@/components/common/dashboard-alert';
import {
  formatCurrency,
  formatCompactKES,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { BUDGET_STATUS } from '@/lib/constants/status';
import { BudgetKpiStrip } from '@/components/budgets/budget-kpi-strip';
import {
  BudgetsListRow,
  BUDGETS_LIST_GRID,
} from '@/components/budgets/budgets-list-row';
import type { BudgetListRow } from '@/hooks/use-budgets-list';
import { cn } from '@/lib/utils';

const cfoApprovableStatuses = [
  BUDGET_STATUS.SUBMITTED,
  BUDGET_STATUS.PM_REVIEW,
  BUDGET_STATUS.PM_APPROVED,
];

type FilterTab = 'all' | 'mine' | 'pending' | 'approved';

export default function BudgetsPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [deleteTarget, setDeleteTarget] = useState<BudgetListRow | null>(null);

  const { rows, kpis, loading, refresh } = useBudgetsList(selectedMonth);

  // Security audit note: client-side role checks mirror server-side guards
  // in the /api/budgets routes. Server is authoritative.
  const canCreate =
    user?.role === 'team_leader' ||
    user?.role === 'project_manager' ||
    user?.role === 'cfo' ||
    user?.role === 'accountant' ||
    user?.role === 'department_head';
  const isAccountant = user?.role === 'accountant';
  const isCfo = user?.role === 'cfo';
  const isTl = user?.role === 'team_leader';

  const newBudgetButtonLabel =
    user?.role === 'team_leader'
      ? 'New Budget'
      : user?.role === 'accountant' || user?.role === 'cfo'
        ? 'New Project / Department Budget'
        : 'New Project Budget';

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function handleWithdraw(budgetId: string) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/budgets/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ budget_id: budgetId }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success('Budget withdrawn to draft');
      refresh();
    } else {
      toast.error(data.error);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const headers = await getAuthHeaders();
    const res = await fetch('/api/budgets/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ budget_id: deleteTarget.id }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success('Budget deleted');
      setDeleteTarget(null);
      refresh();
    } else {
      toast.error(data.error);
      setDeleteTarget(null);
    }
  }

  async function handleCfoApprove(budgetId: string) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/budgets/cfo-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ budget_id: budgetId, action: 'approve' }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success('Budget approved');
      refresh();
    } else {
      toast.error(data.error || 'Failed to approve budget');
    }
  }

  async function handlePopulateExpenses(budgetId: string) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/expense-lifecycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'auto_populate', budget_id: budgetId }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success('Expenses populated');
      refresh();
    } else {
      toast.error(data.error || 'Failed to populate expenses');
    }
  }

  // Project-grouping detection (preserved from previous implementation —
  // surfaces dual-budget situations where TL + accountant both submitted).
  const projectGroups = useMemo(() => {
    const map = new Map<string, BudgetListRow[]>();
    for (const row of rows) {
      if (!map.has(row.scopeKey)) map.set(row.scopeKey, []);
      map.get(row.scopeKey)!.push(row);
    }
    return map;
  }, [rows]);

  function canWithdraw(b: BudgetListRow): boolean {
    if (b.latestStatus !== 'submitted' && b.latestStatus !== 'pm_review') return false;
    if (isTl && b.submittedByRole === 'team_leader' && b.createdBy === user?.id) return true;
    if (isAccountant && b.submittedByRole === 'accountant' && b.createdBy === user?.id) return true;
    if (isCfo) return true;
    return false;
  }

  function canDeleteBudget(b: BudgetListRow): boolean {
    if (isCfo) return true;
    if (isAccountant && b.createdBy === user?.id) return true;
    if (b.latestStatus !== 'draft') return false;
    if (b.createdBy === user?.id) return true;
    return false;
  }

  function canCfoApproveRow(b: BudgetListRow): boolean {
    return (
      isCfo &&
      cfoApprovableStatuses.includes(
        b.latestStatus as (typeof cfoApprovableStatuses)[number],
      )
    );
  }

  function canPopulateExpensesRow(b: BudgetListRow): boolean {
    return (
      (isCfo || isAccountant) &&
      b.latestStatus === 'approved' &&
      b.pendingExpenseCount === 0
    );
  }

  // Filter rows based on tab.
  const filteredRows = useMemo(() => {
    return rows.filter((b) => {
      if (filterTab === 'all') return true;
      if (filterTab === 'mine') return b.createdBy === user?.id;
      if (filterTab === 'pending') {
        if (isCfo) {
          return cfoApprovableStatuses.includes(
            b.latestStatus as (typeof cfoApprovableStatuses)[number],
          );
        }
        return b.latestStatus === BUDGET_STATUS.PM_REVIEW;
      }
      if (filterTab === 'approved') return b.latestStatus === BUDGET_STATUS.APPROVED;
      return true;
    });
  }, [rows, filterTab, user?.id, isCfo]);

  // Tab counts (only used when pills render).
  const tabCounts = useMemo(
    () => ({
      all: rows.length,
      mine: rows.filter((b) => b.createdBy === user?.id).length,
      pending: rows.filter((b) =>
        isCfo
          ? cfoApprovableStatuses.includes(
              b.latestStatus as (typeof cfoApprovableStatuses)[number],
            )
          : b.latestStatus === BUDGET_STATUS.PM_REVIEW,
      ).length,
      approved: rows.filter((b) => b.latestStatus === BUDGET_STATUS.APPROVED).length,
    }),
    [rows, user?.id, isCfo],
  );

  // TL info notice about accountant-submitted budgets on their projects.
  const accountantBudgetsForTlProject = isTl
    ? rows.filter((b) => b.submittedByRole === 'accountant' && b.createdBy !== user?.id)
    : [];

  // Show pills only for accountant + CFO (preserves existing role gate).
  const showPills = isAccountant || isCfo;

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Budgets"
          accent={
            tabCounts.pending > 0
              ? `${tabCounts.pending} pending review`
              : 'all clear'
          }
          subtitle={`${formatYearMonth(selectedMonth)} · ${rows.length} active · ${formatCompactKES(kpis.totalCommittedKes)} committed`}
          action={
            <div className="flex items-center gap-2">
              <Select
                value={selectedMonth}
                onValueChange={(v) => v && setSelectedMonth(v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, i) => {
                    const d = new Date();
                    d.setMonth(d.getMonth() - i);
                    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    return (
                      <SelectItem key={ym} value={ym}>
                        {formatYearMonth(ym)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {canCreate && (
                <Link href="/budgets/new">
                  <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> {newBudgetButtonLabel}
                  </Button>
                </Link>
              )}
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* TL notice about accountant budgets */}
        {isTl && accountantBudgetsForTlProject.length > 0 && (
          <DashboardAlert
            variant="info"
            description={`The Accountant has also submitted ${
              accountantBudgetsForTlProject.length === 1
                ? 'a budget'
                : `${accountantBudgetsForTlProject.length} budgets`
            } for your project this month. Both are under PM review.`}
          />
        )}

        {/* KPI strip */}
        <BudgetKpiStrip kpis={kpis} loading={loading} />

        {/* Filter pills (accountant / CFO only) */}
        {showPills && (
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              label="All"
              count={tabCounts.all}
              active={filterTab === 'all'}
              onClick={() => setFilterTab('all')}
            />
            {isAccountant && (
              <FilterPill
                label="Submitted by me"
                count={tabCounts.mine}
                active={filterTab === 'mine'}
                onClick={() => setFilterTab('mine')}
              />
            )}
            <FilterPill
              label="Pending"
              count={tabCounts.pending}
              active={filterTab === 'pending'}
              onClick={() => setFilterTab('pending')}
            />
            <FilterPill
              label="Approved"
              count={tabCounts.approved}
              active={filterTab === 'approved'}
              onClick={() => setFilterTab('approved')}
            />
          </div>
        )}

        {/* List frame */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div
            className={cn(
              'grid items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5',
              "font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground",
              BUDGETS_LIST_GRID,
            )}
          >
            <span>Budget</span>
            <span>Project</span>
            <span>Owner</span>
            <span>Period</span>
            <span className="text-right">Approved · Spent</span>
            <span className="text-right">Status</span>
            <span aria-hidden />
          </div>
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No budgets for {formatYearMonth(selectedMonth)}
            </div>
          ) : (
            filteredRows.map((row) => {
              const siblings = projectGroups.get(row.scopeKey) ?? [];
              const hasSibling = siblings.length > 1;
              return (
                <BudgetsListRow
                  key={row.id}
                  row={row}
                  hasSibling={hasSibling}
                  actions={{
                    canWithdraw: canWithdraw(row),
                    canDelete: canDeleteBudget(row),
                    canCfoApprove: canCfoApproveRow(row),
                    canPopulateExpenses: canPopulateExpensesRow(row),
                    onWithdraw: () => handleWithdraw(row.id),
                    onDelete: () => setDeleteTarget(row),
                    onCfoApprove: () => handleCfoApprove(row.id),
                    onPopulateExpenses: () => handlePopulateExpenses(row.id),
                  }}
                  onClick={() => router.push(`/budgets/${row.id}`)}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Delete confirmation dialog (preserved verbatim from prior page) */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Budget</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete the budget for{' '}
              <strong>{deleteTarget?.scopeName}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DashboardAlert
            variant="error"
            description={`Amount: ${formatCurrency(deleteTarget?.approvedKes ?? 0, 'KES')} · Version ${deleteTarget?.currentVersion}`}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type FilterPillProps = {
  label: string;
  count: number;
  active: boolean;
  onClick(): void;
};

function FilterPill({ label, count, active, onClick }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:bg-muted/40',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
          active ? 'bg-background/15 text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

