'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { toast } from 'sonner';
import { DollarSign, CheckCircle, Clock, TrendingDown } from 'lucide-react';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { getPendingExpensesByMonth } from '@/lib/queries/expenses';

// -----------------------------------------------
// Types
// -----------------------------------------------

type PendingExpenseStatus = 'pending_auth' | 'confirmed' | 'under_review' | 'modified' | 'voided' | 'carried_forward';

interface PendingExpense {
  id: string;
  description: string;
  category: string | null;
  project_id: string | null;
  department_id: string | null;
  budgeted_amount_kes: number;
  actual_amount_kes: number | null;
  status: PendingExpenseStatus;
  reason: string | null;
  year_month: string;
  created_at: string;
  projects?: { name: string } | null;
  departments?: { name: string } | null;
}

interface Project {
  id: string;
  name: string;
}

// -----------------------------------------------
// Helpers
// -----------------------------------------------

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
  return headers;
}

const STATUS_BADGE: Record<PendingExpenseStatus, string> = {
  pending_auth: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  under_review: 'bg-blue-100 text-blue-700',
  modified: 'bg-purple-100 text-purple-700',
  voided: 'bg-red-100 text-red-700',
  carried_forward: 'bg-slate-100 text-slate-600',
};

const STATUS_LABELS: Record<PendingExpenseStatus, string> = {
  pending_auth: 'Pending Auth',
  confirmed: 'Confirmed',
  under_review: 'Under Review',
  modified: 'Modified',
  voided: 'Voided',
  carried_forward: 'Carried Forward',
};

function varianceColor(variance: number) {
  if (variance < 0) return 'text-emerald-600';
  if (variance > 0) return 'text-rose-600';
  return 'text-slate-500';
}

function variancePercent(budgeted: number, actual: number) {
  if (budgeted === 0) return actual === 0 ? 0 : 100;
  return ((actual - budgeted) / budgeted) * 100;
}

// -----------------------------------------------
// Month options (12 months back)
// -----------------------------------------------

function getMonthOptions() {
  return Array.from({ length: 19 }, (_, idx) => {
    const i = idx - 12; // 12 months back through 6 months ahead
    const d = new Date();
    d.setMonth(d.getMonth() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }).reverse();
}

// -----------------------------------------------
// Page Component
// -----------------------------------------------

export default function ExpenseQueuePage() {
  const { user } = useUser();
  const supabase = createClient();

  // Filters
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Data
  const [items, setItems] = useState<PendingExpense[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasPendingItems, setHasPendingItems] = useState(true);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Dialogs
  const [confirmDialog, setConfirmDialog] = useState<PendingExpense | null>(null);
  const [confirmAmount, setConfirmAmount] = useState('');
  const [voidDialog, setVoidDialog] = useState<PendingExpense | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [modifyDialog, setModifyDialog] = useState<PendingExpense | null>(null);
  const [modifyAmount, setModifyAmount] = useState('');
  const [modifyReason, setModifyReason] = useState('');

  const canAct = user?.role === 'cfo' || user?.role === 'accountant';

  // -----------------------------------------------
  // Load data
  // -----------------------------------------------

  async function loadItems() {
    setLoading(true);
    const { data } = await getPendingExpensesByMonth(supabase, selectedMonth);

    setItems((data as PendingExpense[] | null) || []);
    setLoading(false);
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('id, name').eq('is_active', true).order('name');
    setProjects((data as Project[] | null) || []);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    async function syncToLatestPendingMonth() {
      const { data } = await supabase
        .from('pending_expenses')
        .select('year_month')
        .eq('status', 'pending_auth')
        .order('year_month', { ascending: false })
        .limit(1)
        .maybeSingle();
      setHasPendingItems(Boolean(data?.year_month));
      if (data?.year_month && data.year_month !== selectedMonth) {
        setSelectedMonth(data.year_month);
      }
    }
    syncToLatestPendingMonth();
  }, []);

  useEffect(() => {
    loadItems();
    setSelected(new Set());
  }, [selectedMonth]);

  useEffect(() => {
    const channel = supabase
      .channel(`expense-queue-${selectedMonth}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_expenses' }, () => loadItems())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadItems())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedMonth]);

  // -----------------------------------------------
  // Client-side filtering
  // -----------------------------------------------

  const filtered = useMemo(() => {
    let result = items;
    if (projectFilter !== 'all') {
      result = result.filter((i) => i.project_id === projectFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((i) => i.status === statusFilter);
    }
    if (categoryFilter !== 'all') {
      result = result.filter((i) => i.category === categoryFilter);
    }
    return result;
  }, [items, projectFilter, statusFilter, categoryFilter]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))] as string[],
    [items],
  );

  // -----------------------------------------------
  // Summary stats
  // -----------------------------------------------

  const totalBudgeted = filtered.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
  const totalConfirmed = filtered
    .filter((i) => i.status === EXPENSE_STATUS.CONFIRMED)
    .reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const pendingCount = filtered.filter((i) => i.status === EXPENSE_STATUS.PENDING_AUTH).length;
  const totalActual = filtered.reduce((s, i) => s + Number(i.actual_amount_kes || i.budgeted_amount_kes), 0);
  const overallVariance = totalActual - totalBudgeted;

  // -----------------------------------------------
  // API Actions
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
      loadItems();
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
      loadItems();
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
      await callAction('modify', { id: modifyDialog.id, actual_amount_kes: amount, modified_reason: modifyReason });
      toast.success('Expense modified');
      setModifyDialog(null);
      setModifyAmount('');
      setModifyReason('');
      loadItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to modify');
    }
  }

  async function handleCarryForward(item: PendingExpense) {
    const reason = window.prompt('Carry-forward reason (required):');
    if (!reason?.trim()) {
      toast.error('Reason is required');
      return;
    }
    const targetMonth = window.prompt('Target month (YYYY-MM):');
    if (!targetMonth?.trim()) {
      toast.error('Target month is required');
      return;
    }
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
      loadItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to carry forward');
    }
  }

  async function handleFlagForReview(item: PendingExpense) {
    const reviewNotes = window.prompt('Review reason (required):');
    if (!reviewNotes?.trim()) {
      toast.error('Review reason is required');
      return;
    }
    try {
      await callAction('under_review', { id: item.id, review_notes: reviewNotes.trim() });
      toast.success('Expense flagged for review');
      loadItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to flag');
    }
  }

  async function handleBulkConfirm() {
    const toConfirm = filtered.filter((i) => selected.has(i.id) && i.status === 'pending_auth');
    if (toConfirm.length === 0) {
      toast.error('No pending items selected');
      return;
    }
    try {
      await Promise.all(
        toConfirm.map((item) =>
          callAction('confirm', { id: item.id, actual_amount_kes: item.budgeted_amount_kes }),
        ),
      );
      toast.success(`${toConfirm.length} expense(s) confirmed at budgeted amounts`);
      setSelected(new Set());
      loadItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk confirm failed');
    }
  }

  async function handleBulkCarryForward() {
    const toCarry = filtered.filter((i) => selected.has(i.id) && i.status === 'pending_auth');
    if (toCarry.length === 0) {
      toast.error('No pending items selected');
      return;
    }
    const reason = window.prompt('Carry-forward reason for selected items (required):');
    if (!reason?.trim()) {
      toast.error('Reason is required');
      return;
    }
    const targetMonth = window.prompt('Target month for selected items (YYYY-MM):');
    if (!targetMonth?.trim() || targetMonth <= selectedMonth) {
      toast.error('A future target month is required');
      return;
    }
    try {
      await Promise.all(toCarry.map((item) => callAction('carry_forward', {
        id: item.id,
        carry_reason: reason.trim(),
        target_month: targetMonth.trim(),
      })));
      toast.success(`${toCarry.length} expense(s) carried forward`);
      setSelected(new Set());
      loadItems();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk carry forward failed');
    }
  }

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

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((i) => i.id)));
    }
  }

  // -----------------------------------------------
  // Render
  // -----------------------------------------------

  return (
    <div>
      <PageHeader title="Expense Queue" description="Pending expenses auto-populated from approved budgets">
        {/* Month selector */}
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getMonthOptions().map((ym) => (
              <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Project filter */}
        <Select value={projectFilter} onValueChange={(v) => v && setProjectFilter(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category filter */}
        <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="space-y-6 p-6">
        {/* Backfill banner — show when no items and user is CFO */}
        {items.length === 0 && canAct && hasPendingItems && (
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div>
              <p className="text-sm font-medium text-amber-800">No pending expenses found for this month.</p>
              <p className="text-xs text-amber-600 mt-1">Click below to populate expenses from all approved budgets.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-300 text-amber-700 hover:bg-amber-100"
              onClick={async () => {
                const headers = await getAuthHeaders();
                const res = await fetch('/api/expense-lifecycle', {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({ action: 'backfill', year_month: selectedMonth }),
                });
                const result = await res.json();
                if (result.success) {
                  toast.success(`Backfilled ${result.data?.total_created || 0} expense items from approved budgets`);
                  loadItems();
                } else {
                  toast.error(result.error || 'Backfill failed');
                }
              }}
            >
              Backfill from Approved Budgets
            </Button>
          </div>
        )}

        {/* Summary Bar */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Budgeted"
            value={formatCurrency(totalBudgeted, 'KES')}
            icon={DollarSign}
          />
          <StatCard
            title="Total Confirmed"
            value={formatCurrency(totalConfirmed, 'KES')}
            icon={CheckCircle}
          />
          <StatCard
            title="Pending Items"
            value={String(pendingCount)}
            icon={Clock}
          />
          <StatCard
            title="Overall Variance"
            value={formatCurrency(Math.abs(overallVariance), 'KES')}
            icon={TrendingDown}
            trend={
              overallVariance !== 0
                ? {
                    value: `${overallVariance > 0 ? 'Over' : 'Under'} budget`,
                    positive: overallVariance <= 0,
                  }
                : undefined
            }
          />
        </div>

        {/* Bulk actions */}
        {canAct && selected.size > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{selected.size} item(s) selected</span>
            <Button size="sm" onClick={handleBulkConfirm}>
              Confirm All Selected
            </Button>
            <Button size="sm" variant="outline" onClick={handleBulkCarryForward}>
              Carry Forward Selected
            </Button>
          </div>
        )}

        {/* Main Table */}
        <Card className="io-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">
                Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">
                {hasPendingItems
                  ? 'No pending expenses for this period'
                  : 'No pending expenses this month — all budgets are up to date'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {canAct && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selected.size === filtered.length && filtered.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                    )}
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Project / Dept</TableHead>
                    <TableHead className="text-right">Budgeted (KES)</TableHead>
                    <TableHead className="text-right">Actual (KES)</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Status</TableHead>
                    {canAct && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => {
                    const actual = item.actual_amount_kes ?? item.budgeted_amount_kes;
                    const variance = Number(actual) - Number(item.budgeted_amount_kes);
                    const pct = variancePercent(Number(item.budgeted_amount_kes), Number(actual));

                    return (
                      <TableRow key={item.id}>
                        {canAct && (
                          <TableCell>
                            <Checkbox
                              checked={selected.has(item.id)}
                              onCheckedChange={() => toggleSelect(item.id)}
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell className="text-slate-500">{item.category || '-'}</TableCell>
                        <TableCell className="text-slate-500">
                          {item.projects?.name || item.departments?.name || '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(Number(item.budgeted_amount_kes), 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {item.actual_amount_kes != null
                            ? formatCurrency(Number(item.actual_amount_kes), 'KES')
                            : '-'}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${varianceColor(variance)}`}>
                          {item.actual_amount_kes != null ? (
                            <>
                              {variance >= 0 ? '+' : ''}
                              {formatCurrency(variance, 'KES')}{' '}
                              <span className="text-xs">({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</span>
                            </>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${STATUS_BADGE[item.status]} border-0`}>
                            {STATUS_LABELS[item.status]}
                          </Badge>
                        </TableCell>
                        {canAct && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {/* pending_auth actions */}
                              {item.status === 'pending_auth' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setConfirmDialog(item);
                                      setConfirmAmount(String(item.budgeted_amount_kes));
                                    }}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setModifyDialog(item);
                                      setModifyAmount(String(item.budgeted_amount_kes));
                                      setModifyReason('');
                                    }}
                                  >
                                    Modify
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-red-600"
                                    disabled={user?.role !== 'cfo'}
                                    hidden={user?.role !== 'cfo'}
                                    onClick={() => {
                                      setVoidDialog(item);
                                      setVoidReason('');
                                    }}
                                  >
                                    Void
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => handleCarryForward(item)}
                                  >
                                    Carry Fwd
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => handleFlagForReview(item)}
                                  >
                                    Flag
                                  </Button>
                                </>
                              )}

                              {/* under_review actions */}
                              {item.status === 'under_review' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setConfirmDialog(item);
                                      setConfirmAmount(String(item.budgeted_amount_kes));
                                    }}
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-red-600"
                                    disabled={user?.role !== 'cfo'}
                                    hidden={user?.role !== 'cfo'}
                                    onClick={() => {
                                      setVoidDialog(item);
                                      setVoidReason('');
                                    }}
                                  >
                                    Void
                                  </Button>
                                </>
                              )}

                              {/* modified actions */}
                              {item.status === 'modified' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setConfirmDialog(item);
                                    setConfirmAmount(String(item.actual_amount_kes ?? item.budgeted_amount_kes));
                                  }}
                                >
                                  Confirm
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* -----------------------------------------------
          Confirm Dialog
          ----------------------------------------------- */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => !open && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Expense</DialogTitle>
          </DialogHeader>
          {confirmDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700">{confirmDialog.description}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {confirmDialog.projects?.name || confirmDialog.departments?.name || 'No project/dept'}
                </p>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-400">Budgeted Amount</Label>
                  <p className="font-mono text-sm font-medium">
                    {formatCurrency(Number(confirmDialog.budgeted_amount_kes), 'KES')}
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
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xs text-slate-400">Variance Preview</p>
                  {(() => {
                    const v = parseFloat(confirmAmount) - Number(confirmDialog.budgeted_amount_kes);
                    const pct = variancePercent(Number(confirmDialog.budgeted_amount_kes), parseFloat(confirmAmount));
                    return (
                      <p className={`font-mono text-sm font-medium ${varianceColor(v)}`}>
                        {v >= 0 ? '+' : ''}{formatCurrency(v, 'KES')} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Cancel</Button>
            <Button onClick={handleConfirm}>Confirm Expense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -----------------------------------------------
          Void Dialog
          ----------------------------------------------- */}
      <Dialog open={!!voidDialog} onOpenChange={(open) => !open && setVoidDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Expense</DialogTitle>
          </DialogHeader>
          {voidDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700">{voidDialog.description}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Budgeted: {formatCurrency(Number(voidDialog.budgeted_amount_kes), 'KES')}
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
            <Button variant="outline" onClick={() => setVoidDialog(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleVoid}>Void Expense</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* -----------------------------------------------
          Modify Dialog
          ----------------------------------------------- */}
      <Dialog open={!!modifyDialog} onOpenChange={(open) => !open && setModifyDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify Expense</DialogTitle>
          </DialogHeader>
          {modifyDialog && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700">{modifyDialog.description}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Budgeted: {formatCurrency(Number(modifyDialog.budgeted_amount_kes), 'KES')}
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
            <Button variant="outline" onClick={() => setModifyDialog(null)}>Cancel</Button>
            <Button onClick={handleModify}>Save Modification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
