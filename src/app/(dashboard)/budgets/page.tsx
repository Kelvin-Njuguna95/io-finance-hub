'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, Eye, Undo2, Trash2, Info } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { DashboardAlert } from '@/components/common/dashboard-alert';
import { getStatusBadgeClass } from '@/lib/status';
import { getBudgetsByMonth } from '@/lib/queries/budgets';
import { BUDGET_STATUS } from '@/lib/constants/status';
import { BUDGET_EDITABLE_STATUSES } from '@/lib/budgets/status';

interface BudgetRow {
  id: string;
  year_month: string;
  current_version: number;
  project_id: string | null;
  project_name?: string;
  department_name?: string;
  latest_status: string;
  total_usd: number;
  total_kes: number;
  created_by: string;
  created_by_name: string;
  submitted_by_role: string;
  submitted_at: string | null;
  pending_expense_count: number;
}

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under Review',
  pm_review: 'PM Review',
  pm_approved: 'PM Approved',
  pm_rejected: 'PM Rejected',
  returned_to_tl: 'Returned — Action Needed',
  approved: 'Approved',
  rejected: 'Rejected',
};
const cfoApprovableStatuses = [BUDGET_STATUS.SUBMITTED, BUDGET_STATUS.PM_REVIEW, BUDGET_STATUS.PM_APPROVED];

export default function BudgetsPage() {
  const { user } = useUser();
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState('all');

  useEffect(() => {
    load();
  }, [selectedMonth]);

  const [deleteTarget, setDeleteTarget] = useState<BudgetRow | null>(null);
  // Security audit note: this client-side role check mirrors server-side guards in budget API routes.
  const canCreate = user?.role === 'team_leader' || user?.role === 'project_manager' || user?.role === 'cfo' || user?.role === 'accountant' || user?.role === 'department_head';
  const canManageBudgets = user?.role === 'team_leader' || user?.role === 'cfo' || user?.role === 'project_manager' || user?.role === 'accountant' || user?.role === 'department_head';
  const isAccountant = user?.role === 'accountant';
  const isTl = user?.role === 'team_leader';
  const newBudgetButtonLabel = user?.role === 'team_leader'
    ? 'New Budget'
    : user?.role === 'accountant' || user?.role === 'cfo'
      ? 'New Project / Department Budget'
      : 'New Project Budget';

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { 'Authorization': `Bearer ${session.access_token}` } : {};
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
      load();
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
      load();
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
      load();
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
      load();
    } else {
      toast.error(data.error || 'Failed to populate expenses');
    }
  }

  async function load() {
    const supabase = createClient();
    const { data } = await getBudgetsByMonth(supabase, selectedMonth);

    // Get user names for created_by
    const userIds = new Set<string>();
    (data || []).forEach((b: /* // */ any) => { if (b.created_by) userIds.add(b.created_by); });
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', Array.from(userIds));
    const nameMap = new Map<string, string>((users || []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]));

    const rows: BudgetRow[] = (data || []).map((b: Record<string, unknown>) => {
      const versions = (b.budget_versions as Record<string, unknown>[]) || [];
      const latest = versions.find((v: Record<string, unknown>) => v.version_number === b.current_version) || versions[0];
      return {
        id: b.id as string,
        year_month: b.year_month as string,
        current_version: b.current_version as number,
        project_id: b.project_id as string | null,
        project_name: (b.projects as Record<string, unknown>)?.name as string | undefined,
        department_name: (b.departments as Record<string, unknown>)?.name as string | undefined,
        latest_status: (latest?.status as string) || 'draft',
        total_usd: Number(latest?.total_amount_usd || 0),
        total_kes: Number(latest?.total_amount_kes || 0),
        created_by: b.created_by as string,
        created_by_name: nameMap.get(b.created_by as string) || '—',
        submitted_by_role: (b.submitted_by_role as string) || 'team_leader',
        submitted_at: (latest?.submitted_at as string | null) ?? null,
        pending_expense_count: 0,
      };
    });

    const budgetIds = rows.map((row) => row.id);
    const pendingCountMap = new Map<string, number>();
    if (budgetIds.length > 0) {
      const { data: pending } = await supabase
        .from('pending_expenses')
        .select('budget_id')
        .in('budget_id', budgetIds);
      (pending || []).forEach((item: { budget_id: string | null }) => {
        if (!item.budget_id) return;
        pendingCountMap.set(item.budget_id, (pendingCountMap.get(item.budget_id) || 0) + 1);
      });
    }

    const rowsWithCounts = rows.map((row) => ({
      ...row,
      pending_expense_count: pendingCountMap.get(row.id) || 0,
    }));

    rowsWithCounts.sort((a, b) => {
      if (!a.submitted_at && !b.submitted_at) return 0;
      if (!a.submitted_at) return 1;
      if (!b.submitted_at) return -1;
      return b.submitted_at.localeCompare(a.submitted_at);
    });

    setBudgets(rowsWithCounts);
    setLoading(false);
  }

  // Filter budgets based on tab selection
  const filteredBudgets = budgets.filter(b => {
    if (filterTab === 'all') return true;
    if (filterTab === 'mine') return b.created_by === user?.id;
    if (filterTab === 'pending') {
      if (user?.role === 'cfo') {
        return cfoApprovableStatuses.includes(b.latest_status as typeof cfoApprovableStatuses[number]);
      }
      return b.latest_status === BUDGET_STATUS.PM_REVIEW;
    }
    if (filterTab === 'approved') return b.latest_status === BUDGET_STATUS.APPROVED;
    return true;
  });

  // Group budgets by project for dual-budget display
  const projectGroups = new Map<string, BudgetRow[]>();
  filteredBudgets.forEach(b => {
    const key = b.project_name || b.department_name || b.id;
    if (!projectGroups.has(key)) projectGroups.set(key, []);
    projectGroups.get(key)!.push(b);
  });

  // Check if any project has multiple budgets
  const hasDualBudgets = Array.from(projectGroups.values()).some(group => group.length > 1);

  function canWithdraw(b: BudgetRow): boolean {
    if (b.latest_status !== 'submitted' && b.latest_status !== 'pm_review') return false;
    // TL can withdraw own budgets
    if (isTl && b.submitted_by_role === 'team_leader' && b.created_by === user?.id) return true;
    // Accountant can withdraw own budgets
    if (isAccountant && b.submitted_by_role === 'accountant' && b.created_by === user?.id) return true;
    // CFO can withdraw any
    if (user?.role === 'cfo') return true;
    return false;
  }

  function canDeleteBudget(b: BudgetRow): boolean {
    if (user?.role === 'cfo') return true;
    if (user?.role === 'accountant' && b.created_by === user?.id) return true;
    if (b.latest_status !== 'draft') return false;
    if (b.created_by === user?.id) return true;
    return false;
  }

  function canEdit(b: BudgetRow): boolean {
    const isEditableStatus = BUDGET_EDITABLE_STATUSES.includes(b.latest_status as typeof BUDGET_EDITABLE_STATUSES[number]);
    if (!isEditableStatus) return false;
    // TL can edit editable budgets
    if (isTl) return true;
    // Accountant can edit their own editable budgets
    if (isAccountant && b.submitted_by_role === 'accountant' && b.created_by === user?.id) return true;
    return false;
  }

  // Check if TL should see an info notice about accountant budgets
  const accountantBudgetsForTlProject = isTl
    ? budgets.filter(b => b.submitted_by_role === 'accountant' && b.created_by !== user?.id)
    : [];

  return (
    <div>
      <PageHeader title="Budgets" description="Manage project and department budgets">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
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
      </PageHeader>

      <div className="p-6 space-y-4">
        {/* TL notice about accountant budgets */}
        {isTl && accountantBudgetsForTlProject.length > 0 && (
          <DashboardAlert
            variant="info"
            description={`The Accountant has also submitted ${accountantBudgetsForTlProject.length === 1 ? 'a budget' : `${accountantBudgetsForTlProject.length} budgets`} for your project this month. Both are under PM review.`}
          />
        )}

        {/* Filter tabs for accountant */}
        {(isAccountant || user?.role === 'cfo') && (
          <Tabs value={filterTab} onValueChange={setFilterTab}>
            <TabsList>
              <TabsTrigger value="all">All Budgets</TabsTrigger>
              {isAccountant && <TabsTrigger value="mine">Submitted By Me</TabsTrigger>}
              <TabsTrigger value="pending">Pending Review</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

          <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Submitted By</TableHead>
                  <TableHead>Date Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount (KES)</TableHead>
                  <TableHead className="w-[280px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBudgets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No budgets found for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBudgets.map((b) => {
                    const isOwnBudget = b.created_by === user?.id;
                    // Check if there are multiple budgets for the same project
                    const scopeKey = b.project_name || b.department_name || '';
                    const siblings = projectGroups.get(scopeKey) || [];
                    const hasSibling = siblings.length > 1;

                    return (
                      <TableRow key={b.id} className={hasSibling ? 'border-l-2 border-l-warning' : `status-row-${b.latest_status === 'under_review' || b.latest_status === 'pm_review' ? 'review' : b.latest_status}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span className="truncate max-w-[220px]" title={b.project_name || b.department_name || '—'}>
                              {b.project_name || b.department_name || '—'}
                            </span>
                            {hasSibling && (
                              <span className="text-[10px] bg-warning-soft text-warning-soft-foreground px-1.5 py-0.5 rounded-full font-medium">
                                {siblings.length} versions
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{isOwnBudget ? 'You' : b.created_by_name}</span>
                            <Badge
                              variant="secondary"
                              className={b.submitted_by_role === 'accountant'
                                ? 'bg-info-soft text-info-soft-foreground text-[10px] px-1.5'
                                : b.submitted_by_role === 'project_manager'
                                  ? 'bg-teal-soft text-teal-soft-foreground text-[10px] px-1.5'
                                  : b.submitted_by_role === 'cfo'
                                    ? 'bg-violet-soft text-violet-soft-foreground text-[10px] px-1.5'
                                    : 'bg-warning-soft text-warning-soft-foreground text-[10px] px-1.5'
                              }
                            >
                              {b.submitted_by_role === 'accountant'
                                ? 'Accountant'
                                : b.submitted_by_role === 'project_manager'
                                  ? 'PM'
                                  : b.submitted_by_role === 'cfo'
                                    ? 'CFO'
                                    : 'TL'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{b.submitted_at ? formatDate(b.submitted_at) : '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={getStatusBadgeClass(b.latest_status)}>
                            {statusLabels[b.latest_status] || capitalize(b.latest_status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(b.total_kes, 'KES')}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Link href={`/budgets/${b.id}`}>
                              <Button variant="ghost" size="icon" title="View">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            {canWithdraw(b) && (
                              <Button variant="ghost" size="icon" title="Withdraw to draft" onClick={() => handleWithdraw(b.id)}>
                                <Undo2 className="h-4 w-4 text-warning-soft-foreground" />
                              </Button>
                            )}
                            {canEdit(b) && (
                              <Link href={`/budgets/${b.id}`}>
                                <Button variant="ghost" size="sm" className="text-warning-soft-foreground text-xs">Edit & Resubmit</Button>
                              </Link>
                            )}
                            {canDeleteBudget(b) && (
                              <Button variant="ghost" size="icon" title="Delete Budget Record" onClick={() => setDeleteTarget(b)}>
                                <Trash2 className="h-4 w-4 text-danger-soft-foreground" />
                              </Button>
                            )}
                            {user?.role === 'cfo' && cfoApprovableStatuses.includes(b.latest_status as typeof cfoApprovableStatuses[number]) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs"
                                onClick={() => handleCfoApprove(b.id)}
                              >
                                {b.latest_status === 'pm_approved' ? 'Approve' : 'Approve (Direct)'}
                              </Button>
                            )}
                            {(user?.role === 'cfo' || user?.role === 'accountant') && b.latest_status === 'approved' && b.pending_expense_count === 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => handlePopulateExpenses(b.id)}
                              >
                                Populate Expenses
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Budget</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete the budget for{' '}
              <strong>{deleteTarget?.project_name || deleteTarget?.department_name}</strong>?
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DashboardAlert
            variant="error"
            description={`Amount: ${formatCurrency(deleteTarget?.total_kes || 0, 'KES')} · Version ${deleteTarget?.current_version}`}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete Permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
