'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/format';
import { Check, X, History } from 'lucide-react';
import { toast } from 'sonner';
import type { Budget, BudgetVersion, BudgetItem, BudgetApproval } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-amber-100 text-amber-700',
  pm_review: 'bg-purple-100 text-purple-700',
  pm_approved: 'bg-teal-100 text-teal-700',
  pm_rejected: 'bg-rose-100 text-rose-700',
  returned_to_tl: 'bg-amber-200 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const router = useRouter();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [approvals, setApprovals] = useState<BudgetApproval[]>([]);
  const [activeVersion, setActiveVersion] = useState<BudgetVersion | null>(null);
  const [scopeName, setScopeName] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showPmRejectDialog, setShowPmRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [returnComments, setReturnComments] = useState('');
  const [pmRejectReason, setPmRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [lineActionId, setLineActionId] = useState<string | null>(null);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { 'Authorization': `Bearer ${session.access_token}` } : {};
  }

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const supabase = createClient();

    const { data: b } = await supabase
      .from('budgets')
      .select('*, projects(name), departments(name)')
      .eq('id', id)
      .single();

    if (!b) {
      router.push('/budgets');
      return;
    }

    setBudget(b as Budget);
    setScopeName(
      (b.projects as { name: string } | null)?.name ||
      (b.departments as { name: string } | null)?.name ||
      '—'
    );

    const { data: vers } = await supabase
      .from('budget_versions')
      .select('*')
      .eq('budget_id', id)
      .order('version_number', { ascending: false });

    setVersions((vers || []) as BudgetVersion[]);

    const latestVersion = (vers || []).find(
      (v: BudgetVersion) => v.version_number === b.current_version
    ) || (vers || [])[0];

    if (latestVersion) {
      setActiveVersion(latestVersion as BudgetVersion);
      loadVersionItems((latestVersion as BudgetVersion).id);
    }

    const { data: apps } = await supabase
      .from('budget_approvals')
      .select('*')
      .in('budget_version_id', (vers || []).map((v: BudgetVersion) => v.id))
      .order('created_at', { ascending: false });

    setApprovals((apps || []) as BudgetApproval[]);
  }

  async function loadVersionItems(versionId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from('budget_items')
      .select('*')
      .eq('budget_version_id', versionId)
      .order('sort_order');
    setItems((data || []) as BudgetItem[]);
  }

  function selectVersion(v: BudgetVersion) {
    setActiveVersion(v);
    loadVersionItems(v.id);
  }

  const [showAutoRejectDialog, setShowAutoRejectDialog] = useState(false);
  const [siblingBudgets, setSiblingBudgets] = useState<any[]>([]);
  const [autoRejectChoice, setAutoRejectChoice] = useState<'leave' | 'reject'>('leave');

  async function checkSiblingBudgets() {
    if (!budget?.project_id) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from('budgets')
      .select('id, submitted_by_role, created_by, budget_versions(status, total_amount_kes, version_number)')
      .eq('project_id', budget.project_id)
      .eq('year_month', budget.year_month)
      .neq('id', budget.id);
    return data || [];
  }

  async function handleApprove() {
    if (!activeVersion) return;

    // Check for sibling budgets (same project/month, different budget)
    const siblings = await checkSiblingBudgets();
    const activeSiblings = siblings.filter((s: any) => {
      const v = (s.budget_versions || [])[0];
      return v && !['rejected', 'draft'].includes(v.status);
    });

    if (activeSiblings.length > 0) {
      setSiblingBudgets(activeSiblings);
      setShowAutoRejectDialog(true);
      return;
    }

    await performApproval();
  }

  async function performApproval() {
    if (!activeVersion) return;
    setProcessing(true);
    const supabase = createClient();

    // Calculate approved total from line items (if PM reviewed them)
    const approvedItems = items.filter((i: any) => ['approved', 'adjusted'].includes(i.pm_status));
    const removedItems = items.filter((i: any) => i.pm_status === 'removed');
    const hasLineReview = approvedItems.length > 0 || removedItems.length > 0;

    if (hasLineReview) {
      const approvedTotal = approvedItems.reduce((s: number, i: any) => s + Number(i.pm_approved_amount || 0), 0);
      const originalTotal = items.reduce((s: number, i: any) => s + Number(i.amount_kes || 0), 0);
      await supabase.from('budgets').update({
        pm_original_total: originalTotal,
        pm_approved_total: approvedTotal,
        pm_review_summary: {
          approved_count: approvedItems.length,
          adjusted_count: items.filter((i: any) => i.pm_status === 'adjusted').length,
          removed_count: removedItems.length,
          original_total: originalTotal,
          approved_total: approvedTotal,
          variance: originalTotal - approvedTotal,
        },
      }).eq('id', budget!.id);
    }

    // Update version status
    await supabase.from('budget_versions').update({
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', activeVersion.id);

    // Create approval record
    await supabase.from('budget_approvals').insert({
      budget_version_id: activeVersion.id,
      action: 'approved',
      approved_by: user!.id,
    });

    // Handle auto-reject of sibling budgets if chosen
    if (autoRejectChoice === 'reject' && siblingBudgets.length > 0) {
      const headers = await getAuthHeaders();
      await fetch('/api/budgets/auto-reject-sibling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          approved_budget_id: budget!.id,
          sibling_budget_ids: siblingBudgets.map((s: any) => s.id),
          approved_submitted_by_role: (budget as any)?.submitted_by_role || 'team_leader',
        }),
      });
    }

    // Auto-populate pending expenses from approved budget items
    try {
      const headers = await getAuthHeaders();
      await fetch('/api/expense-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          action: 'auto_populate',
          budget_version_id: activeVersion.id,
          budget_id: budget!.id,
        }),
      });
    } catch (e) {
      console.error('Failed to auto-populate expenses:', e);
    }

    toast.success('Budget approved — expenses queued');
    setShowAutoRejectDialog(false);
    setProcessing(false);
    load();
  }

  async function handleReject() {
    if (!activeVersion || !rejectionReason.trim()) return;
    setProcessing(true);
    const supabase = createClient();

    // Update version status
    await supabase.from('budget_versions').update({
      status: 'rejected',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    }).eq('id', activeVersion.id);

    // Create approval record
    await supabase.from('budget_approvals').insert({
      budget_version_id: activeVersion.id,
      action: 'rejected',
      approved_by: user!.id,
      reason: rejectionReason,
    });

    toast.success('Budget rejected');
    setShowRejectDialog(false);
    setRejectionReason('');
    setProcessing(false);
    load();
  }

  async function handleMarkUnderReview() {
    if (!activeVersion) return;
    const supabase = createClient();
    await supabase.from('budget_versions').update({
      status: 'under_review',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', activeVersion.id);
    toast.success('Budget marked as under review');
    load();
  }

  const isCfo = user?.role === 'cfo';
  const isPm = user?.role === 'project_manager';
  const isAccountant = user?.role === 'accountant';
  const isTl = user?.role === 'team_leader';
  const isOwnBudget = budget?.created_by === user?.id;
  const budgetSubmittedByRole = (budget as any)?.submitted_by_role || 'team_leader';
  // TL can edit their own returned/draft budgets; Accountant can edit their own returned/draft budgets
  const canTlEdit = (isTl && (activeVersion?.status === 'returned_to_tl' || activeVersion?.status === 'draft'))
    || (isAccountant && isOwnBudget && budgetSubmittedByRole === 'accountant' && (activeVersion?.status === 'returned_to_tl' || activeVersion?.status === 'draft'));
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [savingItem, setSavingItem] = useState(false);

  // Load categories for the dropdown
  useEffect(() => {
    async function loadCats() {
      const supabase = createClient();
      const { data } = await supabase.from('expense_categories').select('name').eq('is_active', true).neq('name', 'Administration').order('name');
      setCategories((data || []).map((c: any) => c.name));
    }
    loadCats();
  }, []);

  async function handleSaveItem(itemId: string) {
    setSavingItem(true);
    const supabase = createClient();
    await supabase.from('budget_items').update({
      description: editDesc,
      category: editCategory || null,
      amount_kes: editAmount,
      unit_cost_kes: editAmount,
    }).eq('id', itemId);
    // Update version total
    if (activeVersion) {
      const { data: allItems } = await supabase.from('budget_items').select('amount_kes').eq('budget_version_id', activeVersion.id);
      const newTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
      await supabase.from('budget_versions').update({ total_amount_kes: newTotal }).eq('id', activeVersion.id);
    }
    setEditingItem(null);
    setSavingItem(false);
    toast.success('Line item updated');
    load();
  }

  async function handleDeleteItem(itemId: string) {
    if (!confirm('Remove this line item?')) return;
    const supabase = createClient();
    await supabase.from('budget_items').delete().eq('id', itemId);
    // Update version total
    if (activeVersion) {
      const { data: allItems } = await supabase.from('budget_items').select('amount_kes').eq('budget_version_id', activeVersion.id);
      const newTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
      await supabase.from('budget_versions').update({ total_amount_kes: newTotal }).eq('id', activeVersion.id);
    }
    toast.success('Line item removed');
    load();
  }

  async function handleResubmit() {
    if (!budget || !activeVersion) return;
    const supabase = createClient();
    // Update version status to pm_review for resubmission
    await supabase.from('budget_versions').update({
      status: 'pm_review',
      submitted_at: new Date().toISOString(),
      submitted_by: user!.id,
      pm_return_reason: null,
    }).eq('id', activeVersion.id);
    // Clear PM review fields on budget
    await supabase.from('budgets').update({
      pm_review_opened_at: null,
      pm_reviewer_id: null,
    }).eq('id', budget.id);
    // Reset pm_status on all items back to pending
    await supabase.from('budget_items').update({
      pm_status: 'pending',
      pm_approved_amount: null,
      pm_adjustment_reason: null,
      pm_reviewed_by: null,
      pm_reviewed_at: null,
    }).eq('budget_version_id', activeVersion.id);
    toast.success('Budget resubmitted for PM review');
    load();
  }
  const canCfoApprove = isCfo && (activeVersion?.status === 'pm_approved' || activeVersion?.status === 'under_review' || activeVersion?.status === 'submitted');
  const canPmReview = isPm && activeVersion?.status === 'pm_review';
  // CFO can also do line-item review on pm_review, pm_approved, submitted budgets
  const canLineReview = canPmReview || (isCfo && ['pm_review', 'pm_approved', 'submitted', 'under_review'].includes(activeVersion?.status || ''));
  const pendingLineItems = items.filter((i: any) => !i.pm_status || i.pm_status === 'pending').length;
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');

  async function handlePmAction(action: string, comments?: string) {
    setProcessing(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/budgets/pm-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ budget_id: id, action, comments }),
    });
    const result = await res.json();
    if (result.success) {
      toast.success(action === 'approve' ? 'Budget approved — sent to CFO' : action === 'return' ? 'Budget returned to TL' : 'Budget rejected');
      setShowReturnDialog(false);
      setShowPmRejectDialog(false);
      setReturnComments('');
      setPmRejectReason('');
    } else {
      toast.error(result.error);
    }
    setProcessing(false);
    load();
  }

  async function markPmReviewOpenedDirect() {
    if (!budget?.id || budget.pm_review_opened_at) return;
    const supabase = createClient();
    await supabase.from('budgets').update({
      pm_review_opened_at: new Date().toISOString(),
      pm_reviewer_id: user?.id || null,
    }).eq('id', budget.id);
  }

  useEffect(() => {
    if (canPmReview && budget?.id && !budget.pm_review_opened_at) {
      markPmReviewOpenedDirect().then(() => load()).catch((e) => console.error('Failed to mark PM review opened:', e));
    }
  }, [budget?.id, budget?.pm_review_opened_at, canPmReview]);

  return (
    <div>
      <PageHeader title={`Budget — ${scopeName}`} description={`${budget?.year_month || ''} · Submitted by ${budgetSubmittedByRole === 'accountant' ? 'Accountant' : 'Team Leader'}`}>
        {canPmReview && (
          <div className="flex gap-2">
            <Button onClick={async () => {
              if (pendingLineItems > 0) {
                toast.error('Please action all line items before submitting review.');
                return;
              }
              setSubmittingReview(true);
              try {
                const headers = await getAuthHeaders();
                const res = await fetch('/api/budgets/pm-line-review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({ action: 'submit_review', budget_id: id }) });
                const data = await res.json();
                if (data.success) { toast.success('Review submitted — sent to CFO'); load(); } else { toast.error(getUserErrorMessage(data?.error, 'Failed to submit PM review.')); }
              } catch (error) {
                toast.error(getUserErrorMessage(error, 'Failed to submit PM review.'));
              } finally {
                setSubmittingReview(false);
              }
            }} disabled={processing || submittingReview || pendingLineItems > 0} className="gap-1 bg-teal-600 hover:bg-teal-700" size="sm">
              <Check className="h-4 w-4" /> Submit Review
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowReturnDialog(true)} disabled={processing} className="gap-1 text-amber-600">
              Return to TL
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setShowPmRejectDialog(true)} disabled={processing} className="gap-1">
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        )}
        {canCfoApprove && (
          <div className="flex gap-2">
            <Button onClick={handleApprove} disabled={processing} className="gap-1" size="sm">
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowRejectDialog(true)}
              disabled={processing}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        )}
        {isCfo && activeVersion?.status === 'approved' && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={async () => {
              const reason = prompt('Why are you sending this back to the TL?');
              if (!reason) return;
              const headers = await getAuthHeaders();
              const res = await fetch('/api/budgets/cfo-revert', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ budget_id: id, action: 'send_back', reason }) });
              const data = await res.json();
              if (data.success) { toast.success('Budget sent back to TL'); load(); } else { toast.error(data.error); }
            }} className="text-amber-600">Send Back to TL</Button>
            <Button variant="destructive" size="sm" onClick={async () => {
              const typed = prompt('Type DELETE to confirm permanent deletion:');
              if (typed !== 'DELETE') { toast.error('Deletion cancelled'); return; }
              const reason = prompt('Reason for deletion:');
              if (!reason) return;
              const headers = await getAuthHeaders();
              const res = await fetch('/api/budgets/cfo-revert', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ budget_id: id, action: 'delete', reason }) });
              const data = await res.json();
              if (data.success) { toast.success('Budget deleted'); window.location.href = '/budgets'; } else { toast.error(data.error); }
            }}>Delete Budget</Button>
          </div>
        )}
      </PageHeader>

      <div className="p-6 space-y-6">
        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">Line Items</TabsTrigger>
            <TabsTrigger value="versions" className="gap-1">
              <History className="h-3 w-3" /> Version History ({versions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="space-y-4">
            {/* Version summary */}
            {activeVersion && (
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">
                      Version {activeVersion.version_number}
                    </span>
                    <Badge variant="secondary" className={statusColors[activeVersion.status]}>
                      {capitalize(activeVersion.status)}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    <span className="font-mono">{formatCurrency(activeVersion.total_amount_kes, 'KES')}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {(activeVersion as any)?.pm_return_reason && activeVersion?.status === 'returned_to_tl' && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-amber-800">Returned by PM</p>
                  <p className="text-sm text-amber-700 mt-1">{(activeVersion as any).pm_return_reason}</p>
                </CardContent>
              </Card>
            )}

            {(activeVersion as any)?.pm_rejection_reason && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-red-800">Rejected by PM</p>
                  <p className="text-sm text-red-700 mt-1">{(activeVersion as any).pm_rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {activeVersion?.rejection_reason && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-red-800">Rejection Reason</p>
                  <p className="text-sm text-red-700 mt-1">{activeVersion.rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Bulk actions for PM and CFO */}
            {canLineReview && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={async () => {
                  const pendingIds = items.filter((i: any) => (i as any).pm_status === 'pending' || !(i as any).pm_status).map(i => i.id);
                  if (pendingIds.length === 0) { toast.info('No pending items'); return; }
                  const headers = await getAuthHeaders();
                  await fetch('/api/budgets/pm-line-review', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ action: 'bulk_approve', items: pendingIds, budget_id: id }),
                  });
                  toast.success('Approved ' + pendingIds.length + ' items');
                  load();
                }} className="gap-1 text-emerald-600">Approve All</Button>
                <Button variant="outline" size="sm" onClick={async () => {
                  const reason = prompt('Reason for removing all pending items:');
                  if (!reason) return;
                  const pendingIds = items.filter((i: any) => (i as any).pm_status === 'pending' || !(i as any).pm_status).map(i => i.id);
                  if (pendingIds.length === 0) { toast.info('No pending items'); return; }
                  const headers = await getAuthHeaders();
                  for (const itemId of pendingIds) {
                    await fetch('/api/budgets/pm-line-review', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                      body: JSON.stringify({ action: 'update_item', item_id: itemId, budget_id: id, pm_status: 'removed', reason }),
                    });
                  }
                  toast.success('Removed ' + pendingIds.length + ' items');
                  load();
                }} className="gap-1 text-rose-600">Remove All Pending</Button>
                <span className="text-xs text-slate-400">
                  {pendingLineItems} pending
                </span>
              </div>
            )}

            {/* Items table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">{canTlEdit ? 'Amount (KES)' : 'Submitted (KES)'}</TableHead>
                      {canTlEdit && <TableHead className="w-[140px]">Actions</TableHead>}
                      {(canLineReview || isPm || isCfo) && <TableHead>PM Decision</TableHead>}
                      {(canLineReview || isPm || isCfo) && <TableHead className="text-right">Approved (KES)</TableHead>}
                      {(canLineReview || isPm || isCfo) && <TableHead>Reason</TableHead>}
                      {canLineReview && <TableHead className="w-[180px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item: any, idx) => {
                      const pmStatus = item.pm_status || 'pending';
                      const isRemoved = pmStatus === 'removed';
                      return (
                      <TableRow key={item.id} className={isRemoved ? 'bg-rose-50 line-through opacity-60' : pmStatus === 'approved' ? 'bg-emerald-50/30' : pmStatus === 'adjusted' ? 'bg-amber-50/30' : ''}>
                        <TableCell className="text-neutral-400">{idx + 1}</TableCell>
                        <TableCell className="font-medium">
                          {editingItem === item.id ? (
                            <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-sm h-8" />
                          ) : item.description}
                        </TableCell>
                        <TableCell className="text-sm text-neutral-500">
                          {editingItem === item.id ? (
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm bg-white"
                            >
                              <option value="">— Select —</option>
                              {categories.map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          ) : (item.category || '—')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {editingItem === item.id ? (
                            <Input type="number" step="0.01" value={editAmount || ''} onChange={(e) => setEditAmount(parseFloat(e.target.value) || 0)} className="text-sm h-8 w-32 text-right ml-auto" />
                          ) : formatCurrency(Number(item.amount_kes), 'KES')}
                        </TableCell>
                        {canTlEdit && (
                          <TableCell>
                            {editingItem === item.id ? (
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveItem(item.id)} disabled={savingItem}>Save Line Item</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingItem(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingItem(item.id); setEditDesc(item.description); setEditCategory(item.category || ''); setEditAmount(Number(item.amount_kes)); }}>Edit</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-600" onClick={() => handleDeleteItem(item.id)}>Remove</Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell>
                            <Badge variant="secondary" className={
                              pmStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                              pmStatus === 'adjusted' ? 'bg-amber-100 text-amber-700' :
                              pmStatus === 'removed' ? 'bg-rose-100 text-rose-700' :
                              'bg-slate-100 text-slate-500'
                            }>{pmStatus === 'pending' ? 'Pending' : capitalize(pmStatus)}</Badge>
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-right font-mono text-sm">
                            {pmStatus === 'approved' ? <span className="text-emerald-600">{formatCurrency(Number(item.pm_approved_amount || item.amount_kes), 'KES')}</span> :
                             pmStatus === 'adjusted' ? <span className="text-amber-600">{formatCurrency(Number(item.pm_approved_amount), 'KES')}</span> :
                             pmStatus === 'removed' ? <span className="text-rose-500">KES 0</span> : '—'}
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-xs text-neutral-500 max-w-[150px] truncate">{item.pm_adjustment_reason || '—'}</TableCell>
                        )}
                        {canLineReview && (
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {pmStatus !== 'approved' && (
                                <Button variant="ghost" size="sm" className="text-xs text-emerald-600 h-7" disabled={lineActionId === item.id} onClick={async () => {
                                  setLineActionId(item.id);
                                  try {
                                    const headers = await getAuthHeaders();
                                    const res = await fetch('/api/budgets/pm-line-review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                                      body: JSON.stringify({ action: 'update_item', item_id: item.id, budget_id: id, pm_status: 'approved' }) });
                                    const data = await res.json();
                                    if (!data.success) toast.error(getUserErrorMessage(data?.error, 'Unable to approve line item.'));
                                    await markPmReviewOpenedDirect();
                                    load();
                                  } finally {
                                    setLineActionId(null);
                                  }
                                }}>Approve</Button>
                              )}
                              {pmStatus !== 'adjusted' && (
                                <Button variant="ghost" size="sm" className="text-xs text-amber-600 h-7" onClick={() => {
                                  setAdjustItem(item);
                                  setAdjustAmount(Number(item.amount_kes));
                                  setAdjustReason('');
                                }}>Adjust</Button>
                              )}
                              {pmStatus !== 'removed' && (
                                <Button variant="ghost" size="sm" className="text-xs text-rose-600 h-7" disabled={lineActionId === item.id} onClick={() => {
                                  const reason = prompt('Reason for removing this line item:');
                                  if (!reason) return;
                                  setLineActionId(item.id);
                                  getAuthHeaders().then(headers => {
                                    fetch('/api/budgets/pm-line-review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                                      body: JSON.stringify({ action: 'update_item', item_id: item.id, budget_id: id, pm_status: 'removed', reason }) }).then(() => markPmReviewOpenedDirect()).then(() => load()).finally(() => setLineActionId(null));
                                  }).catch(() => setLineActionId(null));
                                }}>Remove</Button>
                              )}
                              {pmStatus !== 'pending' && (
                                <Button variant="ghost" size="sm" className="text-xs text-slate-400 h-7" disabled={lineActionId === item.id} onClick={async () => {
                                  setLineActionId(item.id);
                                  try {
                                    const headers = await getAuthHeaders();
                                    await fetch('/api/budgets/pm-line-review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                                      body: JSON.stringify({ action: 'update_item', item_id: item.id, budget_id: id, pm_status: 'pending' }) });
                                    load();
                                  } finally {
                                    setLineActionId(null);
                                  }
                                }}>Undo</Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                      );
                    })}
                    {items.length > 0 && (
                      <TableRow className="font-semibold">
                        <TableCell colSpan={3} className="text-right">Total</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(items.reduce((s: number, i: any) => s + Number(i.amount_kes), 0), 'KES')}
                        </TableCell>
                        {(canLineReview || isPm || isCfo) && <TableCell></TableCell>}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-right font-mono text-emerald-700">
                            {formatCurrency(items.filter((i: any) => ['approved', 'adjusted'].includes(i.pm_status)).reduce((s: number, i: any) => s + Number(i.pm_approved_amount || 0), 0), 'KES')}
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && <TableCell></TableCell>}
                        {canLineReview && <TableCell></TableCell>}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Resubmit button (TL for own, Accountant for own) */}
            {canTlEdit && activeVersion?.status === 'returned_to_tl' && (
              <div className="flex justify-end">
                <Button onClick={handleResubmit} className="btn-gradient text-white gap-1">
                  Resubmit for PM Review
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="space-y-2">
            {versions.map((v) => (
              <Card
                key={v.id}
                className={`cursor-pointer transition-colors ${v.id === activeVersion?.id ? 'border-neutral-900' : 'hover:border-neutral-300'}`}
                onClick={() => selectVersion(v)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">v{v.version_number}</span>
                    <Badge variant="secondary" className={statusColors[v.status]}>
                      {capitalize(v.status)}
                    </Badge>
                    {v.submitted_at && (
                      <span className="text-xs text-neutral-400">
                        Submitted {formatDateTime(v.submitted_at)}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-mono">
                    {formatCurrency(v.total_amount_kes, 'KES')}
                  </span>
                </CardContent>
              </Card>
            ))}

            {/* Approval history */}
            {approvals.length > 0 && (
              <>
                <Separator className="my-4" />
                <h3 className="text-sm font-medium mb-2">Approval History</h3>
                {approvals.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-sm rounded-md border p-3">
                    <Badge variant={a.action === 'approved' ? 'default' : 'destructive'}>
                      {a.action}
                    </Badge>
                    <span className="text-neutral-500">{formatDateTime(a.created_at)}</span>
                    {a.reason && <span className="text-neutral-600">— {a.reason}</span>}
                  </div>
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Rejection dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Budget</DialogTitle>
            <DialogDescription>
              The submitter will need to revise and resubmit as a new version.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (required)..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processing || !rejectionReason.trim()}
            >
              Reject Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PM Return dialog */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Budget to Team Leader</DialogTitle>
            <DialogDescription>The TL will be able to edit and resubmit.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="What should the TL change? (required)"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReturnDialog(false)}>Cancel</Button>
            <Button onClick={() => handlePmAction('return', returnComments)} disabled={processing || !returnComments.trim()}>
              Send Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PM Reject dialog */}
      <Dialog open={showPmRejectDialog} onOpenChange={setShowPmRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Budget</DialogTitle>
            <DialogDescription>
              This will permanently close this budget. The TL will need to create a new budget from scratch.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason (required)"
            value={pmRejectReason}
            onChange={(e) => setPmRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPmRejectDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => handlePmAction('reject', pmRejectReason)} disabled={processing || !pmRejectReason.trim()}>
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CFO Auto-reject sibling dialog */}
      <Dialog open={showAutoRejectDialog} onOpenChange={setShowAutoRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Other Budget Versions Exist</DialogTitle>
            <DialogDescription>
              You are approving this budget as the official budget. There {siblingBudgets.length === 1 ? 'is 1 other version' : `are ${siblingBudgets.length} other versions`} for the same project and month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {siblingBudgets.map((s: any) => {
              const v = (s.budget_versions || [])[0];
              return (
                <div key={s.id} className="rounded-md border p-3 text-sm flex justify-between">
                  <span>
                    {s.submitted_by_role === 'accountant' ? 'Accountant' : 'Team Leader'} submission
                  </span>
                  <span className="font-mono">{formatCurrency(Number(v?.total_amount_kes || 0), 'KES')}</span>
                </div>
              );
            })}
            <div className="space-y-2">
              <p className="text-sm font-medium">What should happen to the other version(s)?</p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="autoReject" checked={autoRejectChoice === 'leave'} onChange={() => setAutoRejectChoice('leave')} />
                Leave in current status (PM can still act on it)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="autoReject" checked={autoRejectChoice === 'reject'} onChange={() => setAutoRejectChoice('reject')} />
                Automatically reject (budget settled)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAutoRejectDialog(false)}>Cancel</Button>
            <Button onClick={performApproval} disabled={processing}>
              <Check className="h-4 w-4 mr-1" /> Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust amount dialog */}
      <Dialog open={!!adjustItem} onOpenChange={() => setAdjustItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Line Item Amount</DialogTitle>
            <DialogDescription>
              <strong>{adjustItem?.description}</strong> — submitted at {formatCurrency(Number(adjustItem?.amount_kes || 0), 'KES')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">Approved Amount (KES)</Label>
              <Input
                type="number"
                step="0.01"
                value={adjustAmount || ''}
                onChange={(e) => setAdjustAmount(parseFloat(e.target.value) || 0)}
                className="font-mono"
              />
              <p className="text-xs text-slate-400">Must be greater than 0</p>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">Reason for adjustment *</Label>
              <Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Why are you changing this amount?" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (adjustAmount <= 0 || !adjustReason.trim()) { toast.error('Amount and reason required'); return; }
              if (user?.role !== 'cfo' && adjustAmount > Number(adjustItem?.amount_kes || 0)) {
                toast.error('Adjusted amount cannot be higher than the submitted amount.');
                return;
              }
              const headers = await getAuthHeaders();
              const res = await fetch('/api/budgets/pm-line-review', {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ action: 'update_item', item_id: adjustItem.id, budget_id: id, pm_status: 'adjusted', pm_approved_amount: adjustAmount, reason: adjustReason }),
              });
              const data = await res.json();
              if (data.success) { toast.success('Amount adjusted'); setAdjustItem(null); await markPmReviewOpenedDirect(); load(); } else { toast.error(getUserErrorMessage(data?.error, 'Unable to save adjustment.')); }
            }} disabled={adjustAmount <= 0 || !adjustReason.trim() || (user?.role !== 'cfo' && adjustAmount > Number(adjustItem?.amount_kes || 0))}>Save Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
