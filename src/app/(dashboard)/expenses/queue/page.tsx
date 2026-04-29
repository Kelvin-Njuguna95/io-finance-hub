'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import {
  useExpenseQueue,
  type PendingExpenseRow,
} from '@/hooks/use-expense-queue';
import { PageTitle } from '@/components/layout/page-title';
import { FilterPill } from '@/components/layout/filter-pill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  formatCurrency,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { cn } from '@/lib/utils';

import { QueueSummaryBar } from '@/components/expenses/queue-summary-bar';
import { AgeSpectrum } from '@/components/expenses/age-spectrum';
import { TriageHeaderRow, TriageSection } from '@/components/expenses/triage-section';
import { BulkActionBar } from '@/components/expenses/bulk-action-bar';

interface Project {
  id: string;
  name: string;
}

type FilterPillKey =
  | 'all'
  | 'your_turn'
  | 'over_sla'
  | 'over_plan';

function variancePercent(budgeted: number, actual: number) {
  if (budgeted === 0) return actual === 0 ? 0 : 100;
  return ((actual - budgeted) / budgeted) * 100;
}

function varianceColor(variance: number) {
  if (variance < 0) return 'text-success-soft-foreground';
  if (variance > 0) return 'text-danger-soft-foreground';
  return 'text-muted-foreground';
}

function getMonthOptions() {
  return Array.from({ length: 19 }, (_, idx) => {
    const i = idx - 12;
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }).reverse();
}

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

export default function ExpenseQueuePage() {
  const { user } = useUser();
  const supabase = createClient();

  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [filterPill, setFilterPill] = useState<FilterPillKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hasPendingItems, setHasPendingItems] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);

  const yourTurnAnchorRef = useRef<HTMLDivElement | null>(null);

  // Dialog state — preserved verbatim from prior implementation.
  const [confirmDialog, setConfirmDialog] =
    useState<PendingExpenseRow | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [voidDialog, setVoidDialog] = useState<PendingExpenseRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [modifyDialog, setModifyDialog] =
    useState<PendingExpenseRow | null>(null);
  const [modifyAmount, setModifyAmount] = useState('');
  const [modifyReason, setModifyReason] = useState('');

  const [processing, setProcessing] = useState(false);

  const canAct = user?.role === 'cfo' || user?.role === 'accountant';

  const {
    items,
    inQueueItems,
    yourTurnItems,
    summary,
    ageBands,
    triageSections,
    monthLabel,
    loading,
    refresh,
  } = useExpenseQueue(selectedMonth, user?.role ?? null);

  // Categories derived from items (preserved logic).
  const categories = useMemo(
    () =>
      Array.from(
        new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c))),
      ),
    [items],
  );

  // Backfill banner state — preserved.
  useEffect(() => {
    async function checkPendingItemsExist() {
      const { data } = await supabase
        .from('pending_expenses')
        .select('year_month')
        .eq('status', 'pending_auth')
        .order('year_month', { ascending: false })
        .limit(1)
        .maybeSingle();
      setHasPendingItems(Boolean(data?.year_month));
    }
    checkPendingItemsExist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project list — preserved.
  useEffect(() => {
    async function loadProjects() {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setProjects((data as Project[] | null) ?? []);
    }
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime channel subscription — PRESERVED VERBATIM. The hook
  // re-fetches via `refresh()` whenever pending_expenses or expenses
  // changes upstream.
  useEffect(() => {
    const channel = supabase
      .channel(`expense-queue-${selectedMonth}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pending_expenses' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  useEffect(() => {
    setSelected(new Set());
  }, [selectedMonth]);

  // -----------------------------------------------
  // API helpers (preserved verbatim apart from refresh→load rename)
  // -----------------------------------------------

  async function callAction(action: string, payload: Record<string, unknown>) {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/expense-lifecycle', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  }

  async function handleConfirm() {
    if (!confirmDialog) return;
    const amount = parseFloat(confirmAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    try {
      await callAction('confirm', { id: confirmDialog.id, actual_amount_kes: amount });
      toast.success('Expense confirmed');
      setConfirmDialog(null);
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to confirm');
    }
  }

  async function handleVoid() {
    if (!voidDialog) return;
    if (!voidReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    try {
      await callAction('void', { id: voidDialog.id, void_reason: voidReason });
      toast.success('Expense voided');
      setVoidDialog(null);
      setVoidReason('');
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to void');
    }
  }

  async function handleModify() {
    if (!modifyDialog) return;
    const amount = parseFloat(modifyAmount);
    if (isNaN(amount) || amount < 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (!modifyReason.trim()) {
      toast.error('Please provide a reason');
      return;
    }
    try {
      await callAction('modify', {
        id: modifyDialog.id,
        actual_amount_kes: amount,
        modified_reason: modifyReason,
      });
      toast.success('Expense modified');
      setModifyDialog(null);
      setModifyAmount('');
      setModifyReason('');
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to modify');
    }
  }

  // Preserved (unwired in new layout — kept for completeness per spec).
  async function handleCarryForward(item: PendingExpenseRow) {
    const reason = 'Carry forward';
    const targetMonth = new Date(
      new Date(selectedMonth + '-01').setMonth(
        new Date(selectedMonth + '-01').getMonth() + 1,
      ),
    )
      .toISOString()
      .slice(0, 7);
    if (targetMonth <= selectedMonth) {
      toast.error('Target month must be after the selected month');
      return;
    }
    try {
      await callAction('carry_forward', {
        id: item.id,
        carry_reason: reason.trim(),
        target_month: targetMonth.trim(),
      });
      toast.success('Expense carried forward');
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to carry forward');
    }
  }

  async function handleFlagForReview(item: PendingExpenseRow) {
    const reviewNotes = 'Asked for changes';
    try {
      await callAction('under_review', { id: item.id, review_notes: reviewNotes });
      toast.success('Sent back for changes');
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to flag');
    }
  }

  async function handleBulkConfirm() {
    setProcessing(true);
    const toConfirm = yourTurnItems.filter(
      (i) => selected.has(i.id) && i.status === EXPENSE_STATUS.PENDING_AUTH,
    );
    if (toConfirm.length === 0) {
      toast.error('No pending items selected');
      setProcessing(false);
      return;
    }
    try {
      await Promise.all(
        toConfirm.map((item) =>
          callAction('confirm', {
            id: item.id,
            actual_amount_kes: item.budgetedAmountKes,
          }),
        ),
      );
      toast.success(
        `${toConfirm.length} expense(s) confirmed at budgeted amounts`,
      );
      setSelected(new Set());
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk confirm failed');
    } finally {
      setProcessing(false);
    }
  }

  async function handleBulkCarryForward() {
    const toCarry = yourTurnItems.filter(
      (i) => selected.has(i.id) && i.status === EXPENSE_STATUS.PENDING_AUTH,
    );
    if (toCarry.length === 0) {
      toast.error('No pending items selected');
      return;
    }
    const reason = 'Bulk carry forward';
    const targetMonth = new Date(
      new Date(selectedMonth + '-01').setMonth(
        new Date(selectedMonth + '-01').getMonth() + 1,
      ),
    )
      .toISOString()
      .slice(0, 7);
    try {
      await Promise.all(
        toCarry.map((item) =>
          callAction('carry_forward', {
            id: item.id,
            carry_reason: reason.trim(),
            target_month: targetMonth.trim(),
          }),
        ),
      );
      toast.success(`${toCarry.length} expense(s) carried forward`);
      setSelected(new Set());
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk carry forward failed');
    }
  }

  // Touch the unwired helpers so TS tree-shaker doesn't flag them
  // unused — they remain available behind the data layer per spec.
  void handleCarryForward;
  void handleBulkCarryForward;

  // Per-row direct actions (preferred path for "your turn" rows).
  async function rowApprove(item: PendingExpenseRow) {
    try {
      setProcessing(true);
      await callAction('confirm', {
        id: item.id,
        actual_amount_kes: item.budgetedAmountKes,
      });
      toast.success('Approved at budgeted amount');
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Approve failed');
    } finally {
      setProcessing(false);
    }
  }

  // -----------------------------------------------
  // Filtering
  // -----------------------------------------------
  function applyAuxFilters(rows: PendingExpenseRow[]): PendingExpenseRow[] {
    return rows.filter((row) => {
      if (projectFilter !== 'all' && row.projectId !== projectFilter) return false;
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (filterPill === 'your_turn' && !yourTurnItems.includes(row)) return false;
      if (filterPill === 'over_sla' && !row.isOverSla) return false;
      if (filterPill === 'over_plan' && !row.budgetIsOver) return false;
      return true;
    });
  }

  const filteredSections = useMemo(() => {
    return triageSections.map((section) => {
      const rows = applyAuxFilters(section.rows);
      return {
        ...section,
        rows,
        count: rows.length,
        totalKes: rows.reduce((s, r) => s + r.budgetedAmountKes, 0),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triageSections, projectFilter, categoryFilter, filterPill, yourTurnItems]);

  const pillCounts = useMemo(
    () => ({
      all: inQueueItems.length,
      your_turn: yourTurnItems.length,
      over_sla: inQueueItems.filter((i) => i.isOverSla).length,
      over_plan: inQueueItems.filter((i) => i.budgetIsOver).length,
    }),
    [inQueueItems, yourTurnItems],
  );

  // -----------------------------------------------
  // Selection helpers
  // -----------------------------------------------
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedYourTurn = useMemo(
    () => yourTurnItems.filter((i) => selected.has(i.id)),
    [yourTurnItems, selected],
  );
  const selectedTotal = selectedYourTurn.reduce(
    (s, r) => s + r.budgetedAmountKes,
    0,
  );
  const commonBudgetLabel = (() => {
    const labels = new Set(selectedYourTurn.map((r) => r.budgetLabel).filter(Boolean));
    return labels.size === 1 ? Array.from(labels)[0] ?? null : null;
  })();

  function startReviewing() {
    yourTurnAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Review expenses"
          accent={
            summary.yourTurn.count > 0
              ? `${summary.yourTurn.count} awaiting`
              : 'queue clear'
          }
          subtitle={`${formatYearMonth(selectedMonth)} · ${summary.inQueue.count} in queue · ${summary.stalled.count} stalled`}
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
                  {getMonthOptions().map((ym) => (
                    <SelectItem key={ym} value={ym}>
                      {formatYearMonth(ym)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      </div>

      <div className="space-y-5 p-6">
        {/* Backfill banner — preserved */}
        {items.length === 0 && canAct && hasPendingItems && (
          <div className="flex items-center justify-between rounded-lg border-l-[3px] border-l-warning bg-warning-soft/50 p-4">
            <div>
              <p className="text-sm font-medium text-warning-soft-foreground">
                No pending expenses found for {monthLabel}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click below to populate expenses from all approved budgets.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const headers = await getAuthHeaders();
                const res = await fetch('/api/expense-lifecycle', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                    action: 'backfill',
                    year_month: selectedMonth,
                  }),
                });
                const result = await res.json();
                if (result.success) {
                  toast.success(
                    `Backfilled ${result.data?.total_created || 0} expense items from approved budgets`,
                  );
                  await refresh();
                } else {
                  toast.error(result.error || 'Backfill failed');
                }
              }}
            >
              Backfill from approved budgets
            </Button>
          </div>
        )}

        {/* Summary bar */}
        <QueueSummaryBar summary={summary} onStartReviewing={startReviewing} />

        {/* Age spectrum */}
        <AgeSpectrum bands={ageBands} totalCount={summary.inQueue.count} />

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            label="All in queue"
            count={pillCounts.all}
            active={filterPill === 'all'}
            onClick={() => setFilterPill('all')}
          />
          <FilterPill
            label="Your turn"
            count={pillCounts.your_turn}
            active={filterPill === 'your_turn'}
            onClick={() => setFilterPill('your_turn')}
          />
          <FilterPill
            label="Over SLA"
            count={pillCounts.over_sla}
            active={filterPill === 'over_sla'}
            onClick={() => setFilterPill('over_sla')}
          />
          <FilterPill
            label="Over-plan budget"
            count={pillCounts.over_plan}
            active={filterPill === 'over_plan'}
            onClick={() => setFilterPill('over_plan')}
          />

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              value={projectFilter}
              onValueChange={(v) => v && setProjectFilter(v)}
            >
              <SelectTrigger className="h-8 w-[180px] text-[12px]">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
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
              <SelectTrigger className="h-8 w-[160px] text-[12px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>

        {/* Bulk action bar (when any selected) */}
        {selectedYourTurn.length > 0 && (
          <BulkActionBar
            selectedCount={selectedYourTurn.length}
            totalKes={selectedTotal}
            commonBudgetLabel={commonBudgetLabel}
            onClear={() => setSelected(new Set())}
            actions={
              <Button
                size="sm"
                className="h-8 gap-1.5 border border-[var(--gold)] bg-[var(--gold)] px-3 text-[12px] font-medium text-foreground hover:bg-[var(--gold-hi)]"
                onClick={handleBulkConfirm}
                disabled={processing}
              >
                Approve all {selectedYourTurn.length}
              </Button>
            }
          />
        )}

        {/* Triage frame */}
        <div
          ref={yourTurnAnchorRef}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              Loading queue…
            </div>
          ) : (
            <>
              <TriageHeaderRow />
              {filteredSections.map((section) => (
                <TriageSection
                  key={section.key}
                  section={section}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  rowActions={(row) => ({
                    onApprove: () => rowApprove(row),
                    onAskForChanges: () => handleFlagForReview(row),
                    onReject: () => {
                      setVoidDialog(row);
                      setVoidReason('');
                    },
                  })}
                  processing={processing}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* -----------------------------------------------
          Confirm Dialog (preserved verbatim)
          ----------------------------------------------- */}
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Expense</DialogTitle>
          </DialogHeader>
          {confirmDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground/90">
                  {confirmDialog.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {confirmDialog.projectName ??
                    confirmDialog.departmentName ??
                    'No project/dept'}
                </p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Budgeted Amount
                  </Label>
                  <p className="font-mono text-sm font-medium">
                    {formatCurrency(
                      Number(confirmDialog.budgetedAmountKes),
                      'KES',
                    )}
                  </p>
                </div>
                <div>
                  <Label htmlFor="confirm-amount">Actual Amount (KES)</Label>
                  <Input
                    id="confirm-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={confirmAmount}
                    onChange={(e) => setConfirmAmount(e.target.value)}
                    className="font-mono"
                  />
                </div>
              </div>
              {confirmAmount && !isNaN(parseFloat(confirmAmount)) && (
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Variance Preview</p>
                  {(() => {
                    const v =
                      parseFloat(confirmAmount) -
                      Number(confirmDialog.budgetedAmountKes);
                    const pct = variancePercent(
                      Number(confirmDialog.budgetedAmountKes),
                      parseFloat(confirmAmount),
                    );
                    return (
                      <p
                        className={cn(
                          'font-mono text-sm font-medium',
                          varianceColor(v),
                        )}
                      >
                        {v >= 0 ? '+' : ''}
                        {formatCurrency(v, 'KES')} ({pct >= 0 ? '+' : ''}
                        {pct.toFixed(1)}%)
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Confirm Expense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -----------------------------------------------
          Void Dialog (preserved verbatim)
          ----------------------------------------------- */}
      <Dialog
        open={!!voidDialog}
        onOpenChange={(open) => !open && setVoidDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Expense</DialogTitle>
          </DialogHeader>
          {voidDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground/90">
                  {voidDialog.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Budgeted:{' '}
                  {formatCurrency(Number(voidDialog.budgetedAmountKes), 'KES')}
                </p>
              </div>
              <Separator />
              <div>
                <Label htmlFor="void-reason">Reason for voiding</Label>
                <Textarea
                  id="void-reason"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Provide a reason for voiding this expense..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoid}>
              Void Expense
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -----------------------------------------------
          Modify Dialog (preserved verbatim)
          ----------------------------------------------- */}
      <Dialog
        open={!!modifyDialog}
        onOpenChange={(open) => !open && setModifyDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify Expense</DialogTitle>
          </DialogHeader>
          {modifyDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground/90">
                  {modifyDialog.description}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Budgeted:{' '}
                  {formatCurrency(
                    Number(modifyDialog.budgetedAmountKes),
                    'KES',
                  )}
                </p>
              </div>
              <Separator />
              <div>
                <Label htmlFor="modify-amount">New Amount (KES)</Label>
                <Input
                  id="modify-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={modifyAmount}
                  onChange={(e) => setModifyAmount(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="modify-reason">Reason for modification</Label>
                <Textarea
                  id="modify-reason"
                  value={modifyReason}
                  onChange={(e) => setModifyReason(e.target.value)}
                  placeholder="Provide a reason for modifying this expense..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModifyDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleModify}>Save Modification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
