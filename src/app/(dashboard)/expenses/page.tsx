'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GitCompareArrows, ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import {
  useExpensesList,
  type ExpenseListRow,
} from '@/hooks/use-expenses-list';
import { PageTitle } from '@/components/layout/page-title';
import { FilterPill } from '@/components/layout/filter-pill';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  formatCurrency,
  formatCompactKES,
  formatDate,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';

import { ExpenseKpiStrip } from '@/components/expenses/expense-kpi-strip';
import { BulkActionBar } from '@/components/expenses/bulk-action-bar';
import { ExpenseDayGroup } from '@/components/expenses/expense-day-group';
import {
  EXPENSES_LIST_GRID,
  ExpensesListRow,
} from '@/components/expenses/expenses-list-row';

type FilterTab = 'all' | 'pending' | 'approved' | 'rejected' | 'missing_receipt';

const PENDING_STATUSES = new Set(['pending_auth', 'under_review']);
const APPROVED_STATUSES = new Set(['confirmed', 'modified']);

function rowMatchesTab(row: ExpenseListRow, tab: FilterTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'pending') return PENDING_STATUSES.has(row.lifecycleStatus);
  if (tab === 'approved') return APPROVED_STATUSES.has(row.lifecycleStatus);
  if (tab === 'rejected') return row.lifecycleStatus === 'voided';
  if (tab === 'missing_receipt') {
    return (
      APPROVED_STATUSES.has(row.lifecycleStatus) &&
      (!row.receiptReference || !row.receiptReference.trim())
    );
  }
  return true;
}

export default function ExpensesPage() {
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Single-row delete state (kebab) + bulk delete state.
  const [deleteTarget, setDeleteTarget] =
    useState<ExpenseListRow | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  const { rows, dayGroups, kpis, loading, refresh } =
    useExpensesList(selectedMonth);

  const isCfo = user?.role === 'cfo';
  const canCreate = isCfo || user?.role === 'accountant';

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
    return headers;
  }

  async function deleteOne(expenseId: string, reason: string) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/expenses/delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ expense_id: expenseId, reason }),
    });
    return res.json();
  }

  async function handleDelete() {
    if (!deleteTarget || !deleteReason.trim()) return;
    setDeleting(true);
    try {
      const result = await deleteOne(deleteTarget.id, deleteReason);
      if (result.success) {
        toast.success('Expense deleted');
        setDeleteTarget(null);
        setDeleteReason('');
        refresh();
      } else {
        toast.error(result.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete expense');
    }
    setDeleting(false);
  }

  async function handleBulkDelete() {
    if (selected.size === 0 || !deleteReason.trim()) return;
    setDeleting(true);
    const ids = Array.from(selected);
    try {
      const results = await Promise.all(ids.map((id) => deleteOne(id, deleteReason)));
      const failed = results.filter((r) => !r.success);
      if (failed.length === 0) {
        toast.success(`Deleted ${ids.length} expense${ids.length === 1 ? '' : 's'}`);
      } else {
        toast.error(`Deleted ${ids.length - failed.length} of ${ids.length}; ${failed.length} failed`);
      }
      setBulkDeleteOpen(false);
      setDeleteReason('');
      setSelected(new Set());
      refresh();
    } catch {
      toast.error('Bulk delete failed');
    }
    setDeleting(false);
  }

  // Filter dropdowns options derived from rows.
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      const key = r.projectName ?? '__shared__';
      const label = r.projectName ?? 'Shared';
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  const categoryOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => r.categoryName).filter(Boolean) as string[]),
    );
  }, [rows]);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!map.has(r.enteredBy)) map.set(r.enteredBy, r.enteredByName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  // Apply filters.
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (!rowMatchesTab(r, filterTab)) return false;
      if (projectFilter !== 'all') {
        const key = r.projectName ?? '__shared__';
        if (key !== projectFilter) return false;
      }
      if (categoryFilter !== 'all' && r.categoryName !== categoryFilter)
        return false;
      if (ownerFilter !== 'all' && r.enteredBy !== ownerFilter) return false;
      return true;
    });
  }, [rows, filterTab, projectFilter, categoryFilter, ownerFilter]);

  // Day-group the filtered rows.
  const filteredDayGroups = useMemo(() => {
    const allowed = new Set(filteredRows.map((r) => r.id));
    return dayGroups
      .map((g) => {
        const filteredGroupRows = g.rows.filter((r) => allowed.has(r.id));
        return {
          ...g,
          rows: filteredGroupRows,
          totalKes: filteredGroupRows.reduce((s, r) => s + r.amountKes, 0),
          count: filteredGroupRows.length,
        };
      })
      .filter((g) => g.count > 0);
  }, [dayGroups, filteredRows]);

  // Tab counts (filtered by project/category/owner but NOT by tab).
  const baseFilteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (projectFilter !== 'all') {
        const key = r.projectName ?? '__shared__';
        if (key !== projectFilter) return false;
      }
      if (categoryFilter !== 'all' && r.categoryName !== categoryFilter)
        return false;
      if (ownerFilter !== 'all' && r.enteredBy !== ownerFilter) return false;
      return true;
    });
  }, [rows, projectFilter, categoryFilter, ownerFilter]);

  const tabCounts = useMemo(
    () => ({
      all: baseFilteredRows.length,
      pending: baseFilteredRows.filter((r) => PENDING_STATUSES.has(r.lifecycleStatus)).length,
      approved: baseFilteredRows.filter((r) => APPROVED_STATUSES.has(r.lifecycleStatus)).length,
      rejected: baseFilteredRows.filter((r) => r.lifecycleStatus === 'voided').length,
      missing_receipt: baseFilteredRows.filter(
        (r) =>
          APPROVED_STATUSES.has(r.lifecycleStatus) &&
          (!r.receiptReference || !r.receiptReference.trim()),
      ).length,
    }),
    [baseFilteredRows],
  );

  // Bulk-bar derived state.
  const selectedRows = useMemo(
    () => filteredRows.filter((r) => selected.has(r.id)),
    [filteredRows, selected],
  );
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amountKes, 0);
  const commonBudgetLabel = (() => {
    const labels = new Set(
      selectedRows.map((r) => r.budgetLabel).filter(Boolean),
    );
    return labels.size === 1 ? Array.from(labels)[0] ?? null : null;
  })();

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Expenses"
          accent={
            kpis.awaitingCount > 0
              ? `${kpis.awaitingCount} awaiting`
              : 'queue clear'
          }
          subtitle={`${formatYearMonth(selectedMonth)} · ${kpis.expenseCount} recorded · ${kpis.awaitingCount} awaiting · ${formatCompactKES(kpis.totalSpentKes)} spent month-to-date`}
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
                <Link href="/expenses/new">
                  <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" /> Record expense
                  </Button>
                </Link>
              )}
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* Quick links to queue / variance */}
        {(isCfo || user?.role === 'accountant') && (
          <div className="flex flex-wrap gap-2">
            <Link href="/expenses/queue">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ListChecks className="h-3.5 w-3.5" /> Expense queue
              </Button>
            </Link>
            {isCfo && (
              <Link href="/expenses/variance">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <GitCompareArrows className="h-3.5 w-3.5" /> Variance dashboard
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* KPI strip */}
        <ExpenseKpiStrip kpis={kpis} loading={loading} />

        {/* Bulk action bar (visible when any selected) */}
        {selected.size > 0 && (
          <BulkActionBar
            selectedCount={selected.size}
            totalKes={selectedTotal}
            commonBudgetLabel={commonBudgetLabel}
            onClear={() => setSelected(new Set())}
            actions={
              isCfo ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 border border-white/15 px-3 text-[12px] text-background hover:bg-white/10"
                  onClick={() => {
                    setDeleteReason('');
                    setBulkDeleteOpen(true);
                  }}
                >
                  Delete {selected.size}
                </Button>
              ) : null
            }
          />
        )}

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            label="All"
            count={tabCounts.all}
            active={filterTab === 'all'}
            onClick={() => setFilterTab('all')}
          />
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
          <FilterPill
            label="Rejected"
            count={tabCounts.rejected}
            active={filterTab === 'rejected'}
            onClick={() => setFilterTab('rejected')}
          />
          <FilterPill
            label="Missing receipt"
            count={tabCounts.missing_receipt}
            active={filterTab === 'missing_receipt'}
            onClick={() => setFilterTab('missing_receipt')}
          />

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={projectFilter} onValueChange={(v) => v && setProjectFilter(v)}>
              <SelectTrigger className="h-8 w-[180px] text-[12px]">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoryFilter}
              onValueChange={(v) => v && setCategoryFilter(v)}
            >
              <SelectTrigger className="h-8 w-[170px] text-[12px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ownerFilter}
              onValueChange={(v) => v && setOwnerFilter(v)}
            >
              <SelectTrigger className="h-8 w-[160px] text-[12px]">
                <SelectValue placeholder="Any owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any owner</SelectItem>
                {ownerOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>

        {/* List frame with day-grouped rows */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div
            className={cn(
              'grid items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
              EXPENSES_LIST_GRID,
            )}
          >
            <span aria-hidden />
            <span>Date</span>
            <span>Expense</span>
            <span>Project</span>
            <span>Budget</span>
            <span>Category</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Status</span>
            <span aria-hidden />
          </div>

          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : filteredDayGroups.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No expenses for {formatYearMonth(selectedMonth)}
            </div>
          ) : (
            filteredDayGroups.map((g) => (
              <div key={g.dateKey}>
                <ExpenseDayGroup
                  date={g.date}
                  totalKes={g.totalKes}
                  count={g.count}
                  isToday={g.isToday}
                />
                {g.rows.map((row) => (
                  <ExpensesListRow
                    key={row.id}
                    row={row}
                    selected={selected.has(row.id)}
                    onToggleSelect={() => toggleSelect(row.id)}
                    actions={{
                      canDelete: isCfo,
                      onDelete: () => {
                        setDeleteTarget(row);
                        setDeleteReason('');
                      },
                    }}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Single-row Delete dialog (preserved verbatim from prior implementation) */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="rounded-md border border-danger/30 bg-danger-soft/50 p-3">
                <p className="text-sm font-medium text-danger-soft-foreground">
                  You are about to permanently delete this expense:
                </p>
                <div className="mt-2 space-y-1 text-sm text-danger-soft-foreground">
                  <p>
                    <strong>{deleteTarget.description}</strong>
                  </p>
                  <p>
                    {deleteTarget.projectName ?? 'Shared'} ·{' '}
                    {formatDate(deleteTarget.expenseDate)}
                  </p>
                  <p className="font-mono font-semibold">
                    {formatCurrency(deleteTarget.amountKes, 'KES')}
                  </p>
                </div>
              </div>
              <div>
                <Label className="text-sm">
                  Reason for deletion{' '}
                  <span className="text-danger-soft-foreground">*</span>
                </Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why is this expense being deleted?"
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting || !deleteReason.trim()}
                >
                  {deleting ? 'Deleting…' : 'Delete expense'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk-delete dialog (CFO) */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} expenses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-danger/30 bg-danger-soft/50 p-3 text-sm text-danger-soft-foreground">
              Selected total:{' '}
              <span className="font-mono font-semibold">
                {formatCurrency(selectedTotal, 'KES')}
              </span>
            </div>
            <div>
              <Label className="text-sm">
                Reason for deletion{' '}
                <span className="text-danger-soft-foreground">*</span>
              </Label>
              <Textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Same reason will be applied to all selected expenses."
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleBulkDelete}
                disabled={deleting || !deleteReason.trim()}
              >
                {deleting ? 'Deleting…' : `Delete ${selected.size}`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
