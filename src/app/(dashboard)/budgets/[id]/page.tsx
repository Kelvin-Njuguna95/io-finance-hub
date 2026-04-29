'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useBudgetDetail } from '@/hooks/use-budget-detail';
import { PageTitle } from '@/components/layout/page-title';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/format';
import { getUserErrorMessage } from '@/lib/errors';
import { BUDGET_EDITABLE_STATUSES } from '@/lib/budgets/status';
import { ROLE_LABELS, type UserRole } from '@/types/database';
import { cn } from '@/lib/utils';

import { VarianceHero } from '@/components/budgets/variance-hero';
import { ActivityTimeline } from '@/components/budgets/activity-timeline';
import {
  ApproverChain,
  type ApproverChainEntry,
  type ApproverChainStatus,
} from '@/components/budgets/approver-chain';

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-foreground/80',
  submitted: 'bg-info-soft text-info-soft-foreground',
  under_review: 'bg-warning-soft text-warning-soft-foreground',
  pm_review: 'bg-warning-soft text-warning-soft-foreground',
  pm_approved: 'bg-success-soft text-success-soft-foreground',
  pm_rejected: 'bg-danger-soft text-danger-soft-foreground',
  returned_to_tl: 'bg-warning-soft text-warning-soft-foreground',
  approved: 'bg-success-soft text-success-soft-foreground',
  rejected: 'bg-danger-soft text-danger-soft-foreground',
};

const NAIROBI_TZ = 'Africa/Nairobi';

function compactId(yearMonth: string, id: string): string {
  const [y, m] = yearMonth.split('-');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `BUD-${y}${m}-${tail}`;
}

function monthAccent(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number.parseInt(yStr ?? '', 10);
  const m = Number.parseInt(mStr ?? '', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yearMonth;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    month: 'short',
    year: 'numeric',
  }).format(new Date(y, m - 1, 1));
}

function periodDays(yearMonth: string): { daysElapsed: number; daysInMonth: number } {
  const [yStr, mStr] = yearMonth.split('-');
  const y = Number.parseInt(yStr ?? '', 10);
  const m = Number.parseInt(mStr ?? '', 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return { daysElapsed: 0, daysInMonth: 30 };
  const daysInMonth = new Date(y, m, 0).getDate();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const ty = Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '', 10);
  const tm = Number.parseInt(parts.find((p) => p.type === 'month')?.value ?? '', 10);
  const td = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '', 10);
  if (ty < y || (ty === y && tm < m)) return { daysElapsed: 0, daysInMonth };
  if (ty > y || (ty === y && tm > m)) return { daysElapsed: daysInMonth, daysInMonth };
  return { daysElapsed: Math.min(td, daysInMonth), daysInMonth };
}

function shortRole(role: string | null | undefined): string {
  if (!role) return '—';
  if (role === 'project_manager') return 'PM';
  if (role === 'team_leader') return 'TL';
  if (role === 'cfo') return 'CFO';
  return ROLE_LABELS[role as UserRole] ?? role;
}

function statusEyebrowLabel(
  status: string | undefined,
  approvedKes: number,
  spentKes: number,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' | 'info' } {
  if (approvedKes > 0 && spentKes > approvedKes)
    return { label: 'Over plan', tone: 'danger' };
  if (!status) return { label: 'Draft', tone: 'muted' };
  if (status === 'approved') return { label: 'Approved', tone: 'success' };
  if (status === 'pm_approved') return { label: 'PM approved', tone: 'success' };
  if (status === 'rejected' || status === 'pm_rejected')
    return { label: 'Rejected', tone: 'danger' };
  if (status === 'returned_to_tl') return { label: 'Returned', tone: 'warning' };
  if (status === 'draft') return { label: 'Draft', tone: 'muted' };
  return { label: 'Pending', tone: 'warning' };
}

const TONE_CLASS = {
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
  muted: 'bg-muted text-foreground/80',
  info: 'bg-info-soft text-info-soft-foreground',
} as const;

export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const router = useRouter();

  const detail = useBudgetDetail(id);
  const {
    budget,
    versions,
    items,
    approvals,
    activeVersion,
    setActiveVersionId,
    spentKes,
    events,
    userNames,
    refresh: load,
  } = detail;

  const scopeName =
    budget?.projects?.name ??
    budget?.departments?.name ??
    '—';

  // Dialogs + ephemeral state (preserved from prior implementation).
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [showPmRejectDialog, setShowPmRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [returnComments, setReturnComments] = useState('');
  const [pmRejectReason, setPmRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [lineActionId, setLineActionId] = useState<string | null>(null);

  const [showAutoRejectDialog, setShowAutoRejectDialog] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [siblingBudgets, setSiblingBudgets] = useState<any[]>([]);
  const [autoRejectChoice, setAutoRejectChoice] = useState<'leave' | 'reject'>('leave');

  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [savingItem, setSavingItem] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');

  // Categories for inline edit dropdown — preserved as separate effect.
  useEffect(() => {
    async function loadCats() {
      const supabase = createClient();
      const { data } = await supabase
        .from('expense_categories')
        .select('name')
        .eq('is_active', true)
        .neq('name', 'Administration')
        .order('name');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCategories((data || []).map((c: any) => c.name));
    }
    loadCats();
  }, []);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function checkSiblingBudgets() {
    if (!budget?.project_id) return [];
    const supabase = createClient();
    const { data } = await supabase
      .from('budgets')
      .select(
        'id, submitted_by_role, created_by, budget_versions(status, total_amount_kes, version_number)',
      )
      .eq('project_id', budget.project_id)
      .eq('year_month', budget.year_month)
      .neq('id', budget.id);
    return data || [];
  }

  async function handleApprove() {
    if (!activeVersion) return;
    const siblings = await checkSiblingBudgets();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/budgets/cfo-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          budget_id: budget!.id,
          action: 'approve',
          auto_reject_siblings: autoRejectChoice === 'reject',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sibling_budget_ids: siblingBudgets.map((s: any) => s.id),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Budget approved — expenses queued');
      } else {
        toast.error(data.error || 'Failed to approve budget');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      toast.error('Failed to approve budget');
    }
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
        body: JSON.stringify({
          budget_id: budget!.id,
          action: 'reject',
          reason: rejectionReason,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Budget rejected');
      } else {
        toast.error(data.error || 'Failed to reject budget');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      toast.error('Failed to reject budget');
    }
    setShowRejectDialog(false);
    setRejectionReason('');
    setProcessing(false);
    load();
  }

  async function handleSaveItem(itemId: string) {
    setSavingItem(true);
    const supabase = createClient();
    await supabase
      .from('budget_items')
      .update({
        description: editDesc,
        category: editCategory || null,
        amount_kes: editAmount,
        unit_cost_kes: editAmount,
      })
      .eq('id', itemId);
    if (activeVersion) {
      const { data: allItems } = await supabase
        .from('budget_items')
        .select('amount_kes')
        .eq('budget_version_id', activeVersion.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
      await supabase
        .from('budget_versions')
        .update({ total_amount_kes: newTotal })
        .eq('id', activeVersion.id);
    }
    setEditingItem(null);
    setSavingItem(false);
    toast.success('Line item updated');
    load();
  }

  async function handleDeleteItem(itemId: string) {
    const supabase = createClient();
    await supabase.from('budget_items').delete().eq('id', itemId);
    if (activeVersion) {
      const { data: allItems } = await supabase
        .from('budget_items')
        .select('amount_kes')
        .eq('budget_version_id', activeVersion.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newTotal = (allItems || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
      await supabase
        .from('budget_versions')
        .update({ total_amount_kes: newTotal })
        .eq('id', activeVersion.id);
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
      if (data.success) {
        toast.success('Budget resubmitted for review');
      } else {
        toast.error(data.error || 'Failed to resubmit');
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      toast.error('Failed to resubmit');
    }
    load();
  }

  async function handlePmAction(action: string, comments?: string) {
    setProcessing(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch('/api/budgets/pm-review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ budget_id: id, action, comments }),
    });
    const result = await res.json();
    if (result.success) {
      toast.success(
        action === 'approve'
          ? 'Budget approved — sent to CFO'
          : action === 'return'
            ? 'Budget returned to TL'
            : 'Budget rejected',
      );
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
    await supabase
      .from('budgets')
      .update({
        pm_review_opened_at: new Date().toISOString(),
        pm_reviewer_id: user?.id || null,
      })
      .eq('id', budget.id);
  }

  // Role flags.
  const isCfo = user?.role === 'cfo';
  const isPm = user?.role === 'project_manager';
  const isPmOrCfo = isPm || isCfo;
  const isAccountant = user?.role === 'accountant';
  const isTl = user?.role === 'team_leader';
  const isOwnBudget = budget?.created_by === user?.id;
  const budgetSubmittedByRole =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (budget as any)?.submitted_by_role || 'team_leader';
  const EDITABLE_STATUSES = BUDGET_EDITABLE_STATUSES;
  const canTlEdit =
    (isTl &&
      EDITABLE_STATUSES.includes(
        (activeVersion?.status || '') as (typeof BUDGET_EDITABLE_STATUSES)[number],
      )) ||
    (isAccountant &&
      isOwnBudget &&
      budgetSubmittedByRole === 'accountant' &&
      EDITABLE_STATUSES.includes(
        (activeVersion?.status || '') as (typeof BUDGET_EDITABLE_STATUSES)[number],
      ));

  const pendingLineItems = items.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (i: any) => !i.pm_status || i.pm_status === 'pending',
  ).length;
  const canCfoApprove = isCfo && activeVersion?.status === 'pm_approved';
  const canPmReview = isPmOrCfo && activeVersion?.status === 'pm_review';
  const canLineReview =
    canPmReview ||
    (isCfo &&
      ['pm_review', 'pm_approved', 'submitted', 'under_review'].includes(
        activeVersion?.status || '',
      ));

  useEffect(() => {
    if (canPmReview && budget?.id && !budget.pm_review_opened_at) {
      markPmReviewOpenedDirect()
        .then(() => load())
        .catch((e) => console.error('Failed to mark PM review opened:', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budget?.id, budget?.pm_review_opened_at, canPmReview]);

  // Derive header data.
  const eyebrowId = budget ? compactId(budget.year_month, budget.id) : '—';
  const monthLabel = budget ? monthAccent(budget.year_month) : '';
  const versionLine = activeVersion
    ? activeVersion.version_number === 1
      ? 'v1 · first submission'
      : `v${activeVersion.version_number} · revised`
    : '';
  const approvedKes = Number(activeVersion?.total_amount_kes ?? 0);
  const eyebrowStatus = statusEyebrowLabel(
    activeVersion?.status,
    approvedKes,
    spentKes,
  );
  const { daysElapsed, daysInMonth } = budget
    ? periodDays(budget.year_month)
    : { daysElapsed: 0, daysInMonth: 30 };

  // Approver chain derivation from existing data shape.
  const approverChain = useMemo<ApproverChainEntry[]>(() => {
    const chain: ApproverChainEntry[] = [];
    if (!budget) return chain;

    const authorName = userNames.get(budget.created_by) ?? '—';
    const authorRole = budgetSubmittedByRole;
    chain.push({
      role: shortRole(authorRole),
      name: authorName,
      status: 'approved',
      description: `${shortRole(authorRole)} · author`,
      at: activeVersion?.submitted_at ?? undefined,
    });

    const isProjectScope = Boolean(budget.project_id);
    if (
      isProjectScope &&
      authorRole !== 'project_manager' &&
      authorRole !== 'cfo'
    ) {
      let pmStatus: ApproverChainStatus = 'pending';
      const status = activeVersion?.status;
      if (status === 'pm_review' || status === 'under_review') pmStatus = 'opened';
      else if (status === 'pm_approved' || status === 'approved') pmStatus = 'approved';
      else if (status === 'pm_rejected') pmStatus = 'rejected';
      else if (status === 'returned_to_tl') pmStatus = 'sent_back';

      chain.push({
        role: 'PM',
        name: budget.pm_reviewer_id
          ? userNames.get(budget.pm_reviewer_id)
          : undefined,
        status: pmStatus,
        description: 'Project Manager · review',
        at: budget.pm_review_opened_at ?? undefined,
      });
    }

    let cfoStatus: ApproverChainStatus = 'pending';
    let cfoAt: string | undefined;
    let cfoName: string | undefined;
    const cfoApproval = approvals.find((a) => a.action === 'approved');
    const cfoRejection = approvals.find((a) => a.action === 'rejected');
    if (activeVersion?.status === 'approved') {
      cfoStatus = 'approved';
      cfoAt = cfoApproval?.created_at;
      cfoName = cfoApproval ? userNames.get(cfoApproval.approved_by) : undefined;
    } else if (activeVersion?.status === 'rejected') {
      cfoStatus = 'rejected';
      cfoAt = cfoRejection?.created_at;
      cfoName = cfoRejection ? userNames.get(cfoRejection.approved_by) : undefined;
    }

    chain.push({
      role: 'CFO',
      name: cfoName,
      status: cfoStatus,
      description: 'CFO · final approval',
      at: cfoAt,
    });

    return chain;
  }, [budget, activeVersion, approvals, userNames, budgetSubmittedByRole]);

  return (
    <div>
      {/* Header band */}
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <div className="space-y-3">
          {/* Eyebrow row: ID · status pill · version line */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>{eyebrowId}</span>
            <span
              className={cn(
                'inline-flex h-5 items-center rounded-[var(--radius-sm)] px-2 text-[10.5px] font-medium tracking-[0.06em]',
                TONE_CLASS[eyebrowStatus.tone],
              )}
            >
              {eyebrowStatus.label}
            </span>
            <span aria-hidden className="text-muted-foreground/60">·</span>
            <span>{versionLine}</span>
          </div>

          <PageTitle
            primary={scopeName}
            accent={monthLabel}
            subtitle={
              budget
                ? `Owned by ${userNames.get(budget.created_by) ?? '—'}, ${shortRole(budgetSubmittedByRole)}`
                : ''
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                {canPmReview && (
                  <>
                    <Button
                      onClick={async () => {
                        if (pendingLineItems > 0) {
                          toast.error(
                            'Please action all line items before submitting review.',
                          );
                          return;
                        }
                        setSubmittingReview(true);
                        try {
                          const headers = await getAuthHeaders();
                          const res = await fetch('/api/budgets/pm-line-review', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              ...headers,
                            },
                            body: JSON.stringify({
                              action: 'submit_review',
                              budget_id: id,
                            }),
                          });
                          const data = await res.json();
                          if (data.success) {
                            toast.success('Review submitted — sent to CFO');
                            load();
                          } else {
                            toast.error(
                              getUserErrorMessage(
                                data?.error,
                                'Failed to submit PM review.',
                              ),
                            );
                          }
                        } catch (error) {
                          toast.error(
                            getUserErrorMessage(error, 'Failed to submit PM review.'),
                          );
                        } finally {
                          setSubmittingReview(false);
                        }
                      }}
                      disabled={
                        processing || submittingReview || pendingLineItems > 0
                      }
                      size="sm"
                      className="gap-1 bg-teal-600 hover:bg-teal-700"
                    >
                      <Check className="h-4 w-4" /> Submit Review
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReturnDialog(true)}
                      disabled={processing}
                      className="gap-1 text-warning-soft-foreground"
                    >
                      Return to TL
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowPmRejectDialog(true)}
                      disabled={processing}
                      className="gap-1"
                    >
                      <X className="h-4 w-4" /> Reject
                    </Button>
                  </>
                )}
                {canCfoApprove && (
                  <>
                    <Button
                      onClick={handleApprove}
                      disabled={processing}
                      size="sm"
                      className="gap-1"
                    >
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
                  </>
                )}
                {isCfo && activeVersion?.status === 'approved' && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const reason = 'Returned by CFO';
                        const headers = await getAuthHeaders();
                        const res = await fetch('/api/budgets/cfo-revert', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            ...headers,
                          },
                          body: JSON.stringify({
                            budget_id: id,
                            action: 'send_back',
                            reason,
                          }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          toast.success('Budget sent back to TL');
                          load();
                        } else {
                          toast.error(data.error);
                        }
                      }}
                      className="text-warning-soft-foreground"
                    >
                      Send Back to TL
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        const reason = 'Deleted by CFO';
                        const headers = await getAuthHeaders();
                        const res = await fetch('/api/budgets/cfo-revert', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            ...headers,
                          },
                          body: JSON.stringify({
                            budget_id: id,
                            action: 'delete',
                            reason,
                          }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          toast.success('Budget deleted');
                          window.location.href = '/budgets';
                        } else {
                          toast.error(data.error);
                        }
                      }}
                    >
                      Delete Budget
                    </Button>
                  </>
                )}
              </div>
            }
          />
        </div>
      </div>

      <div className="space-y-6 p-6">
        {/* Variance hero */}
        {budget && (
          <VarianceHero
            approvedKes={approvedKes}
            spentKes={spentKes}
            yearMonth={budget.year_month}
            daysElapsed={daysElapsed}
            daysInMonth={daysInMonth}
          />
        )}

        {/* Returned / rejected reason cards */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(activeVersion as any)?.pm_return_reason &&
          activeVersion?.status === 'returned_to_tl' && (
            <Card className="border-warning/30 bg-warning-soft/50">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-warning-soft-foreground">
                  Returned by PM
                </p>
                <p className="mt-1 text-sm text-warning-soft-foreground">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {(activeVersion as any).pm_return_reason}
                </p>
              </CardContent>
            </Card>
          )}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(activeVersion as any)?.pm_rejection_reason && (
          <Card className="border-danger/30 bg-danger-soft/50">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-danger-soft-foreground">
                Rejected by PM
              </p>
              <p className="mt-1 text-sm text-danger-soft-foreground">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(activeVersion as any).pm_rejection_reason}
              </p>
            </CardContent>
          </Card>
        )}
        {activeVersion?.rejection_reason && (
          <Card className="border-danger/30 bg-danger-soft/50">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-danger-soft-foreground">
                Rejection Reason
              </p>
              <p className="mt-1 text-sm text-danger-soft-foreground">
                {activeVersion.rejection_reason}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Two-column body */}
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <main className="min-w-0 space-y-6">
            {/* Bulk actions for PM/CFO line review */}
            {canLineReview && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const pendingIds = items
                      .filter(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (i: any) =>
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (i as any).pm_status === 'pending' ||
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          !(i as any).pm_status,
                      )
                      .map((i) => i.id);
                    if (pendingIds.length === 0) {
                      toast.info('No pending items');
                      return;
                    }
                    const headers = await getAuthHeaders();
                    await fetch('/api/budgets/pm-line-review', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...headers,
                      },
                      body: JSON.stringify({
                        action: 'bulk_approve',
                        items: pendingIds,
                        budget_id: id,
                      }),
                    });
                    toast.success('Approved ' + pendingIds.length + ' items');
                    load();
                  }}
                  className="gap-1 text-success-soft-foreground"
                >
                  Approve All
                </Button>
                {isCfo && !isPm && (
                  <span className="text-xs text-warning-soft-foreground">
                    Mark all line items for PM review. Use &quot;Approve&quot;
                    above to finalise the budget.
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const reason = 'Bulk remove';
                    const pendingIds = items
                      .filter(
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (i: any) =>
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          (i as any).pm_status === 'pending' ||
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          !(i as any).pm_status,
                      )
                      .map((i) => i.id);
                    if (pendingIds.length === 0) {
                      toast.info('No pending items');
                      return;
                    }
                    const headers = await getAuthHeaders();
                    for (const itemId of pendingIds) {
                      await fetch('/api/budgets/pm-line-review', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          ...headers,
                        },
                        body: JSON.stringify({
                          action: 'update_item',
                          item_id: itemId,
                          budget_id: id,
                          pm_status: 'removed',
                          reason,
                        }),
                      });
                    }
                    toast.success('Removed ' + pendingIds.length + ' items');
                    load();
                  }}
                  className="gap-1 text-danger-soft-foreground"
                >
                  Remove All Pending
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {pendingLineItems} pending
                </span>
              </div>
            )}

            {/* Line items table */}
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <header className="flex items-baseline justify-between border-b border-border/70 px-5 py-3">
                <h3 className="font-display text-[15px] font-medium text-foreground">
                  Line items
                </h3>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                  {items.length} {items.length === 1 ? 'line' : 'lines'}
                </span>
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">
                      {canTlEdit ? 'Amount (KES)' : 'Approved (KES)'}
                    </TableHead>
                    {canTlEdit && <TableHead className="w-[140px]">Actions</TableHead>}
                    {canLineReview && <TableHead>PM Decision</TableHead>}
                    {canLineReview && (
                      <TableHead className="text-right">Approved (KES)</TableHead>
                    )}
                    {canLineReview && <TableHead>Reason</TableHead>}
                    {canLineReview && <TableHead className="w-[180px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {items.map((item: any, idx) => {
                    const pmStatus = item.pm_status || 'pending';
                    const isRemoved = pmStatus === 'removed';
                    return (
                      <TableRow
                        key={item.id}
                        className={
                          isRemoved
                            ? 'bg-danger-soft/50 line-through opacity-60'
                            : pmStatus === 'approved'
                              ? 'bg-success-soft/50'
                              : pmStatus === 'adjusted'
                                ? 'bg-warning-soft/50'
                                : ''
                        }
                      >
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">
                          {editingItem === item.id ? (
                            <Input
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              className="h-8 text-sm"
                            />
                          ) : (
                            item.description
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {editingItem === item.id ? (
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="w-full rounded-md border border-border bg-card px-2 py-1 text-sm"
                            >
                              <option value="">— Select —</option>
                              {categories.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          ) : (
                            item.category || '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {editingItem === item.id ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editAmount || ''}
                              onChange={(e) =>
                                setEditAmount(parseFloat(e.target.value) || 0)
                              }
                              className="ml-auto h-8 w-32 text-right text-sm"
                            />
                          ) : (
                            formatCurrency(Number(item.amount_kes), 'KES')
                          )}
                        </TableCell>
                        {canTlEdit && (
                          <TableCell>
                            {editingItem === item.id ? (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => handleSaveItem(item.id)}
                                  disabled={savingItem}
                                >
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => setEditingItem(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setEditingItem(item.id);
                                    setEditDesc(item.description);
                                    setEditCategory(item.category || '');
                                    setEditAmount(Number(item.amount_kes));
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs text-danger-soft-foreground"
                                  onClick={() => handleDeleteItem(item.id)}
                                >
                                  Remove
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                        {canLineReview && (
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                pmStatus === 'approved'
                                  ? 'bg-success-soft text-success-soft-foreground'
                                  : pmStatus === 'adjusted'
                                    ? 'bg-warning-soft text-warning-soft-foreground'
                                    : pmStatus === 'removed'
                                      ? 'bg-danger-soft text-danger-soft-foreground'
                                      : 'bg-muted text-muted-foreground'
                              }
                            >
                              {pmStatus === 'pending' ? 'Pending' : capitalize(pmStatus)}
                            </Badge>
                          </TableCell>
                        )}
                        {canLineReview && (
                          <TableCell className="text-right font-mono text-sm">
                            {pmStatus === 'approved' ? (
                              <span className="text-success-soft-foreground">
                                {formatCurrency(
                                  Number(item.pm_approved_amount || item.amount_kes),
                                  'KES',
                                )}
                              </span>
                            ) : pmStatus === 'adjusted' ? (
                              <span className="text-warning-soft-foreground">
                                {formatCurrency(Number(item.pm_approved_amount), 'KES')}
                              </span>
                            ) : pmStatus === 'removed' ? (
                              <span className="text-danger-soft-foreground">KES 0</span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        )}
                        {canLineReview && (
                          <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                            {item.pm_adjustment_reason || '—'}
                          </TableCell>
                        )}
                        {canLineReview && (
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {pmStatus !== 'approved' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-success-soft-foreground"
                                  disabled={lineActionId === item.id}
                                  onClick={async () => {
                                    setLineActionId(item.id);
                                    try {
                                      const headers = await getAuthHeaders();
                                      const res = await fetch(
                                        '/api/budgets/pm-line-review',
                                        {
                                          method: 'POST',
                                          headers: {
                                            'Content-Type': 'application/json',
                                            ...headers,
                                          },
                                          body: JSON.stringify({
                                            action: 'update_item',
                                            item_id: item.id,
                                            budget_id: id,
                                            pm_status: 'approved',
                                          }),
                                        },
                                      );
                                      const data = await res.json();
                                      if (!data.success)
                                        toast.error(
                                          getUserErrorMessage(
                                            data?.error,
                                            'Unable to approve line item.',
                                          ),
                                        );
                                      await markPmReviewOpenedDirect();
                                      load();
                                    } finally {
                                      setLineActionId(null);
                                    }
                                  }}
                                >
                                  Approve
                                </Button>
                              )}
                              {pmStatus !== 'adjusted' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-warning-soft-foreground"
                                  onClick={() => {
                                    setAdjustItem(item);
                                    setAdjustAmount(Number(item.amount_kes));
                                    setAdjustReason('');
                                  }}
                                >
                                  Adjust
                                </Button>
                              )}
                              {pmStatus !== 'removed' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-danger-soft-foreground"
                                  disabled={lineActionId === item.id}
                                  onClick={() => {
                                    const reason = 'Removed item';
                                    setLineActionId(item.id);
                                    getAuthHeaders()
                                      .then((headers) => {
                                        fetch('/api/budgets/pm-line-review', {
                                          method: 'POST',
                                          headers: {
                                            'Content-Type': 'application/json',
                                            ...headers,
                                          },
                                          body: JSON.stringify({
                                            action: 'update_item',
                                            item_id: item.id,
                                            budget_id: id,
                                            pm_status: 'removed',
                                            reason,
                                          }),
                                        })
                                          .then(() => markPmReviewOpenedDirect())
                                          .then(() => load())
                                          .finally(() => setLineActionId(null));
                                      })
                                      .catch(() => setLineActionId(null));
                                  }}
                                >
                                  Remove
                                </Button>
                              )}
                              {pmStatus !== 'pending' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-muted-foreground"
                                  disabled={lineActionId === item.id}
                                  onClick={async () => {
                                    setLineActionId(item.id);
                                    try {
                                      const headers = await getAuthHeaders();
                                      await fetch('/api/budgets/pm-line-review', {
                                        method: 'POST',
                                        headers: {
                                          'Content-Type': 'application/json',
                                          ...headers,
                                        },
                                        body: JSON.stringify({
                                          action: 'update_item',
                                          item_id: item.id,
                                          budget_id: id,
                                          pm_status: 'pending',
                                        }),
                                      });
                                      load();
                                    } finally {
                                      setLineActionId(null);
                                    }
                                  }}
                                >
                                  Undo
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {items.length > 0 && (
                    <TableRow className="font-semibold">
                      <TableCell colSpan={3} className="text-right">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          items.reduce((s: number, i: any) => s + Number(i.amount_kes), 0),
                          'KES',
                        )}
                      </TableCell>
                      {canTlEdit && <TableCell />}
                      {canLineReview && <TableCell />}
                      {canLineReview && (
                        <TableCell className="text-right font-mono text-success-soft-foreground">
                          {formatCurrency(
                            items
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              .filter((i: any) =>
                                ['approved', 'adjusted'].includes(i.pm_status),
                              )
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              .reduce(
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (s: number, i: any) =>
                                  s + Number(i.pm_approved_amount || 0),
                                0,
                              ),
                            'KES',
                          )}
                        </TableCell>
                      )}
                      {canLineReview && <TableCell />}
                      {canLineReview && <TableCell />}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </section>

            {/* Submit / Resubmit affordance */}
            {canTlEdit &&
              EDITABLE_STATUSES.includes(
                (activeVersion?.status || '') as (typeof BUDGET_EDITABLE_STATUSES)[number],
              ) && (
                <div className="flex justify-end">
                  <Button
                    onClick={handleResubmit}
                    className="btn-gradient gap-1 text-white"
                    disabled={processing || items.length === 0}
                  >
                    {activeVersion?.status === 'draft'
                      ? 'Submit for PM Review'
                      : 'Resubmit for PM Review'}
                  </Button>
                </div>
              )}

            {/* Activity timeline */}
            <ActivityTimeline events={events} />
          </main>

          {/* Sidebar */}
          <aside className="space-y-6">
            <ApproverChain chain={approverChain} />

            {/* Versions card */}
            <div className="rounded-lg border border-border bg-card px-5 py-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Versions
              </p>
              <ul className="mt-3 space-y-2">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className={cn(
                      'cursor-pointer rounded-lg border px-3 py-2 transition-colors',
                      v.id === activeVersion?.id
                        ? 'border-foreground bg-muted/40'
                        : 'border-border hover:border-border-strong',
                    )}
                    onClick={() => setActiveVersionId(v.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">v{v.version_number}</span>
                      <Badge
                        variant="secondary"
                        className={statusColors[v.status] ?? 'bg-muted'}
                      >
                        {capitalize(v.status)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
                      <span>
                        {v.submitted_at ? formatDateTime(v.submitted_at) : '—'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatCurrency(Number(v.total_amount_kes), 'KES')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {approvals.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    Approval history
                  </p>
                  <ul className="mt-3 space-y-2">
                    {approvals.map((a) => (
                      <li key={a.id} className="rounded-md border border-border/70 px-3 py-2 text-[12px]">
                        <div className="flex items-center justify-between">
                          <Badge
                            variant={a.action === 'approved' ? 'default' : 'destructive'}
                          >
                            {a.action}
                          </Badge>
                          <span className="text-muted-foreground">
                            {formatDateTime(a.created_at)}
                          </span>
                        </div>
                        {a.reason && (
                          <p className="mt-1 text-muted-foreground">{a.reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Linked records */}
            <div className="rounded-lg border border-border bg-card px-5 py-5">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Linked records
              </p>
              <ul className="mt-3 space-y-2 text-[13px]">
                {budget?.project_id && (
                  <li>
                    <button
                      type="button"
                      className="text-foreground underline-offset-4 hover:underline"
                      onClick={() => router.push('/projects')}
                    >
                      Project · {scopeName}
                    </button>
                  </li>
                )}
                <li className="text-muted-foreground">
                  Confirmed expenses to date:{' '}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatCurrency(spentKes, 'KES')}
                  </span>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {/* Rejection dialog (CFO) — preserved verbatim */}
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
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
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

      {/* PM Return dialog — preserved verbatim */}
      <Dialog open={showReturnDialog} onOpenChange={setShowReturnDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Budget to Team Leader</DialogTitle>
            <DialogDescription>
              The TL will be able to edit and resubmit.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="What should the TL change? (required)"
            value={returnComments}
            onChange={(e) => setReturnComments(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReturnDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handlePmAction('return', returnComments)}
              disabled={processing || !returnComments.trim()}
            >
              Send Back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PM Reject dialog — preserved verbatim */}
      <Dialog open={showPmRejectDialog} onOpenChange={setShowPmRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Budget</DialogTitle>
            <DialogDescription>
              This will permanently close this budget. The TL will need to create
              a new budget from scratch.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason (required)"
            value={pmRejectReason}
            onChange={(e) => setPmRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPmRejectDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handlePmAction('reject', pmRejectReason)}
              disabled={processing || !pmRejectReason.trim()}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CFO Auto-reject sibling dialog — preserved verbatim */}
      <Dialog open={showAutoRejectDialog} onOpenChange={setShowAutoRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Other Budget Versions Exist</DialogTitle>
            <DialogDescription>
              You are approving this budget as the official budget. There{' '}
              {siblingBudgets.length === 1
                ? 'is 1 other version'
                : `are ${siblingBudgets.length} other versions`}{' '}
              for the same project and month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {siblingBudgets.map((s: any) => {
              const v = (s.budget_versions || [])[0];
              return (
                <div
                  key={s.id}
                  className="flex justify-between rounded-md border p-3 text-sm"
                >
                  <span>
                    {s.submitted_by_role === 'accountant'
                      ? 'Accountant'
                      : 'Team Leader'}{' '}
                    submission
                  </span>
                  <span className="font-mono">
                    {formatCurrency(Number(v?.total_amount_kes || 0), 'KES')}
                  </span>
                </div>
              );
            })}
            <div className="space-y-2">
              <p className="text-sm font-medium">
                What should happen to the other version(s)?
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="autoReject"
                  checked={autoRejectChoice === 'leave'}
                  onChange={() => setAutoRejectChoice('leave')}
                />
                Leave in current status (PM can still act on it)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="autoReject"
                  checked={autoRejectChoice === 'reject'}
                  onChange={() => setAutoRejectChoice('reject')}
                />
                Automatically reject (budget settled)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAutoRejectDialog(false)}>
              Cancel
            </Button>
            <Button onClick={performApproval} disabled={processing}>
              <Check className="mr-1 h-4 w-4" /> Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust amount dialog — preserved verbatim */}
      <Dialog open={!!adjustItem} onOpenChange={() => setAdjustItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Line Item Amount</DialogTitle>
            <DialogDescription>
              <strong>{adjustItem?.description}</strong> — submitted at{' '}
              {formatCurrency(Number(adjustItem?.amount_kes || 0), 'KES')}
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
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Why are you changing this amount?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (adjustAmount <= 0 || !adjustReason.trim()) {
                  toast.error('Amount and reason required');
                  return;
                }
                if (
                  user?.role !== 'cfo' &&
                  adjustAmount > Number(adjustItem?.amount_kes || 0)
                ) {
                  toast.error(
                    'Adjusted amount cannot be higher than the submitted amount.',
                  );
                  return;
                }
                const headers = await getAuthHeaders();
                const res = await fetch('/api/budgets/pm-line-review', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify({
                    action: 'update_item',
                    item_id: adjustItem.id,
                    budget_id: id,
                    pm_status: 'adjusted',
                    pm_approved_amount: adjustAmount,
                    reason: adjustReason,
                  }),
                });
                const data = await res.json();
                if (data.success) {
                  toast.success('Amount adjusted');
                  setAdjustItem(null);
                  await markPmReviewOpenedDirect();
                  load();
                } else {
                  toast.error(
                    getUserErrorMessage(data?.error, 'Unable to save adjustment.'),
                  );
                }
              }}
              disabled={
                adjustAmount <= 0 ||
                !adjustReason.trim() ||
                (user?.role !== 'cfo' &&
                  adjustAmount > Number(adjustItem?.amount_kes || 0))
              }
            >
              Save Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
