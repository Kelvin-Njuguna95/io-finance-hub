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
import { BUDGET_EDITABLE_STATUSES } from '@/lib/budgets/status';

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-foreground/80',
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-warning-soft text-warning-soft-foreground',
  pm_review: 'bg-violet-soft text-violet-soft-foreground',
  pm_approved: 'bg-teal-100 text-teal-700',
  pm_rejected: 'bg-danger-soft text-danger-soft-foreground',
  returned_to_tl: 'bg-warning-soft text-warning-soft-foreground',
  approved: 'bg-success-soft text-success-soft-foreground',
  rejected: 'bg-danger-soft text-danger-soft-foreground',
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
  const [siblingBudgets, setSiblingBudgets] = useState</* // */ any[]>([]);
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
    const activeSiblings = siblings.filter((s: /* // */ any) => {
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
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/budgets/cfo-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          budget_id: budget!.id,
          action: 'approve',
          auto_reject_siblings: autoRejectChoice === 'reject',
          sibling_budget_ids: siblingBudgets.map((s: any) => s.id),
        }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Budget approved \u2014 expenses queued'); }
      else { toast.error(data.error || 'Failed to approve budget'); }
    } catch (e) { toast.error('Failed to approve budget'); }
    setShowAutoRejectDialog(false);
    setProcessing(false);
    load();
  }

  async function handleReject() {
    if (!activeVersion || !rejectionReason.trim()) return;
    setProcessing(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/budgets/cfo-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ budget_id: budget!.id, action: 'reject', reason: rejectionReason }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Budget rejected'); }
      else { toast.error(data.error || 'Failed to reject budget'); }
    } catch (e) { toast.error('Failed to reject budget'); }
    setShowRejectDialog(false);
    setRejectionReason('');
    setProcessing(false);
    load();
  }

  async function handleMarkUnderReview() {
    if (!activeVersion) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/budgets/cfo-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ budget_id: budget!.id, action: 'mark_under_review' }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Budget marked as under review'); }
      else { toast.error(data.error || 'Failed to update'); }
    } catch (e) { toast.error('Failed to update'); }
    load();
  }

  const isCfo = user?.role === 'cfo';
  const isPm = user?.role === 'project_manager';
  const isPmOrCfo = isPm || isCfo;
  const isAccountant = user?.role === 'accountant';
  const isTl = user?.role === 'team_leader';
  const isOwnBudget = budget?.created_by === user?.id;
  const budgetSubmittedByRole = (budget as /* // */ any)?.submitted_by_role || 'team_leader';
  const EDITABLE_STATUSES = BUDGET_EDITABLE_STATUSES;
  const canTlEdit =
    (isTl && EDITABLE_STATUSES.includes(activeVersion?.status || '')) ||
    (isAccountant && isOwnBudget && budgetSubmittedByRole === 'accountant' && EDITABLE_STATUSES.includes(activeVersion?.status || ''));
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
      setCategories((data || []).map((c: /* // */ any) => c.name));
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
      const newTotal = (allItems || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes), 0);
      await supabase.from('budget_versions').update({ total_amount_kes: newTotal }).eq('id', activeVersion.id);
    }
    setEditingItem(null);
    setSavingItem(false);
    toast.success('Line item updated');
    load();
  }

  async function handleDeleteItem(itemId: string) {
    const supabase = createClient();
    await supabase.from('budget_items').delete().eq('id', itemId);
    // Update version total
    if (activeVersion) {
      const { data: allItems } = await supabase.from('budget_items').select('amount_kes').eq('budget_version_id', activeVersion.id);
      const newTotal = (allItems || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes), 0);
      await supabase.from('budget_versions').update({ total_amount_kes: newTotal }).eq('id', activeVersion.id);
    }
    toast.success('Line item removed');
    load();
  }

  async function handleResubmit() {
    if (!budget || !activeVersion) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/budgets/resubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ budget_id: budget.id }),
      });
      const data = await res.json();
      if (data.success) { toast.success('Budget resubmitted for review'); }
      else { toast.error(data.error || 'Failed to resubmit'); }
    } catch (e) { toast.error('Failed to resubmit'); }
    load();
  }

  const pendingLineItems = items.filter((i: /* // */ any) => !i.pm_status || i.pm_status === 'pending').length;
  const canCfoApprove = isCfo && activeVersion?.status === 'pm_approved';
  const canPmReview = isPmOrCfo && activeVersion?.status === 'pm_review';
  // CFO can also do line-item review on pm_review, pm_approved, submitted budgets
  const canLineReview = canPmReview || (isCfo && ['pm_review', 'pm_approved', 'submitted', 'under_review'].includes(activeVersion?.status || ''));
  const [adjustItem, setAdjustItem] = useState</* // */ any>(null);
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
            <Button variant="outline" size="sm" onClick={() => setShowReturnDialog(true)} disabled={processing} className="gap-1 text-warning-soft-foreground">
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
              const reason = 'Returned by CFO';
              const headers = await getAuthHeaders();
              const res = await fetch('/api/budgets/cfo-revert', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ budget_id: id, action: 'send_back', reason }) });
              const data = await res.json();
              if (data.success) { toast.success('Budget sent back to TL'); load(); } else { toast.error(data.error); }
            }} className="text-warning-soft-foreground">Send Back to TL</Button>
            <Button variant="destructive" size="sm" onClick={async () => {
              const reason = 'Deleted by CFO';
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

            {(activeVersion as /* // */ any)?.pm_return_reason && activeVersion?.status === 'returned_to_tl' && (
              <Card className="border-warning/30 bg-warning-soft/50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-warning-soft-foreground">Returned by PM</p>
                  <p className="text-sm text-warning-soft-foreground mt-1">{(activeVersion as /* // */ any).pm_return_reason}</p>
                </CardContent>
              </Card>
            )}

            {(activeVersion as /* // */ any)?.pm_rejection_reason && (
              <Card className="border-danger/30 bg-danger-soft/50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-danger-soft-foreground">Rejected by PM</p>
                  <p className="text-sm text-danger-soft-foreground mt-1">{(activeVersion as /* // */ any).pm_rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {activeVersion?.rejection_reason && (
              <Card className="border-danger/30 bg-danger-soft/50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-danger-soft-foreground">Rejection Reason</p>
                  <p className="text-sm text-danger-soft-foreground mt-1">{activeVersion.rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Bulk actions for PM and CFO */}
            {canLineReview && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={async () => {
                  const pendingIds = items.filter((i: /* // */ any) => (i as /* // */ any).pm_status === 'pending' || !(i as /* // */ any).pm_status).map(i => i.id);
                  if (pendingIds.length === 0) { toast.info('No pending items'); return; }
                  const headers = await getAuthHeaders();
                  await fetch('/api/budgets/pm-line-review', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ action: 'bulk_approve', items: pendingIds, budget_id: id }),
                  });
                  toast.success('Approved ' + pendingIds.length + ' items');
                  load();
                }} className="gap-1 text-success-soft-foreground">Approve All</Button>
                {isCfo && !isPm && (
                  <span className="text-xs text-warning-soft-foreground">
                    Mark all line items for PM review. Use &quot;Approve Budget&quot; below to finalise.
                  </span>
                )}
                <Button variant="outline" size="sm" onClick={async () => {
                  const reason = 'Bulk remove';
                  const pendingIds = items.filter((i: /* // */ any) => (i as /* // */ any).pm_status === 'pending' || !(i as /* // */ any).pm_status).map(i => i.id);
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
                }} className="gap-1 text-danger-soft-foreground">Remove All Pending</Button>
                <span className="text-xs text-muted-foreground">
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
                    {items.map((item: /* // */ any, idx) => {
                      const pmStatus = item.pm_status || 'pending';
                      const isRemoved = pmStatus === 'removed';
                      return (
                      <TableRow key={item.id} className={isRemoved ? 'bg-danger-soft/50 line-through opacity-60' : pmStatus === 'approved' ? 'bg-success-soft/50' : pmStatus === 'adjusted' ? 'bg-warning-soft/50' : ''}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">
                          {editingItem === item.id ? (
                            <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="text-sm h-8" />
                          ) : item.description}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {editingItem === item.id ? (
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="w-full rounded-md border border-border px-2 py-1 text-sm bg-card"
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
                                <Button size="sm" variant="ghost" className="h-7 text-xs text-danger-soft-foreground" onClick={() => handleDeleteItem(item.id)}>Remove</Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell>
                            <Badge variant="secondary" className={
                              pmStatus === 'approved' ? 'bg-success-soft text-success-soft-foreground' :
                              pmStatus === 'adjusted' ? 'bg-warning-soft text-warning-soft-foreground' :
                              pmStatus === 'removed' ? 'bg-danger-soft text-danger-soft-foreground' :
                              'bg-muted text-muted-foreground'
                            }>{pmStatus === 'pending' ? 'Pending' : capitalize(pmStatus)}</Badge>
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-right font-mono text-sm">
                            {pmStatus === 'approved' ? <span className="text-success-soft-foreground">{formatCurrency(Number(item.pm_approved_amount || item.amount_kes), 'KES')}</span> :
                             pmStatus === 'adjusted' ? <span className="text-warning-soft-foreground">{formatCurrency(Number(item.pm_approved_amount), 'KES')}</span> :
                             pmStatus === 'removed' ? <span className="text-danger-soft-foreground">KES 0</span> : '—'}
                          </TableCell>
                        )}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{item.pm_adjustment_reason || '—'}</TableCell>
                        )}
                        {canLineReview && (
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {pmStatus !== 'approved' && (
                                <Button variant="ghost" size="sm" className="text-xs text-success-soft-foreground h-7" disabled={lineActionId === item.id} onClick={async () => {
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
                                <Button variant="ghost" size="sm" className="text-xs text-warning-soft-foreground h-7" onClick={() => {
                                  setAdjustItem(item);
                                  setAdjustAmount(Number(item.amount_kes));
                                  setAdjustReason('');
                                }}>Adjust</Button>
                              )}
                              {pmStatus !== 'removed' && (
                                <Button variant="ghost" size="sm" className="text-xs text-danger-soft-foreground h-7" disabled={lineActionId === item.id} onClick={() => {
                                  const reason = 'Removed item';
                                  setLineActionId(item.id);
                                  getAuthHeaders().then(headers => {
                                    fetch('/api/budgets/pm-line-review', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
                                      body: JSON.stringify({ action: 'update_item', item_id: item.id, budget_id: id, pm_status: 'removed', reason }) }).then(() => markPmReviewOpenedDirect()).then(() => load()).finally(() => setLineActionId(null));
                                  }).catch(() => setLineActionId(null));
                                }}>Remove</Button>
                              )}
                              {pmStatus !== 'pending' && (
                                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7" disabled={lineActionId === item.id} onClick={async () => {
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
                          {formatCurrency(items.reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes), 0), 'KES')}
                        </TableCell>
                        {(canLineReview || isPm || isCfo) && <TableCell></TableCell>}
                        {(canLineReview || isPm || isCfo) && (
                          <TableCell className="text-right font-mono text-success-soft-foreground">
                            {formatCurrency(items.filter((i: /* // */ any) => ['approved', 'adjusted'].includes(i.pm_status)).reduce((s: number, i: /* // */ any) => s + Number(i.pm_approved_amount || 0), 0), 'KES')}
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

            {/* Submit / Resubmit button — available whenever the current user can edit this budget */}
            {canTlEdit && EDITABLE_STATUSES.includes(activeVersion?.status || '') && (
              <div className="flex justify-end">
                <Button onClick={handleResubmit} className="btn-gradient text-white gap-1" disabled={processing || items.length === 0}>
                  {activeVersion?.status === 'draft' ? 'Submit for PM Review' : 'Resubmit for PM Review'}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="space-y-2">
            {versions.map((v) => (
              <Card
                key={v.id}
                className={`cursor-pointer transition-colors ${v.id === activeVersion?.id ? 'border-foreground' : 'hover:border-border-strong'}`}
                onClick={() => selectVersion(v)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">v{v.version_number}</span>
                    <Badge variant="secondary" className={statusColors[v.status]}>
                      {capitalize(v.status)}
                    </Badge>
                    {v.submitted_at && (
                      <span className="text-xs text-muted-foreground">
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
                    <span className="text-muted-foreground">{formatDateTime(a.created_at)}</span>
                    {a.reason && <span className="text-foreground/80">— {a.reason}</span>}
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
            {siblingBudgets.map((s: /* // */ any) => {
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
              <p className="text-xs text-muted-foreground">Must be greater than 0</p>
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
