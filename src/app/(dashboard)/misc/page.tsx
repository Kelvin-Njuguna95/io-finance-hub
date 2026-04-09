'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate, formatYearMonth, getCurrentYearMonth } from '@/lib/format';
import {
  Plus, Trash2, Save, Send, AlertTriangle, CheckCircle2, Clock, Flag,
  DollarSign, TrendingUp, FileText, AlertCircle, Wallet, Receipt,
} from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

// ── Helpers ──────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return {};
  return { 'Authorization': `Bearer ${session.access_token}` };
}

function getPrevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function getMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const val = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    opts.push({ value: val, label: formatYearMonth(val) });
  }
  return opts;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Main Page ────────────────────────────────────────────────────

export default function MiscPage() {
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const monthOptions = getMonthOptions();

  if (!user) {
    return (
      <div>
        <PageHeader title="Misc Draws" description="Loading..." />
        <div className="p-6 text-center text-slate-400">Loading user data...</div>
      </div>
    );
  }

  const role = user.role;

  return (
    <div>
      <PageHeader title="Misc Draws & Reports" description="Miscellaneous project expenditure management">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>
      <div className="p-6">
        {['project_manager', 'team_leader', 'accountant', 'cfo'].includes(role) && (
          <ProjectMiscLineItemsPanel user={user} selectedMonth={selectedMonth} />
        )}

        {role === 'project_manager' && (
          <PmMiscView user={user} selectedMonth={selectedMonth} />
        )}
        {role === 'team_leader' && (
          <TeamLeaderMiscView user={user} selectedMonth={selectedMonth} />
        )}
        {role === 'cfo' && (
          <CfoMiscView user={user} selectedMonth={selectedMonth} />
        )}
        {role === 'accountant' && (
          <AccountantMiscView user={user} selectedMonth={selectedMonth} />
        )}
        {!['project_manager', 'team_leader', 'cfo', 'accountant'].includes(role) && (
          <p className="text-center text-slate-400 py-8">Your role does not have access to misc draws.</p>
        )}
      </div>
    </div>
  );
}

function ProjectMiscLineItemsPanel({ user, selectedMonth }: { user: any; selectedMonth: string }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [report, setReport] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const reportMonth = getPrevMonth(selectedMonth);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    if (['project_manager', 'team_leader'].includes(user.role)) {
      const { data: assignments } = await supabase
        .from('user_project_assignments')
        .select('project_id, projects(id, name, is_active)')
        .eq('user_id', user.id);
      const assigned = (assignments || [])
        .map((a: any) => a.projects)
        .filter((p: any) => p?.is_active);
      setProjects(assigned);
      if (assigned.length > 0) setSelectedProjectId((prev) => prev || assigned[0].id);
    } else {
      const { data: allProjects } = await supabase
        .from('projects')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setProjects(allProjects || []);
      if ((allProjects || []).length > 0) setSelectedProjectId((prev) => prev || allProjects![0].id);
    }
    setLoading(false);
  }, [user.id, user.role]);

  const loadReport = useCallback(async () => {
    if (!selectedProjectId) return;
    const supabase = createClient();
    const { data: rep } = await supabase
      .from('misc_reports')
      .select('*')
      .eq('project_id', selectedProjectId)
      .eq('period_month', reportMonth)
      .single();
    setReport(rep || null);
    if (rep?.id) {
      const { data: itemRows } = await supabase
        .from('misc_report_items')
        .select('*')
        .eq('misc_report_id', rep.id)
        .order('expense_date');
      setItems(itemRows || []);
    } else {
      setItems([]);
    }
  }, [reportMonth, selectedProjectId]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadReport(); }, [loadReport]);

  function addItem() {
    setItems((prev) => [
      ...prev,
      { description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], misc_draw_id: null, isNew: true },
    ]);
  }

  function updateItem(idx: number, field: string, value: any) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function ensureReport() {
    if (report?.id) return report;
    if (!selectedProjectId) return null;
    setCreating(true);
    const supabase = createClient();
    const periodDate = `${reportMonth}-01`;

    const { data: draws } = await supabase
      .from('misc_draws')
      .select('id, draw_type, amount_approved')
      .eq('project_id', selectedProjectId)
      .eq('period_month', periodDate);
    const { data: alloc } = await supabase
      .from('misc_allocations')
      .select('monthly_amount')
      .eq('project_id', selectedProjectId)
      .eq('is_active', true)
      .single();

    const totalDrawn = (draws || []).reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
    const standingAmount = (draws || []).find((d: any) => d.draw_type === 'standing')?.amount_approved || Number(alloc?.monthly_amount || 0);
    const topUpTotal = (draws || []).filter((d: any) => d.draw_type === 'top_up').reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);

    const { data: newReport, error } = await supabase.from('misc_reports').insert({
      project_id: selectedProjectId,
      period_month: reportMonth,
      submitted_by: user.id,
      total_allocated: Number(alloc?.monthly_amount || 0),
      total_drawn: totalDrawn,
      standing_allocation_amount: standingAmount,
      top_up_total: topUpTotal,
      draw_count: (draws || []).length,
      status: 'draft',
    }).select().single();

    setCreating(false);
    if (error || !newReport) {
      toast.error(error?.message || 'Failed to create misc report.');
      return null;
    }
    setReport(newReport);
    return newReport;
  }

  async function handleSave() {
    const targetReport = await ensureReport();
    if (!targetReport?.id) return;
    setSaving(true);
    const supabase = createClient();

    await supabase.from('misc_report_items').delete().eq('misc_report_id', targetReport.id);
    const rows = items
      .filter((i) => i.description?.trim() && Number(i.amount) > 0)
      .map((i) => ({
        misc_report_id: targetReport.id,
        description: i.description,
        amount: Number(i.amount),
        expense_date: i.expense_date,
        misc_draw_id: i.misc_draw_id || null,
      }));

    if (rows.length > 0) {
      const { error } = await supabase.from('misc_report_items').insert(rows);
      if (error) {
        toast.error(error.message || 'Failed to save line items.');
        setSaving(false);
        return;
      }
    }

    const totalClaimed = rows.reduce((s, r) => s + Number(r.amount), 0);
    await supabase.from('misc_reports').update({
      total_claimed: totalClaimed,
      variance: Number(targetReport.total_allocated || 0) - totalClaimed,
      submitted_by: user.id,
    }).eq('id', targetReport.id);

    toast.success('Project misc line items saved.');
    setSaving(false);
    loadReport();
  }

  const canEdit = !report || ['draft', 'submitted'].includes(report.status);
  const itemTotal = items.reduce((s, i) => s + Number(i.amount || 0), 0);

  return (
    <Card className="mb-6 border-indigo-200 bg-indigo-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Project Misc Expenditure Line Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-600">
          Enter project-level misc expenditure for <strong>{formatYearMonth(reportMonth)}</strong>. This section is available to CFO, Accountant, PM, and Team Leader.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1 md:col-span-2">
            <Label>Project</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={loading || projects.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? 'Loading projects...' : 'Select project'} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border bg-white p-3 text-sm">
            <p className="text-slate-500">Line Item Total</p>
            <p className="font-semibold">{formatCurrency(itemTotal, 'KES')}</p>
          </div>
        </div>

        {!selectedProjectId ? (
          <p className="text-sm text-slate-500">No project selected.</p>
        ) : (
          <>
            {canEdit && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="gap-1" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" /> Add Line Item
                </Button>
              </div>
            )}

            {items.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-2">No line items yet.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-lg border bg-white p-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={item.expense_date || ''} disabled={!canEdit} onChange={(e) => updateItem(idx, 'expense_date', e.target.value)} />
                    </div>
                    <div className="col-span-6">
                      <Label className="text-xs">Description</Label>
                      <Input value={item.description || ''} disabled={!canEdit} onChange={(e) => updateItem(idx, 'description', e.target.value)} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Amount (KES)</Label>
                      <Input type="number" step="0.01" value={item.amount || ''} disabled={!canEdit} onChange={(e) => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {canEdit && (
                        <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} title="Remove line item">
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report?.status && !canEdit && (
              <p className="text-xs text-slate-500">
                This report is <strong>{report.status}</strong> and is no longer editable.
              </p>
            )}

            {canEdit && (
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving || creating || loading || !selectedProjectId} className="gap-1">
                  <Save className="h-3.5 w-3.5" />
                  {saving ? 'Saving...' : creating ? 'Creating report...' : 'Save Line Items'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TeamLeaderMiscView({ user, selectedMonth }: { user: any; selectedMonth: string }) {
  return <PmMiscView user={user} selectedMonth={selectedMonth} />;
}

// ══════════════════════════════════════════════════════════════════
// PM VIEW
// ══════════════════════════════════════════════════════════════════

function PmMiscView({ user, selectedMonth }: { user: any; selectedMonth: string }) {
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any>(null);
  const [apiData, setApiData] = useState<any>(null);
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpPurpose, setTopUpPurpose] = useState('');
  const [submittingTopUp, setSubmittingTopUp] = useState(false);

  // Report state
  const [prevReport, setPrevReport] = useState<any>(null);
  const [prevReportItems, setPrevReportItems] = useState<any[]>([]);
  const [prevDraws, setPrevDraws] = useState<any[]>([]);
  const [reportEditing, setReportEditing] = useState(false);
  const [varianceExplanation, setVarianceExplanation] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  // Pending PM approvals (accountant-raised draws)
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [approveDrawId, setApproveDrawId] = useState<string | null>(null);
  const [declineDrawId, setDeclineDrawId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [deleteDrawId, setDeleteDrawId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [actioning, setActioning] = useState(false);

  const prevMonthStr = getPrevMonth(selectedMonth);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Get PM's assigned project
    const { data: assignments } = await supabase
      .from('user_project_assignments')
      .select('project_id, projects(id, name, is_active)')
      .eq('user_id', user.id);

    const activeProject = (assignments || []).find((a: any) => a.projects?.is_active);
    if (!activeProject) {
      setLoading(false);
      return;
    }
    const proj = activeProject.projects as any;
    setProject(proj);

    // Fetch current month data from API
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/misc-draws?project_id=${proj.id}&period_month=${selectedMonth}`, { headers });
    if (res.ok) {
      const data = await res.json();
      setApiData(data);
    }

    // Fetch prev month report
    const { data: prevRep } = await supabase
      .from('misc_reports')
      .select('*')
      .eq('project_id', proj.id)
      .eq('period_month', prevMonthStr)
      .single();
    setPrevReport(prevRep);

    if (prevRep) {
      const { data: items } = await supabase
        .from('misc_report_items')
        .select('*')
        .eq('misc_report_id', prevRep.id)
        .order('expense_date');
      setPrevReportItems(items || []);
    } else {
      setPrevReportItems([]);
    }

    // Fetch prev month draws (for report references)
    const { data: pDraws } = await supabase
      .from('misc_draws')
      .select('*')
      .eq('project_id', proj.id)
      .eq('period_month', prevMonthStr + '-01')
      .order('created_at');
    setPrevDraws(pDraws || []);

    // Fetch accountant-raised draws pending PM approval
    const { data: pendingDraws } = await supabase
      .from('misc_draws')
      .select('*, users!misc_draws_raised_by_fkey(full_name)')
      .eq('project_id', proj.id)
      .eq('pm_approval_status', 'pending')
      .eq('status', 'pending_pm_approval')
      .order('created_at');
    setPendingApprovals(pendingDraws || []);

    setLoading(false);
  }, [user.id, selectedMonth, prevMonthStr]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleTopUpSubmit() {
    const parsedAmount = parseFloat(topUpAmount);
    const normalizedPurpose = topUpPurpose.trim();
    if (!project || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || normalizedPurpose.length < 10) {
      toast.error('Amount required and purpose must be at least 10 characters.');
      return;
    }
    setSubmittingTopUp(true);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'submit_topup',
        project_id: project.id,
        period_month: selectedMonth,
        amount: parsedAmount,
        purpose: normalizedPurpose,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success(`Top-up of ${formatCurrency(parsedAmount, 'KES')} recorded.`);
      setShowTopUp(false);
      setTopUpAmount('');
      setTopUpPurpose('');
      loadData();
    } else {
      toast.error(getUserErrorMessage(data?.error, 'Failed to submit top-up.'));
    }
    setSubmittingTopUp(false);
  }

  async function handlePmApproveDraw() {
    if (!approveDrawId || !project) return;
    setActioning(true);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pm_approve_draw',
        project_id: project.id,
        period_month: selectedMonth,
        draw_id: approveDrawId,
      }),
    });
    if (res.ok) {
      toast.success('Draw approved.');
      setApproveDrawId(null);
      loadData();
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to approve');
    }
    setActioning(false);
  }

  async function handlePmDeclineDraw() {
    if (!declineDrawId || !declineReason.trim() || !project) return;
    setActioning(true);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pm_decline_draw',
        project_id: project.id,
        period_month: selectedMonth,
        draw_id: declineDrawId,
        decline_reason: declineReason,
      }),
    });
    if (res.ok) {
      toast.success('Draw declined.');
      setDeclineDrawId(null);
      setDeclineReason('');
      loadData();
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to decline');
    }
    setActioning(false);
  }

  async function handlePmDeleteDraw() {
    if (!deleteDrawId || !deleteReason.trim() || !project) return;
    setActioning(true);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'pm_delete_draw',
        project_id: project.id,
        period_month: selectedMonth,
        draw_id: deleteDrawId,
        deletion_reason: deleteReason,
      }),
    });
    if (res.ok) {
      toast.success('Draw deleted.');
      setDeleteDrawId(null);
      setDeleteReason('');
      loadData();
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to delete');
    }
    setActioning(false);
  }

  async function handleCreateReport() {
    if (!project) return;
    const supabase = createClient();
    const totalDrawn = prevDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
    const { data: alloc } = await supabase.from('misc_allocations').select('monthly_amount').eq('project_id', project.id).single();
    const monthlyAmount = alloc?.monthly_amount || 0;
    const standingAmount = prevDraws.find((d: any) => d.draw_type === 'standing')?.amount_approved || monthlyAmount;
    const topUpTotal = prevDraws.filter((d: any) => d.draw_type === 'top_up').reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);

    const { data, error } = await supabase.from('misc_reports').insert({
      project_id: project.id,
      period_month: prevMonthStr,
      submitted_by: user.id,
      total_allocated: monthlyAmount,
      total_drawn: totalDrawn,
      standing_allocation_amount: standingAmount,
      top_up_total: topUpTotal,
      draw_count: prevDraws.length,
      status: 'draft',
    }).select().single();

    if (error) {
      toast.error(getUserErrorMessage());
      return;
    }
    toast.success('Report created as draft.');
    loadData();
  }

  function addReportItem() {
    setPrevReportItems([
      ...prevReportItems,
      { id: null, description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], misc_draw_id: null, isNew: true },
    ]);
    setReportEditing(true);
  }

  function updateReportItem(idx: number, field: string, value: any) {
    setPrevReportItems(prevReportItems.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function removeReportItem(idx: number) {
    setPrevReportItems(prevReportItems.filter((_, i) => i !== idx));
  }

  async function handleSaveDraft() {
    if (!prevReport?.id) return;
    setSavingReport(true);
    const supabase = createClient();
    await supabase.from('misc_report_items').delete().eq('misc_report_id', prevReport.id);
    const rows = prevReportItems
      .filter((i) => i.description.trim() && i.amount > 0)
      .map((i) => ({
        misc_report_id: prevReport.id,
        description: i.description,
        amount: i.amount,
        expense_date: i.expense_date,
        misc_draw_id: i.misc_draw_id || null,
      }));
    if (rows.length > 0) {
      await supabase.from('misc_report_items').insert(rows);
    }
    const totalClaimed = rows.reduce((s, r) => s + Number(r.amount), 0);
    await supabase.from('misc_reports').update({
      total_claimed: totalClaimed,
      variance: (prevReport.total_allocated || 0) - totalClaimed,
    }).eq('id', prevReport.id);
    toast.success('Draft saved.');
    setSavingReport(false);
    loadData();
  }

  async function handleSubmitReport() {
    if (!prevReport?.id) return;
    await handleSaveDraft();
    const totalItemised = prevReportItems.reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalDrawn = prevReport.total_drawn || prevDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
    const pct = totalDrawn > 0 ? (totalItemised / totalDrawn) * 100 : 100;

    if (pct < 80 && !varianceExplanation.trim()) {
      toast.error('Itemisation is below 80%. Please provide a variance explanation.');
      setShowSubmitConfirm(false);
      return;
    }

    const supabase = createClient();
    await supabase.from('misc_reports').update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      gate_cleared_at: new Date().toISOString(),
      variance_explanation: varianceExplanation || null,
    }).eq('id', prevReport.id);

    // Update draws to accounted
    for (const draw of prevDraws) {
      await supabase.from('misc_draws').update({ status: 'accounted' }).eq('id', draw.id);
    }

    toast.success('Report submitted. Budget gates cleared.');
    setShowSubmitConfirm(false);
    setReportEditing(false);
    loadData();
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading misc data...</div>;
  }

  if (!project) {
    return <div className="text-center text-slate-400 py-8">No active project assigned. Contact the CFO.</div>;
  }

  const draws = apiData?.draws || [];
  const allocation = apiData?.allocation || { monthly_amount: 0 };
  const limits = apiData?.limits || {};
  const topUpTotal = apiData?.top_up_total || 0;
  const topUpCount = apiData?.top_up_count || 0;
  const totalDrawn = apiData?.total_drawn || 0;
  const totalAvailable = allocation.monthly_amount + topUpTotal;
  const prevStatus = apiData?.prev_report_status;

  const flaggedDraws = draws.filter((d: any) => d.cfo_flagged);
  const reportItemsTotal = prevReportItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const totalDrawnForReport = prevReport?.total_drawn || prevDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
  const unaccounted = totalDrawnForReport - reportItemsTotal;
  const itemisationPct = totalDrawnForReport > 0 ? (reportItemsTotal / totalDrawnForReport) * 100 : 100;

  const canRequestTopUp = limits.remaining_count > 0 && limits.remaining_amount > 0 && !limits.frozen;
  const topUpDisabledReason = limits.frozen
    ? 'Top-ups are frozen by CFO'
    : limits.remaining_count <= 0
      ? 'Monthly top-up count limit reached'
      : limits.remaining_amount <= 0
        ? 'Monthly top-up amount limit reached'
        : '';

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {prevStatus === 'submitted' || prevStatus === 'cfo_reviewed' ? (
        prevStatus === 'cfo_reviewed' ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Your {formatYearMonth(prevMonthStr)} misc report is submitted. Budget processing is unblocked.
          </div>
        ) : (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Report submitted and under CFO review.
          </div>
        )
      ) : prevStatus === null && prevDraws.length > 0 ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Your {formatYearMonth(prevMonthStr)} misc report is overdue. Budget submission and TL budget approvals are blocked.
          </span>
          <Button variant="link" size="sm" className="text-rose-700" onClick={() => document.getElementById('report-section')?.scrollIntoView({ behavior: 'smooth' })}>
            Submit Immediately &rarr;
          </Button>
        </div>
      ) : prevStatus === 'draft' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Your {formatYearMonth(prevMonthStr)} misc report has not been submitted. Submit before budget processing is blocked.
          </span>
          <Button variant="link" size="sm" className="text-amber-700" onClick={() => document.getElementById('report-section')?.scrollIntoView({ behavior: 'smooth' })}>
            Submit Now &rarr;
          </Button>
        </div>
      ) : null}

      {/* Pending Your Approval — accountant-raised draws */}
      {pendingApprovals.length > 0 && (
        <Card className="border-purple-200 bg-purple-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-purple-700">
              <Clock className="h-4 w-4" />
              Pending Your Approval ({pendingApprovals.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raised By</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount (KES)</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingApprovals.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-sm">
                      <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">Accountant</Badge>
                      <span className="ml-1 text-xs text-slate-500">{(d.users as any)?.full_name || '—'}</span>
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{d.purpose}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={d.draw_type === 'standing' ? 'bg-[#1e293b] text-white text-xs' : 'bg-amber-100 text-amber-800 text-xs'}>
                        {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(d.amount_requested), 'KES')}</TableCell>
                    <TableCell className="text-xs text-slate-500 max-w-[150px] truncate">{d.accountant_notes || '—'}</TableCell>
                    <TableCell className="text-center text-xs">{d.revision_count > 0 ? `#${d.revision_count}` : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="outline" className="text-xs h-7 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" onClick={() => setApproveDrawId(d.id)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-xs h-7 bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100" onClick={() => setDeclineDrawId(d.id)}>
                          Decline
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Monthly Allocation" value={formatCurrency(allocation.monthly_amount, 'KES')} icon={Wallet} />
        <StatCard title="Top-Ups This Month" value={formatCurrency(topUpTotal, 'KES')} subtitle={`${topUpCount} requests`} icon={TrendingUp} />
        <StatCard title="Total Available" value={formatCurrency(totalAvailable, 'KES')} icon={DollarSign} />
        <StatCard title="Remaining Unaccounted" value={formatCurrency(totalDrawn - reportItemsTotal > 0 ? totalDrawn - reportItemsTotal : 0, 'KES')} icon={Receipt} />
      </div>

      {/* Draws History Table */}
      <Card className="io-card">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Draws History &mdash; {formatYearMonth(selectedMonth)}</CardTitle>
          <Button
            size="sm"
            className="gap-1"
            onClick={() => setShowTopUp(true)}
            disabled={!canRequestTopUp}
            title={topUpDisabledReason}
          >
            <Plus className="h-3 w-3" /> Request Top-Up
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount (KES)</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Raised By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expensed</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draws.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-6 text-slate-400">No draws for this month.</TableCell>
                </TableRow>
              ) : (
                draws.filter((d: any) => d.status !== 'deleted').map((d: any, idx: number) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-slate-400">{idx + 1}</TableCell>
                    <TableCell className="text-sm">{formatDate(d.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={d.draw_type === 'standing' ? 'bg-[#1e293b] text-white' : 'bg-amber-100 text-amber-800'}>
                        {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(d.amount_approved), 'KES')}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{d.purpose || 'Standing allocation'}</TableCell>
                    <TableCell className="text-xs">
                      {d.raised_by_role === 'accountant' ? (
                        <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-[10px]">Accountant</Badge>
                      ) : (
                        <span className="text-slate-400">Self</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={
                        d.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                          : d.status === 'accounted' ? 'bg-blue-100 text-blue-700'
                            : d.status === 'flagged' ? 'bg-rose-100 text-rose-700'
                              : d.status === 'pending_pm_approval' ? 'bg-purple-100 text-purple-700'
                                : d.status === 'declined' ? 'bg-rose-100 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                      }>
                        {d.status === 'approved' ? 'Active' : d.status === 'accounted' ? 'Accounted' : d.status === 'flagged' ? 'Flagged' : d.status === 'pending_pm_approval' ? 'Pending Approval' : d.status === 'declined' ? 'Declined' : d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {d.expense_id ? (
                        <span className="text-emerald-600" title="Recorded">&#10003;</span>
                      ) : (
                        <span className="text-amber-500" title="Not yet recorded">&#9888;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.status === 'approved' && !d.expense_id && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => { setDeleteDrawId(d.id); setDeleteReason(''); }} title="Delete draw">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Top-Up Request Dialog */}
      <Dialog open={showTopUp} onOpenChange={setShowTopUp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Top-Up</DialogTitle>
            <DialogDescription>Top-up requests are self-approved. Submitting records funds as drawn immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Top-up requests are self-approved. Submitting records funds as drawn immediately.
            </div>
            <div className="space-y-1">
              <Label>Amount (KES) *</Label>
              <Input type="number" step="0.01" value={topUpAmount} onChange={(e) => setTopUpAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Purpose *</Label>
              <Textarea
                value={topUpPurpose}
                onChange={(e) => setTopUpPurpose(e.target.value)}
                placeholder="Describe what these funds are needed for"
                rows={3}
              />
              {topUpPurpose.length > 0 && topUpPurpose.length < 10 && (
                <p className="text-xs text-rose-500">Minimum 10 characters required.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTopUp(false)}>Cancel</Button>
            <Button onClick={handleTopUpSubmit} disabled={submittingTopUp || !topUpAmount || parseFloat(topUpAmount) <= 0 || topUpPurpose.trim().length < 10}>
              Submit Top-Up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Previous Month Report Section */}
      <div id="report-section">
        <Card className="io-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Misc Report &mdash; {formatYearMonth(prevMonthStr)}</CardTitle>
          </CardHeader>
          <CardContent>
            {prevReport ? (
              <div className="space-y-4">
                {/* Report header */}
                <div className="flex flex-wrap gap-6 text-sm">
                  <div><span className="text-slate-400">Period:</span> <strong>{formatYearMonth(prevMonthStr)}</strong></div>
                  <div><span className="text-slate-400">Total Drawn:</span> <strong>{formatCurrency(totalDrawnForReport, 'KES')}</strong></div>
                  <div><span className="text-slate-400">Total Itemised:</span> <strong>{formatCurrency(reportItemsTotal, 'KES')}</strong></div>
                  <div><span className="text-slate-400">Variance:</span> <strong className={unaccounted > 0 ? 'text-amber-600' : 'text-emerald-600'}>{formatCurrency(unaccounted, 'KES')}</strong></div>
                  <div>
                    <Badge variant="secondary" className={
                      prevReport.status === 'submitted' ? 'bg-blue-100 text-blue-700'
                        : prevReport.status === 'cfo_reviewed' ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                    }>
                      {prevReport.status === 'cfo_reviewed' ? 'Reviewed' : prevReport.status}
                    </Badge>
                  </div>
                </div>

                {/* Itemised table */}
                {prevReport.status === 'draft' && (
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={addReportItem} className="gap-1">
                      <Plus className="h-3 w-3" /> Add Line Item
                    </Button>
                  </div>
                )}

                {prevReportItems.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">No items yet. Click &quot;Add Line Item&quot; to start.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Draw Reference</TableHead>
                        {prevReport.status === 'draft' && <TableHead className="w-[60px]" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prevReportItems.map((item: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="text-slate-400">{idx + 1}</TableCell>
                          <TableCell>
                            {prevReport.status === 'draft' ? (
                              <Input type="date" value={item.expense_date || ''} onChange={(e) => updateReportItem(idx, 'expense_date', e.target.value)} className="h-8 w-36 text-sm" />
                            ) : formatDate(item.expense_date)}
                          </TableCell>
                          <TableCell>
                            {prevReport.status === 'draft' ? (
                              <Input value={item.description || ''} onChange={(e) => updateReportItem(idx, 'description', e.target.value)} placeholder="What was this for?" className="h-8 text-sm" />
                            ) : item.description}
                          </TableCell>
                          <TableCell className="text-right">
                            {prevReport.status === 'draft' ? (
                              <Input type="number" step="0.01" value={item.amount || ''} onChange={(e) => updateReportItem(idx, 'amount', parseFloat(e.target.value) || 0)} className="h-8 w-28 text-sm text-right ml-auto" />
                            ) : formatCurrency(Number(item.amount), 'KES')}
                          </TableCell>
                          <TableCell>
                            {prevReport.status === 'draft' ? (
                              <Select value={item.misc_draw_id || ''} onValueChange={(v) => updateReportItem(idx, 'misc_draw_id', v)}>
                                <SelectTrigger className="h-8 w-40 text-sm">
                                  <SelectValue placeholder="Link draw..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  {prevDraws.map((d: any) => (
                                    <SelectItem key={d.id} value={d.id}>
                                      {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'} &mdash; {formatCurrency(Number(d.amount_approved), 'KES')}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              item.misc_draw_id ? (
                                <Badge variant="secondary" className="bg-slate-100 text-slate-600 text-xs">Linked</Badge>
                              ) : '—'
                            )}
                          </TableCell>
                          {prevReport.status === 'draft' && (
                            <TableCell>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeReportItem(idx)}>
                                <Trash2 className="h-3 w-3 text-rose-500" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                      <TableRow className="font-bold bg-slate-50">
                        <TableCell colSpan={3} className="text-right">Total</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(reportItemsTotal, 'KES')}</TableCell>
                        <TableCell colSpan={prevReport.status === 'draft' ? 2 : 1} />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}

                {prevReport.status === 'draft' && (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={handleSaveDraft} disabled={savingReport} className="gap-1">
                      <Save className="h-4 w-4" /> Save Draft
                    </Button>
                    <Button
                      onClick={() => setShowSubmitConfirm(true)}
                      disabled={savingReport || prevReportItems.filter((i: any) => i.description?.trim() && i.amount > 0).length === 0}
                      className="btn-gradient text-white gap-1"
                    >
                      <Send className="h-4 w-4" /> Submit Report
                    </Button>
                  </div>
                )}
              </div>
            ) : prevDraws.length > 0 ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-sm text-slate-400">There were draws last month but no report has been created.</p>
                <Button onClick={handleCreateReport} className="gap-1">
                  <FileText className="h-4 w-4" /> Create Report
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-6">No draws recorded for {formatYearMonth(prevMonthStr)}.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Submit Report Confirmation Dialog */}
      <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Misc Report</DialogTitle>
            <DialogDescription>Once submitted, entries cannot be edited.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span>Total Drawn:</span><strong>{formatCurrency(totalDrawnForReport, 'KES')}</strong></div>
            <div className="flex justify-between"><span>Total Itemised:</span><strong>{formatCurrency(reportItemsTotal, 'KES')}</strong></div>
            <Separator />
            <div className="flex justify-between"><span>Itemisation %:</span><strong className={itemisationPct < 80 ? 'text-rose-600' : 'text-emerald-600'}>{itemisationPct.toFixed(1)}%</strong></div>
            {itemisationPct < 80 && (
              <div className="space-y-1">
                <Label className="text-rose-600">Variance Explanation Required (below 80%)</Label>
                <Textarea
                  value={varianceExplanation}
                  onChange={(e) => setVarianceExplanation(e.target.value)}
                  placeholder="Explain why itemisation is below 80%..."
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitConfirm(false)}>Cancel</Button>
            <Button onClick={handleSubmitReport} disabled={itemisationPct < 80 && !varianceExplanation.trim()}>Submit Report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flagged Items Panel */}
      {flaggedDraws.length > 0 && (
        <Card className="border-rose-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-rose-700 flex items-center gap-2">
              <Flag className="h-4 w-4" /> Flagged Items ({flaggedDraws.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {flaggedDraws.map((d: any) => (
                <div key={d.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <strong>{d.draw_type === 'standing' ? 'Standing' : 'Top-Up'} &mdash; {formatCurrency(Number(d.amount_approved), 'KES')}</strong>
                    <span className="text-slate-400">{formatDate(d.cfo_flagged_at)}</span>
                  </div>
                  <p className="text-rose-700">{d.cfo_flag_reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approve Draw Confirmation Dialog */}
      <Dialog open={!!approveDrawId} onOpenChange={() => setApproveDrawId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Misc Draw</DialogTitle>
            <DialogDescription>Approve this accountant-raised misc draw request.</DialogDescription>
          </DialogHeader>
          {approveDrawId && (() => {
            const draw = pendingApprovals.find((d: any) => d.id === approveDrawId);
            return draw ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border bg-emerald-50 p-3 space-y-1">
                  <div className="flex justify-between"><span className="text-slate-400">Purpose:</span><strong>{draw.purpose}</strong></div>
                  <div className="flex justify-between"><span className="text-slate-400">Amount:</span><strong>{formatCurrency(Number(draw.amount_requested), 'KES')}</strong></div>
                  <div className="flex justify-between"><span className="text-slate-400">Raised by:</span><strong>{(draw.users as any)?.full_name || 'Accountant'}</strong></div>
                  {draw.accountant_notes && <div className="flex justify-between"><span className="text-slate-400">Notes:</span><strong>{draw.accountant_notes}</strong></div>}
                </div>
                <p className="text-slate-500">Approving will mark this draw as active and available for expense recording.</p>
              </div>
            ) : null;
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDrawId(null)}>Cancel</Button>
            <Button onClick={handlePmApproveDraw} disabled={actioning} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {actioning ? 'Approving...' : 'Approve Draw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Draw Dialog */}
      <Dialog open={!!declineDrawId} onOpenChange={() => { setDeclineDrawId(null); setDeclineReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Misc Draw</DialogTitle>
            <DialogDescription>Decline this request. The accountant will be notified and can revise.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason for declining *</Label>
            <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="Explain why you are declining this draw..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeclineDrawId(null); setDeclineReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handlePmDeclineDraw} disabled={actioning || !declineReason.trim()}>
              {actioning ? 'Declining...' : 'Decline Draw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Draw Dialog */}
      <Dialog open={!!deleteDrawId} onOpenChange={() => { setDeleteDrawId(null); setDeleteReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Misc Draw</DialogTitle>
            <DialogDescription>Permanently delete this approved draw. Only unspent draws can be deleted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason for deletion *</Label>
            <Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Why is this draw being deleted?" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDrawId(null); setDeleteReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handlePmDeleteDraw} disabled={actioning || !deleteReason.trim()}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {actioning ? 'Deleting...' : 'Delete Draw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// CFO VIEW — Full Accountability Dashboard
// ══════════════════════════════════════════════════════════════════

function CfoMiscView({ user, selectedMonth }: { user: any; selectedMonth: string }) {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<Map<string, number>>(new Map());
  const [allDraws, setAllDraws] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [drawsFeed, setDrawsFeed] = useState<any[]>([]);
  const [feedPage, setFeedPage] = useState(0);

  // Accountant misc requests (company-wide, from accountant_misc_requests)
  const [acctRequests, setAcctRequests] = useState<any[]>([]);

  // Company-wide expenses for the month (all types)
  const [monthExpenses, setMonthExpenses] = useState<any[]>([]);

  // Red flags
  const [redFlags, setRedFlags] = useState<any[]>([]);

  // Report detail drilldown
  const [detailProject, setDetailProject] = useState<any>(null);
  const [detailDraws, setDetailDraws] = useState<any[]>([]);
  const [detailReportItems, setDetailReportItems] = useState<any[]>([]);

  // Misc report review
  const [reviewReport, setReviewReport] = useState<any>(null);
  const [reviewItems, setReviewItems] = useState<any[]>([]);

  // Flag dialog
  const [flagDraw, setFlagDraw] = useState<any>(null);
  const [flagReason, setFlagReason] = useState('');

  // Active tab
  const [activeTab, setActiveTab] = useState<'overview' | 'projects' | 'accountant' | 'redflags' | 'feed'>('overview');

  const prevMonthStr = getPrevMonth(selectedMonth);
  const FEED_PAGE_SIZE = 20;

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const periodDate = selectedMonth + '-01';

    const [projRes, allocRes, drawsRes, repsRes, acctRes, expRes, flagsRes] = await Promise.all([
      supabase.from('projects').select('id, name, director_tag').eq('is_active', true).order('name'),
      supabase.from('misc_allocations').select('project_id, monthly_amount'),
      supabase.from('misc_draws').select('*, projects(name), users(full_name)').eq('period_month', periodDate).order('created_at', { ascending: false }),
      supabase.from('misc_reports').select('*, projects(name)').eq('period_month', prevMonthStr),
      supabase.from('accountant_misc_requests').select('*, users!accountant_misc_requests_requested_by_fkey(full_name)').order('created_at', { ascending: false }).limit(50),
      supabase.from('expenses').select('id, project_id, description, amount_kes, expense_type, expense_date, vendor, expense_categories(name), projects(name)').eq('year_month', selectedMonth).order('expense_date', { ascending: false }),
      supabase.from('red_flags').select('*').eq('is_resolved', false).order('created_at', { ascending: false }).limit(30),
    ]);

    const projs = projRes.data || [];
    setProjects(projs);

    const allocMap = new Map((allocRes.data || []).map((a: any) => [a.project_id, Number(a.monthly_amount)]));
    setAllocations(allocMap);

    const draws = drawsRes.data || [];
    setAllDraws(draws);
    setDrawsFeed(draws);

    setReports(repsRes.data || []);
    setAcctRequests(acctRes.data || []);
    setMonthExpenses(expRes.data || []);
    setRedFlags(flagsRes.data || []);

    setLoading(false);
    setFeedPage(0);
  }, [selectedMonth, prevMonthStr]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleFlagDraw() {
    if (!flagDraw || !flagReason.trim()) return;
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'flag_draw',
        project_id: flagDraw.project_id,
        period_month: selectedMonth,
        draw_id: flagDraw.id,
        flag_reason: flagReason,
      }),
    });
    if (res.ok) {
      toast.success('Draw flagged.');
      setFlagDraw(null);
      setFlagReason('');
      loadData();
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to flag draw.');
    }
  }

  async function openProjectDetail(project: any) {
    setDetailProject(project);
    const supabase = createClient();
    const periodDate = selectedMonth + '-01';
    const [drawsRes, reportRes] = await Promise.all([
      supabase.from('misc_draws').select('*, users(full_name)').eq('project_id', project.id).eq('period_month', periodDate).order('created_at', { ascending: false }),
      supabase.from('misc_reports').select('*').eq('project_id', project.id).eq('period_month', prevMonthStr).single(),
    ]);
    setDetailDraws(drawsRes.data || []);
    if (reportRes.data?.id) {
      const { data: items } = await supabase.from('misc_report_items').select('*').eq('misc_report_id', reportRes.data.id).order('expense_date');
      setDetailReportItems(items || []);
    } else {
      setDetailReportItems([]);
    }
  }

  async function openReviewReport(report: any) {
    setReviewReport(report);
    const supabase = createClient();
    const { data } = await supabase.from('misc_report_items').select('*').eq('misc_report_id', report.id).order('expense_date');
    setReviewItems(data || []);
  }

  async function markReviewed() {
    if (!reviewReport) return;
    const supabase = createClient();
    await supabase.from('misc_reports').update({
      status: 'cfo_reviewed',
      cfo_reviewed_by: user.id,
      cfo_reviewed_at: new Date().toISOString(),
    }).eq('id', reviewReport.id);
    toast.success('Report marked as reviewed');
    setReviewReport(null);
    loadData();
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading CFO accountability dashboard...</div>;
  }

  // ── Compute Metrics ──
  const totalAllocated = Array.from(allocations.values()).reduce((s, v) => s + v, 0);
  const totalDrawn = allDraws.reduce((s, d) => s + Number(d.amount_approved || 0), 0);
  const allocPct = totalAllocated > 0 ? ((totalDrawn / totalAllocated) * 100).toFixed(1) : '0';
  const topUpDraws = allDraws.filter((d) => d.draw_type === 'top_up');
  const topUpCountAll = topUpDraws.length;
  const topUpTotalAll = topUpDraws.reduce((s, d) => s + Number(d.amount_approved || 0), 0);

  const reportMap = new Map(reports.map((r: any) => [r.project_id, r]));
  const projectsWithAlloc = projects.filter((p) => allocations.has(p.id));
  const allProjectsWithActivity = projects.filter((p) => allocations.has(p.id) || allDraws.some((d) => d.project_id === p.id));
  const pendingReportCount = projectsWithAlloc.filter((p) => !reportMap.has(p.id) || reportMap.get(p.id)?.status === 'draft').length;

  const overspendProjects = projectsWithAlloc.filter((p) => {
    const alloc = allocations.get(p.id) || 0;
    const drawn = allDraws.filter((d) => d.project_id === p.id).reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
    return drawn > alloc;
  });
  const overspendTotal = overspendProjects.reduce((s, p) => {
    const alloc = allocations.get(p.id) || 0;
    const drawn = allDraws.filter((d: any) => d.project_id === p.id).reduce((sum: number, d: any) => sum + Number(d.amount_approved || 0), 0);
    return s + (drawn - alloc);
  }, 0);

  const flaggedCount = allDraws.filter((d) => d.cfo_flagged).length;
  const unrecordedCount = allDraws.filter((d) => !d.expense_id && !['pending_pm_approval', 'declined', 'deleted'].includes(d.status)).length;
  const delegatedCount = allDraws.filter((d) => d.raised_by_role === 'accountant').length;
  const pendingPmCount = allDraws.filter((d) => d.status === 'pending_pm_approval').length;

  // Accountant misc metrics
  const acctPending = acctRequests.filter((r) => r.status === 'pending');
  const acctApproved = acctRequests.filter((r) => r.status === 'approved' || r.status === 'reported');
  const acctTotalApproved = acctApproved.reduce((s, r) => s + Number(r.amount_approved || 0), 0);

  // Expense breakdown by type
  const miscExpenses = monthExpenses.filter((e: any) => (e.description || '').toLowerCase().includes('misc'));
  const projectExpenses = monthExpenses.filter((e: any) => e.expense_type === 'project_expense');
  const sharedExpenses = monthExpenses.filter((e: any) => e.expense_type === 'shared_expense');
  const totalProjectExpenseKes = projectExpenses.reduce((s, e) => s + Number(e.amount_kes || 0), 0);
  const totalSharedExpenseKes = sharedExpenses.reduce((s, e) => s + Number(e.amount_kes || 0), 0);
  const totalAllExpenseKes = monthExpenses.reduce((s: number, e: any) => s + Number(e.amount_kes || 0), 0);

  // Expense by project
  const expenseByProject = new Map<string, { name: string; total: number; count: number }>();
  projectExpenses.forEach((e: any) => {
    const pid = e.project_id;
    const existing = expenseByProject.get(pid) || { name: (e.projects as any)?.name || 'Unknown', total: 0, count: 0 };
    existing.total += Number(e.amount_kes || 0);
    existing.count += 1;
    expenseByProject.set(pid, existing);
  });

  // Expense by category
  const expenseByCategory = new Map<string, number>();
  monthExpenses.forEach((e: any) => {
    const cat = (e.expense_categories as any)?.name || (e.expense_type === 'shared_expense' ? 'Shared/Overhead' : 'Uncategorised');
    expenseByCategory.set(cat, (expenseByCategory.get(cat) || 0) + Number(e.amount_kes || 0));
  });
  const categoryList = Array.from(expenseByCategory.entries()).sort((a, b) => b[1] - a[1]);

  // Red flags related to misc / expenses
  const miscFlags = redFlags.filter((f: any) => {
    const desc = (f.description || '').toLowerCase();
    const title = (f.title || '').toLowerCase();
    return desc.includes('misc') || desc.includes('expense') || desc.includes('overspend')
      || title.includes('misc') || title.includes('expense') || title.includes('budget');
  });
  const allActiveFlags = redFlags;

  // Paginated feed
  const paginatedFeed = drawsFeed.slice(0, (feedPage + 1) * FEED_PAGE_SIZE);
  const hasMoreFeed = paginatedFeed.length < drawsFeed.length;

  // Tab buttons
  const tabs = [
    { key: 'overview', label: 'Overview', count: null },
    { key: 'projects', label: 'Projects', count: allProjectsWithActivity.length },
    { key: 'accountant', label: 'Accountant Misc', count: acctPending.length > 0 ? acctPending.length : null },
    { key: 'redflags', label: 'Red Flags', count: allActiveFlags.length > 0 ? allActiveFlags.length : null },
    { key: 'feed', label: 'Activity Feed', count: null },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-[#0f172a] text-[#0f172a]'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && (
              <span className={`ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                t.key === 'redflags' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════ OVERVIEW TAB ════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Metrics — 2 rows */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard title="Total Misc Allocated" value={formatCurrency(totalAllocated, 'KES')} subtitle={`${projectsWithAlloc.length} projects`} icon={Wallet} />
            <StatCard title="Misc Drawn (MTD)" value={formatCurrency(totalDrawn, 'KES')} subtitle={`${allocPct}% of allocation`} icon={DollarSign} />
            <StatCard title="Top-Up Requests" value={String(topUpCountAll)} subtitle={formatCurrency(topUpTotalAll, 'KES')} icon={TrendingUp} />
            <StatCard title="Reports Pending" value={String(pendingReportCount)} icon={FileText} className={pendingReportCount > 0 ? 'border-rose-200 bg-rose-50/30' : ''} />
            <StatCard title="Overspend" value={overspendTotal > 0 ? formatCurrency(overspendTotal, 'KES') : 'None'} subtitle={`${overspendProjects.length} projects`} icon={AlertTriangle} className={overspendProjects.length > 0 ? 'border-rose-200 bg-rose-50/30' : ''} />
            <StatCard title="Flagged / Unrecorded" value={`${flaggedCount} / ${unrecordedCount}`} icon={Flag} className={flaggedCount > 0 ? 'border-amber-200 bg-amber-50/30' : ''} />
          </div>

          {/* Company-Wide Expense Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="io-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-slate-500" />
                  Company Expenses — {formatYearMonth(selectedMonth)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-2xl font-bold">{formatCurrency(totalAllExpenseKes, 'KES')}</div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Project Expenses</span>
                    <span className="font-mono font-medium">{formatCurrency(totalProjectExpenseKes, 'KES')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Shared / Overhead</span>
                    <span className="font-mono font-medium">{formatCurrency(totalSharedExpenseKes, 'KES')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Misc-linked</span>
                    <span className="font-mono font-medium">{formatCurrency(miscExpenses.reduce((s: number, e: any) => s + Number(e.amount_kes || 0), 0), 'KES')}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>{monthExpenses.length} total entries</span>
                    <span>{miscExpenses.length} misc-linked</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Expense by Category */}
            <Card className="io-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Expense by Category</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryList.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No expenses this month.</p>
                ) : (
                  <div className="space-y-2">
                    {categoryList.slice(0, 8).map(([cat, amt]) => {
                      const pct = totalAllExpenseKes > 0 ? (amt / totalAllExpenseKes) * 100 : 0;
                      return (
                        <div key={cat}>
                          <div className="flex justify-between text-sm mb-0.5">
                            <span className="truncate max-w-[160px]">{cat}</span>
                            <span className="font-mono text-xs">{formatCurrency(amt, 'KES')}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-[#0f172a]" style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                    {categoryList.length > 8 && (
                      <p className="text-xs text-slate-400 text-center">+{categoryList.length - 8} more categories</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Expense by Project */}
            <Card className="io-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Project Expense Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {expenseByProject.size === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No project expenses this month.</p>
                ) : (
                  <div className="space-y-2">
                    {Array.from(expenseByProject.entries())
                      .sort((a, b) => b[1].total - a[1].total)
                      .slice(0, 8)
                      .map(([pid, info]) => {
                        const pct = totalProjectExpenseKes > 0 ? (info.total / totalProjectExpenseKes) * 100 : 0;
                        return (
                          <div key={pid}>
                            <div className="flex justify-between text-sm mb-0.5">
                              <span className="truncate max-w-[140px]">{info.name}</span>
                              <span className="font-mono text-xs">{formatCurrency(info.total, 'KES')} <span className="text-slate-400">({info.count})</span></span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-[#F5C518]" style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Accountant Misc Requests Quick Summary */}
          {acctRequests.length > 0 && (
            <Card className="io-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Accountant Misc Requests — Quick View
                  {acctPending.length > 0 && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">{acctPending.length} pending</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center p-3 rounded-lg bg-amber-50">
                    <div className="text-xl font-bold text-amber-700">{acctPending.length}</div>
                    <div className="text-slate-500">Pending Approval</div>
                    <div className="font-mono text-xs">{formatCurrency(acctPending.reduce((s: number, r: any) => s + Number(r.amount_requested || 0), 0), 'KES')}</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-emerald-50">
                    <div className="text-xl font-bold text-emerald-700">{acctApproved.length}</div>
                    <div className="text-slate-500">Approved</div>
                    <div className="font-mono text-xs">{formatCurrency(acctTotalApproved, 'KES')}</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-slate-50">
                    <div className="text-xl font-bold">{acctRequests.filter((r) => r.status === 'declined').length}</div>
                    <div className="text-slate-500">Declined</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setActiveTab('accountant')}>
                  View Full Accountant Misc Details →
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Red Flags Preview */}
          {allActiveFlags.length > 0 && (
            <Card className="io-card border-rose-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-rose-700">
                  <AlertTriangle className="h-4 w-4" />
                  Active Red Flags ({allActiveFlags.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {allActiveFlags.slice(0, 5).map((f: any) => (
                    <div key={f.id} className="flex items-start gap-3 rounded-lg border border-rose-100 bg-rose-50/50 p-3 text-sm">
                      <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                        f.severity === 'critical' ? 'text-rose-600' : f.severity === 'high' ? 'text-orange-500' : 'text-amber-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{f.title}</div>
                        <p className="text-slate-500 text-xs mt-0.5 line-clamp-2">{f.description}</p>
                      </div>
                      <Badge variant="secondary" className={
                        f.severity === 'critical' ? 'bg-rose-100 text-rose-700'
                          : f.severity === 'high' ? 'bg-orange-100 text-orange-700'
                            : 'bg-amber-100 text-amber-700'
                      }>{f.severity}</Badge>
                    </div>
                  ))}
                  {allActiveFlags.length > 5 && (
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setActiveTab('redflags')}>
                      View All {allActiveFlags.length} Red Flags →
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ PROJECTS TAB ════════ */}
      {activeTab === 'projects' && (
        <div className="space-y-6">
          {/* Project Misc Health Table */}
          <Card className="io-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Project Misc Health — {formatYearMonth(selectedMonth)}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Allocation</TableHead>
                    <TableHead className="text-right">Drawn</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-center">Top-Ups</TableHead>
                    <TableHead>Report Status</TableHead>
                    <TableHead className="text-center">Accountant</TableHead>
                    <TableHead className="text-center">Flagged</TableHead>
                    <TableHead className="w-[80px]">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allProjectsWithActivity.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-6 text-slate-400">No projects with misc allocations or activity.</TableCell>
                    </TableRow>
                  ) : (
                    allProjectsWithActivity.map((p) => {
                      const alloc = allocations.get(p.id) || 0;
                      const projDraws = allDraws.filter((d) => d.project_id === p.id);
                      const drawn = projDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
                      const remaining = alloc - drawn;
                      const topUps = projDraws.filter((d) => d.draw_type === 'top_up').length;
                      const report = reportMap.get(p.id);
                      const reportStatus = report?.status || 'not_submitted';
                      const allExpensed = projDraws.length > 0 && projDraws.every((d: any) => d.expense_id);
                      const flagged = projDraws.filter((d: any) => d.cfo_flagged).length;

                      const isOverspend = remaining < 0;
                      const isReportOverdue = !report && projDraws.length > 0;
                      const rowClass = isOverspend || isReportOverdue ? 'bg-rose-50/50' : reportStatus === 'draft' ? 'bg-amber-50/50' : '';

                      return (
                        <TableRow key={p.id} className={rowClass}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{alloc > 0 ? formatCurrency(alloc, 'KES') : '—'}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(drawn, 'KES')}</TableCell>
                          <TableCell className={`text-right font-mono text-sm ${remaining < 0 ? 'text-rose-600 font-bold' : ''}`}>
                            {alloc > 0 ? formatCurrency(remaining, 'KES') : '—'}
                          </TableCell>
                          <TableCell className="text-center">{topUps}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={
                              reportStatus === 'submitted' ? 'bg-blue-100 text-blue-700'
                                : reportStatus === 'cfo_reviewed' ? 'bg-emerald-100 text-emerald-700'
                                  : reportStatus === 'draft' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700'
                            }>
                              {reportStatus === 'cfo_reviewed' ? 'Reviewed' : reportStatus === 'not_submitted' ? 'Not Submitted' : reportStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {projDraws.length === 0 ? '—' : allExpensed ? <span className="text-emerald-600">✓</span> : <span className="text-amber-500">⚠</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {flagged > 0 ? <span className="text-rose-600 font-bold">{flagged}</span> : '0'}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" className="text-xs" onClick={() => openProjectDetail(p)}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Overspend / Underspend Tracker */}
          <Card className="io-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Spend vs Allocation Tracker</CardTitle>
            </CardHeader>
            <CardContent>
              {projectsWithAlloc.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">No allocations configured.</p>
              ) : (
                <div className="space-y-3">
                  {projectsWithAlloc.map((p) => {
                    const alloc = allocations.get(p.id) || 0;
                    const drawn = allDraws.filter((d) => d.project_id === p.id).reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
                    const pct = alloc > 0 ? (drawn / alloc) * 100 : 0;
                    const isOver = pct > 100;
                    const isUnder = pct < 30;
                    return (
                      <div key={p.id} className={`rounded-lg border p-3 ${isOver ? 'border-rose-200 bg-rose-50/30' : isUnder ? 'border-blue-200 bg-blue-50/30' : 'border-slate-100'}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-medium text-sm">{p.name}</span>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-400">Alloc: {formatCurrency(alloc, 'KES')}</span>
                            <span className={`font-mono font-bold ${isOver ? 'text-rose-600' : ''}`}>{formatCurrency(drawn, 'KES')}</span>
                            {isOver && <Badge variant="secondary" className="bg-rose-100 text-rose-700 text-xs">OVER</Badge>}
                            {isUnder && drawn === 0 && <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">NO DRAWS</Badge>}
                          </div>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isOver ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                          <span>{pct.toFixed(0)}% utilised</span>
                          <span>{isOver ? `KES ${(drawn - alloc).toLocaleString()} over` : `KES ${(alloc - drawn).toLocaleString()} remaining`}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Reports Panel */}
          {pendingReportCount > 0 && (
            <Card className="io-card border-amber-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700">
                  <AlertCircle className="h-4 w-4" />
                  Pending Misc Reports — {formatYearMonth(prevMonthStr)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-amber-600 mb-3">These PMs have not submitted their misc report. Budget approval is BLOCKED until reports are in.</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Drawn Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectsWithAlloc.filter((p) => !reportMap.has(p.id) || reportMap.get(p.id)?.status === 'draft').map((p) => {
                      const drawn = allDraws.filter((d) => d.project_id === p.id).reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
                      return (
                        <TableRow key={p.id} className="bg-amber-50/50">
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(drawn, 'KES')}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                              {reportMap.get(p.id)?.status === 'draft' ? 'Draft' : 'Not Submitted'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Submitted Reports to Review */}
          {reports.filter((r: any) => r.status === 'submitted').length > 0 && (
            <Card className="io-card border-blue-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-700">
                  <FileText className="h-4 w-4" />
                  Reports Awaiting CFO Review
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Allocated</TableHead>
                      <TableHead className="text-right">Claimed</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.filter((r: any) => r.status === 'submitted').map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{(r.projects as any)?.name || 'Unknown'}</TableCell>
                        <TableCell className="text-sm text-slate-500">{r.period_month}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(r.total_allocated), 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(r.total_claimed), 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${Number(r.variance) < 0 ? 'text-rose-600' : ''}`}>
                          {formatCurrency(Number(r.variance || (r.total_allocated - r.total_claimed)), 'KES')}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => openReviewReport(r)}>Review</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ ACCOUNTANT MISC TAB ════════ */}
      {activeTab === 'accountant' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="Pending Requests" value={String(acctPending.length)} subtitle={formatCurrency(acctPending.reduce((s: number, r: any) => s + Number(r.amount_requested || 0), 0), 'KES')} icon={Clock} className={acctPending.length > 0 ? 'border-amber-200' : ''} />
            <StatCard title="Approved" value={String(acctApproved.length)} subtitle={formatCurrency(acctTotalApproved, 'KES')} icon={CheckCircle2} />
            <StatCard title="Declined" value={String(acctRequests.filter((r) => r.status === 'declined').length)} icon={AlertCircle} />
            <StatCard title="Total Requested (All)" value={formatCurrency(acctRequests.reduce((s: number, r: any) => s + Number(r.amount_requested || 0), 0), 'KES')} icon={DollarSign} />
          </div>

          <Card className="io-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">All Accountant Misc Requests</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>CFO Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {acctRequests.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-slate-400">No accountant misc requests found.</TableCell>
                    </TableRow>
                  ) : (
                    acctRequests.map((r: any) => (
                      <TableRow key={r.id} className={r.status === 'pending' ? 'bg-amber-50/50' : ''}>
                        <TableCell className="text-sm text-slate-500">{formatDate(r.created_at)}</TableCell>
                        <TableCell className="font-medium text-sm max-w-[200px] truncate">{r.purpose}</TableCell>
                        <TableCell className="text-sm">{(r.users as any)?.full_name || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(r.amount_requested), 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{r.amount_approved ? formatCurrency(Number(r.amount_approved), 'KES') : '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={
                            r.status === 'pending' ? 'bg-amber-100 text-amber-700'
                              : r.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                : r.status === 'declined' ? 'bg-rose-100 text-rose-700'
                                  : 'bg-blue-100 text-blue-700'
                          }>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[150px] truncate">
                          {r.cfo_notes ? r.cfo_notes.replace(/\[PENDING_DELETE\]/g, '').replace(/\[prev:\w+\]/g, '').trim() : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ════════ RED FLAGS TAB ════════ */}
      {activeTab === 'redflags' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="Active Red Flags" value={String(allActiveFlags.length)} icon={AlertTriangle} className={allActiveFlags.length > 0 ? 'border-rose-200 bg-rose-50/30' : ''} />
            <StatCard title="Critical / High" value={String(allActiveFlags.filter((f: any) => f.severity === 'critical' || f.severity === 'high').length)} icon={AlertTriangle} className="border-orange-200" />
            <StatCard title="Medium" value={String(allActiveFlags.filter((f: any) => f.severity === 'medium').length)} icon={AlertCircle} />
            <StatCard title="Misc/Expense Related" value={String(miscFlags.length)} icon={Flag} />
          </div>

          {allActiveFlags.length === 0 ? (
            <Card className="io-card">
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-lg font-medium text-emerald-700">All Clear</p>
                <p className="text-sm text-slate-400">No active red flags. Everything is in order.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="io-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">All Active Red Flags</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Severity</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Month</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allActiveFlags.map((f: any) => (
                      <TableRow key={f.id} className={
                        f.severity === 'critical' ? 'bg-rose-50/50' : f.severity === 'high' ? 'bg-orange-50/30' : ''
                      }>
                        <TableCell>
                          <Badge variant="secondary" className={
                            f.severity === 'critical' ? 'bg-rose-100 text-rose-700'
                              : f.severity === 'high' ? 'bg-orange-100 text-orange-700'
                                : f.severity === 'medium' ? 'bg-amber-100 text-amber-700'
                                  : 'bg-blue-100 text-blue-700'
                          }>{f.severity}</Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{f.title}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-[300px]">
                          <p className="line-clamp-2">{f.description}</p>
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">{f.flag_type}</TableCell>
                        <TableCell className="text-xs text-slate-400">{f.year_month}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ════════ ACTIVITY FEED TAB ════════ */}
      {activeTab === 'feed' && (
        <Card className="io-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Draws Activity Feed — All Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {paginatedFeed.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No draws for this period.</p>
            ) : (
              <div className="space-y-2">
                {paginatedFeed.map((d: any) => (
                  <div key={d.id} className={`flex items-center justify-between rounded-lg border p-3 text-sm ${d.cfo_flagged ? 'border-rose-200 bg-rose-50/30' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-slate-400 text-xs">{timeAgo(d.created_at)}</span>
                        <strong>{(d.projects as any)?.name || 'Unknown'}</strong>
                        <span>—</span>
                        <span className="font-mono">{formatCurrency(Number(d.amount_approved), 'KES')}</span>
                        <Badge variant="secondary" className={d.draw_type === 'standing' ? 'bg-[#1e293b] text-white text-xs' : 'bg-amber-100 text-amber-800 text-xs'}>
                          {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'}
                        </Badge>
                        <span className="text-slate-400">— {(d.users as any)?.full_name || 'Unknown'}</span>
                        {d.raised_by_role === 'accountant' && (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-[10px]">Delegated</Badge>
                        )}
                        {d.status === 'pending_pm_approval' && (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-[10px]">Pending PM</Badge>
                        )}
                        {d.status === 'declined' && (
                          <Badge variant="secondary" className="bg-rose-100 text-rose-700 text-[10px]">Declined</Badge>
                        )}
                        {d.status === 'deleted' && (
                          <Badge variant="secondary" className="bg-slate-200 text-slate-500 text-[10px]">Deleted</Badge>
                        )}
                        {!d.expense_id && !['pending_pm_approval', 'declined', 'deleted'].includes(d.status) && (
                          <Badge variant="secondary" className="bg-slate-100 text-slate-500 text-xs">Not Recorded</Badge>
                        )}
                      </div>
                      {d.purpose && <p className="text-slate-500 truncate max-w-lg">{d.purpose}</p>}
                      {d.cfo_flagged && d.cfo_flag_reason && (
                        <p className="text-rose-600 text-xs mt-1">⚑ Flagged: {d.cfo_flag_reason}</p>
                      )}
                    </div>
                    {!d.cfo_flagged ? (
                      <Button variant="ghost" size="sm" className="text-xs text-amber-600" onClick={() => setFlagDraw(d)}>
                        <Flag className="h-3 w-3 mr-1" /> Flag
                      </Button>
                    ) : (
                      <Badge variant="secondary" className="bg-rose-100 text-rose-700 text-xs">Flagged</Badge>
                    )}
                  </div>
                ))}
                {hasMoreFeed && (
                  <div className="text-center pt-2">
                    <Button variant="outline" size="sm" onClick={() => setFeedPage((p) => p + 1)}>Load More</Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ════════ PROJECT DETAIL DIALOG ════════ */}
      <Dialog open={!!detailProject} onOpenChange={() => setDetailProject(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Misc Detail — {detailProject?.name}</DialogTitle>
            <DialogDescription>{formatYearMonth(selectedMonth)} draws + {formatYearMonth(prevMonthStr)} report</DialogDescription>
          </DialogHeader>

          {/* Draws for current month */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Current Month Draws ({formatYearMonth(selectedMonth)})</h4>
            {detailDraws.length === 0 ? (
              <p className="text-sm text-slate-400">No draws this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expensed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailDraws.map((d: any) => (
                    <TableRow key={d.id} className={d.cfo_flagged ? 'bg-rose-50/50' : ''}>
                      <TableCell className="text-sm">{formatDate(d.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={d.draw_type === 'standing' ? 'bg-[#1e293b] text-white text-xs' : 'bg-amber-100 text-amber-800 text-xs'}>
                          {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">{d.purpose}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(d.amount_approved), 'KES')}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={
                          d.cfo_flagged ? 'bg-rose-100 text-rose-700' : d.status === 'accounted' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                        }>
                          {d.cfo_flagged ? 'Flagged' : d.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{d.expense_id ? <span className="text-emerald-600">✓</span> : <span className="text-amber-500">⚠</span>}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell colSpan={3} className="text-right">Total</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(detailDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0), 'KES')}</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}

            <Separator />

            {/* Report items for previous month */}
            <h4 className="text-sm font-semibold">Previous Month Report Items ({formatYearMonth(prevMonthStr)})</h4>
            {detailReportItems.length === 0 ? (
              <p className="text-sm text-slate-400">No report items for previous month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailReportItems.map((item: any, idx: number) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-slate-400 text-sm">{idx + 1}</TableCell>
                      <TableCell className="text-sm">{formatDate(item.expense_date)}</TableCell>
                      <TableCell className="text-sm">{item.description}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(item.amount), 'KES')}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell colSpan={3} className="text-right">Total Claimed</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(detailReportItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0), 'KES')}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailProject(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════ REVIEW REPORT DIALOG ════════ */}
      <Dialog open={!!reviewReport} onOpenChange={() => setReviewReport(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Misc Report — {(reviewReport?.projects as any)?.name}</DialogTitle>
            <DialogDescription>Period: {reviewReport?.period_month}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-4 text-sm mb-3">
            <span>Allocated: <strong>{formatCurrency(Number(reviewReport?.total_allocated || 0), 'KES')}</strong></span>
            <span>Claimed: <strong>{formatCurrency(Number(reviewReport?.total_claimed || 0), 'KES')}</strong></span>
            <span className={Number(reviewReport?.variance) < 0 ? 'text-red-600' : ''}>
              Variance: <strong>{formatCurrency(Number(reviewReport?.variance || (reviewReport?.total_allocated - reviewReport?.total_claimed) || 0), 'KES')}</strong>
            </span>
          </div>
          {reviewReport?.variance_explanation && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm mb-3">
              <strong className="text-amber-700">Variance Explanation:</strong>
              <p className="text-slate-600 mt-1">{reviewReport.variance_explanation}</p>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewItems.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{formatDate(item.expense_date)}</TableCell>
                  <TableCell className="font-medium text-sm">{item.description}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(item.amount), 'KES')}</TableCell>
                </TableRow>
              ))}
              {reviewItems.length > 0 && (
                <TableRow className="font-bold bg-slate-50">
                  <TableCell colSpan={2} className="text-right">Total</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(reviewItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0), 'KES')}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewReport(null)}>Close</Button>
            {reviewReport?.status === 'submitted' && (
              <Button onClick={markReviewed} className="bg-[#0f172a] text-white">Mark as CFO Reviewed</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════ FLAG DIALOG ════════ */}
      <Dialog open={!!flagDraw} onOpenChange={() => { setFlagDraw(null); setFlagReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Flag Misc Draw</DialogTitle>
            <DialogDescription>
              Flag this draw for {(flagDraw?.projects as any)?.name} — {formatCurrency(Number(flagDraw?.amount_approved || 0), 'KES')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} placeholder="Describe why this draw is being flagged..." rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFlagDraw(null); setFlagReason(''); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleFlagDraw} disabled={!flagReason.trim()}>Flag Draw</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// ACCOUNTANT VIEW
// ══════════════════════════════════════════════════════════════════

function AccountantMiscView({ user, selectedMonth }: { user: any; selectedMonth: string }) {
  const [loading, setLoading] = useState(true);
  const [pendingDraws, setPendingDraws] = useState<any[]>([]);
  const [recordedDraws, setRecordedDraws] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [allDrawsByProject, setAllDrawsByProject] = useState<Map<string, any[]>>(new Map());

  // Record expense dialog
  const [recordDraw, setRecordDraw] = useState<any>(null);
  const [recording, setRecording] = useState(false);

  // Raise request state
  const [showRaiseForm, setShowRaiseForm] = useState(false);
  const [raiseProjectId, setRaiseProjectId] = useState('');
  const [raiseAmount, setRaiseAmount] = useState('');
  const [raisePurpose, setRaisePurpose] = useState('');
  const [raiseNotes, setRaiseNotes] = useState('');
  const [raising, setRaising] = useState(false);

  // Returned (declined) requests
  const [returnedDraws, setReturnedDraws] = useState<any[]>([]);
  const [myPendingDraws, setMyPendingDraws] = useState<any[]>([]);
  const [reviseDrawId, setReviseDrawId] = useState<string | null>(null);
  const [reviseAmount, setReviseAmount] = useState('');
  const [revisePurpose, setRevisePurpose] = useState('');
  const [reviseNotes, setReviseNotes] = useState('');
  const [revising, setRevising] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const periodDate = selectedMonth + '-01';

    // Load all projects
    const { data: projData } = await supabase.from('projects').select('id, name').eq('is_active', true).order('name');
    setProjects(projData || []);

    // Pending: all draws where expense_id is null
    const { data: pending } = await supabase
      .from('misc_draws')
      .select('*, projects(name), users!misc_draws_requested_by_fkey(full_name)')
      .is('expense_id', null)
      .order('created_at', { ascending: true });
    setPendingDraws(pending || []);

    // Recorded: draws for current month with expense_id
    const { data: recorded } = await supabase
      .from('misc_draws')
      .select('*, projects(name)')
      .eq('period_month', periodDate)
      .not('expense_id', 'is', null)
      .order('created_at', { ascending: false });
    setRecordedDraws(recorded || []);

    // All draws for current month by project (for reconciliation)
    const { data: allDraws } = await supabase
      .from('misc_draws')
      .select('*')
      .eq('period_month', periodDate);
    const byProject = new Map<string, any[]>();
    for (const d of (allDraws || [])) {
      const arr = byProject.get(d.project_id) || [];
      arr.push(d);
      byProject.set(d.project_id, arr);
    }
    setAllDrawsByProject(byProject);

    // Reports for all projects
    const { data: reps } = await supabase
      .from('misc_reports')
      .select('*')
      .eq('period_month', getPrevMonth(selectedMonth));
    setReports(reps || []);

    // Accountant's own raised draws: declined (returned) and pending
    const { data: myDeclined } = await supabase
      .from('misc_draws')
      .select('*, projects(name)')
      .eq('raised_by', user.id)
      .eq('pm_approval_status', 'declined')
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });
    setReturnedDraws(myDeclined || []);

    const { data: myPending } = await supabase
      .from('misc_draws')
      .select('*, projects(name)')
      .eq('raised_by', user.id)
      .eq('pm_approval_status', 'pending')
      .eq('status', 'pending_pm_approval')
      .order('created_at', { ascending: false });
    setMyPendingDraws(myPending || []);

    setLoading(false);
  }, [selectedMonth, user.id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleRecordExpense() {
    if (!recordDraw) return;
    setRecording(true);
    const supabase = createClient();

    // Derive year_month from draw date
    const drawDate = recordDraw.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];
    const ym = drawDate.substring(0, 7); // YYYY-MM

    // Insert expense
    const { data: expense, error: expErr } = await supabase.from('expenses').insert({
      project_id: recordDraw.project_id,
      description: `Misc — ${recordDraw.purpose || 'Standing allocation'}`,
      amount_kes: Number(recordDraw.amount_approved),
      expense_type: 'project_expense',
      expense_date: drawDate,
      year_month: ym,
      vendor: 'Misc Draw',
      created_by: user.id,
    }).select().single();

    if (expErr) {
      toast.error(expErr.message);
      setRecording(false);
      return;
    }

    // Update misc_draws with expense_id
    await supabase.from('misc_draws').update({
      expense_id: expense.id,
      accountant_notified_at: new Date().toISOString(),
    }).eq('id', recordDraw.id);

    const projectName = (recordDraw.projects as any)?.name || 'Unknown';
    toast.success(`Expense recorded for ${projectName} misc draw.`);
    setRecordDraw(null);
    setRecording(false);
    loadData();
  }

  async function handleRaiseRequest() {
    const parsedAmount = parseFloat(raiseAmount);
    const normalizedPurpose = raisePurpose.trim();
    if (!raiseProjectId || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || normalizedPurpose.length < 10) {
      toast.error('Select project, enter amount, and provide purpose (min 10 chars).');
      return;
    }
    setRaising(true);
    const headers = await getAuthHeaders();
    const periodMonth = selectedMonth;
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'accountant_raise',
        project_id: raiseProjectId,
        period_month: periodMonth,
        amount: parsedAmount,
        purpose: normalizedPurpose,
        accountant_notes: raiseNotes || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success('Request raised. PM has been notified for approval.');
      setShowRaiseForm(false);
      setRaiseProjectId('');
      setRaiseAmount('');
      setRaisePurpose('');
      setRaiseNotes('');
      loadData();
    } else {
      toast.error(getUserErrorMessage(data?.error, 'Failed to raise request.'));
    }
    setRaising(false);
  }

  async function handleReviseRequest() {
    if (!reviseDrawId) return;
    const draw = returnedDraws.find((d: any) => d.id === reviseDrawId);
    if (!draw) return;
    const nextAmount = reviseAmount ? parseFloat(reviseAmount) : Number(draw.amount_requested || 0);
    const nextPurpose = (revisePurpose || draw.purpose || '').trim();
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      toast.error('Amount must be greater than zero.');
      return;
    }
    if (nextPurpose.length < 10) {
      toast.error('Purpose must be at least 10 characters.');
      return;
    }
    setRevising(true);
    const headers = await getAuthHeaders();
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'accountant_revise',
        project_id: draw.project_id,
        period_month: selectedMonth,
        draw_id: reviseDrawId,
        amount: nextAmount,
        purpose: nextPurpose,
        accountant_notes: reviseNotes || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      toast.success('Request revised and resubmitted for PM approval.');
      setReviseDrawId(null);
      setReviseAmount('');
      setRevisePurpose('');
      setReviseNotes('');
      loadData();
    } else {
      toast.error(getUserErrorMessage(data?.error, 'Failed to revise request.'));
    }
    setRevising(false);
  }

  async function handleAccountantDeleteDraw(drawId: string) {
    const headers = await getAuthHeaders();
    const draw = [...returnedDraws, ...myPendingDraws].find((d: any) => d.id === drawId);
    if (!draw) return;
    const res = await fetch('/api/misc-draws', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'accountant_delete_draw',
        project_id: draw.project_id,
        period_month: selectedMonth,
        draw_id: drawId,
      }),
    });
    if (res.ok) {
      toast.success('Request withdrawn.');
      loadData();
    } else {
      const data = await res.json();
      toast.error(getUserErrorMessage(data?.error, 'Failed to delete.'));
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-8">Loading accountant view...</div>;
  }

  const pendingTotal = pendingDraws.reduce((s, d) => s + Number(d.amount_approved || 0), 0);
  const recordedTotal = recordedDraws.reduce((s, d) => s + Number(d.amount_approved || 0), 0);
  const reportsSubmitted = reports.filter((r: any) => r.status === 'submitted' || r.status === 'cfo_reviewed').length;
  const totalProjectsWithDraws = allDrawsByProject.size;

  return (
    <div className="space-y-6">
      {/* Header Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Draws to Record"
          value={String(pendingDraws.length)}
          subtitle={formatCurrency(pendingTotal, 'KES')}
          icon={AlertCircle}
          className={pendingDraws.length > 0 ? 'border-amber-200' : ''}
        />
        <StatCard
          title="Total Misc Expensed (MTD)"
          value={String(recordedDraws.length)}
          subtitle={formatCurrency(recordedTotal, 'KES')}
          icon={Receipt}
        />
        <StatCard
          title="Reports Submitted"
          value={`${reportsSubmitted} of ${totalProjectsWithDraws > 0 ? totalProjectsWithDraws : projects.length}`}
          icon={FileText}
        />
      </div>

      {/* Raise Request Button + My Pending Requests */}
      <Card className="io-card">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4 text-purple-600" />
            Raise Misc Request (on behalf of PM)
          </CardTitle>
          <Button size="sm" className="gap-1 bg-purple-600 hover:bg-purple-700 text-white" onClick={() => setShowRaiseForm(true)}>
            <Plus className="h-3 w-3" /> Raise Request
          </Button>
        </CardHeader>
        <CardContent>
          {/* My Pending Requests */}
          {myPendingDraws.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-purple-700 mb-2">Pending PM Approval ({myPendingDraws.length})</p>
              <div className="space-y-2">
                {myPendingDraws.map((d: any) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border border-purple-200 bg-purple-50/50 p-3 text-sm">
                    <div>
                      <strong>{(d.projects as any)?.name}</strong> &mdash; {formatCurrency(Number(d.amount_requested), 'KES')}
                      <p className="text-xs text-slate-500 truncate max-w-md">{d.purpose}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-purple-100 text-purple-700 text-xs">Awaiting PM</Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => handleAccountantDeleteDraw(d.id)} title="Withdraw request">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Returned (Declined) Requests */}
          {returnedDraws.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-rose-700 mb-2">Returned Requests ({returnedDraws.length})</p>
              <div className="space-y-2">
                {returnedDraws.map((d: any) => (
                  <div key={d.id} className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <strong>{(d.projects as any)?.name}</strong>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => {
                          setReviseDrawId(d.id);
                          setReviseAmount(String(d.amount_requested));
                          setRevisePurpose(d.purpose || '');
                          setReviseNotes(d.accountant_notes || '');
                        }}>
                          Revise & Resubmit
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" onClick={() => handleAccountantDeleteDraw(d.id)} title="Withdraw">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600">{d.purpose} &mdash; {formatCurrency(Number(d.amount_requested), 'KES')}</p>
                    {d.pm_decline_reason && (
                      <p className="text-xs text-rose-600 mt-1">PM Decline Reason: {d.pm_decline_reason}</p>
                    )}
                    {d.revision_count > 0 && (
                      <p className="text-xs text-slate-400">Revision #{d.revision_count}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {myPendingDraws.length === 0 && returnedDraws.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">No pending or returned requests. Use the button above to raise a request on behalf of a PM.</p>
          )}
        </CardContent>
      </Card>

      {/* Raise Request Dialog */}
      <Dialog open={showRaiseForm} onOpenChange={setShowRaiseForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise Misc Request</DialogTitle>
            <DialogDescription>Create a misc draw request on behalf of a Project Manager. The PM will need to approve it before it becomes active.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Project *</Label>
              <Select value={raiseProjectId} onValueChange={(v) => v && setRaiseProjectId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Amount (KES) *</Label>
              <Input type="number" step="0.01" value={raiseAmount} onChange={(e) => setRaiseAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>Purpose *</Label>
              <Textarea value={raisePurpose} onChange={(e) => setRaisePurpose(e.target.value)} placeholder="Describe what these funds are needed for (min 10 chars)" rows={3} />
              {raisePurpose.length > 0 && raisePurpose.length < 10 && (
                <p className="text-xs text-rose-500">Minimum 10 characters required.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Accountant Notes (optional)</Label>
              <Textarea value={raiseNotes} onChange={(e) => setRaiseNotes(e.target.value)} placeholder="Any additional context for the PM..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRaiseForm(false)}>Cancel</Button>
            <Button onClick={handleRaiseRequest} disabled={raising || !raiseProjectId || !raiseAmount || parseFloat(raiseAmount) <= 0 || raisePurpose.trim().length < 10} className="bg-purple-600 hover:bg-purple-700 text-white">
              {raising ? 'Raising...' : 'Raise Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revise Request Dialog */}
      <Dialog open={!!reviseDrawId} onOpenChange={() => { setReviseDrawId(null); setReviseAmount(''); setRevisePurpose(''); setReviseNotes(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revise & Resubmit</DialogTitle>
            <DialogDescription>Adjust the request and resubmit for PM approval.</DialogDescription>
          </DialogHeader>
          {reviseDrawId && (() => {
            const draw = returnedDraws.find((d: any) => d.id === reviseDrawId);
            return draw ? (
              <div className="space-y-4">
                {draw.pm_decline_reason && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm">
                    <strong className="text-rose-700">PM Decline Reason:</strong>
                    <p className="text-slate-600 mt-1">{draw.pm_decline_reason}</p>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Amount (KES)</Label>
                  <Input type="number" step="0.01" value={reviseAmount} onChange={(e) => setReviseAmount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Purpose</Label>
                  <Textarea value={revisePurpose} onChange={(e) => setRevisePurpose(e.target.value)} rows={3} />
                </div>
                <div className="space-y-1">
                  <Label>Additional Notes</Label>
                  <Textarea value={reviseNotes} onChange={(e) => setReviseNotes(e.target.value)} placeholder="Address PM feedback..." rows={2} />
                </div>
              </div>
            ) : null;
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseDrawId(null)}>Cancel</Button>
            <Button onClick={handleReviseRequest} disabled={revising || (!!reviseAmount && parseFloat(reviseAmount) <= 0) || revisePurpose.trim().length < 10} className="bg-purple-600 hover:bg-purple-700 text-white">
              {revising ? 'Resubmitting...' : 'Revise & Resubmit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Draws to Record Table */}
      <Card className="io-card border-amber-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            Draws to Record ({pendingDraws.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>PM</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount (KES)</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-center">Days Pending</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingDraws.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-slate-400">All draws have been recorded. You are up to date.</TableCell>
                </TableRow>
              ) : (
                pendingDraws.map((d: any) => {
                  const daysPending = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000);
                  return (
                    <TableRow key={d.id} className={daysPending > 2 ? 'bg-amber-50/50' : ''}>
                      <TableCell className="font-medium">{(d.projects as any)?.name || '—'}</TableCell>
                      <TableCell className="text-sm">{(d.users as any)?.full_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={d.draw_type === 'standing' ? 'bg-[#1e293b] text-white' : 'bg-amber-100 text-amber-800'}>
                          {d.draw_type === 'standing' ? 'Standing' : 'Top-Up'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(Number(d.amount_approved), 'KES')}</TableCell>
                      <TableCell className="text-sm">{formatDate(d.created_at)}</TableCell>
                      <TableCell className="text-center">
                        <span className={daysPending > 2 ? 'text-amber-600 font-bold' : ''}>{daysPending}d</span>
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => setRecordDraw(d)}>Record</Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Project Reconciliation Table */}
      <Card className="io-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Project Reconciliation &mdash; {formatYearMonth(selectedMonth)}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Total Draws</TableHead>
                <TableHead className="text-right">Total Expensed</TableHead>
                <TableHead>Report Status</TableHead>
                <TableHead>Accountant Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.filter((p) => allDrawsByProject.has(p.id)).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-6 text-slate-400">No draws for this period.</TableCell>
                </TableRow>
              ) : (
                projects.filter((p) => allDrawsByProject.has(p.id)).map((p) => {
                  const projDraws = allDrawsByProject.get(p.id) || [];
                  const totalDrawnProj = projDraws.reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
                  const totalExpensed = projDraws.filter((d: any) => d.expense_id).reduce((s: number, d: any) => s + Number(d.amount_approved || 0), 0);
                  const report = reports.find((r: any) => r.project_id === p.id);
                  const allRecorded = projDraws.every((d: any) => d.expense_id);

                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(totalDrawnProj, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatCurrency(totalExpensed, 'KES')}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={
                          report?.status === 'submitted' ? 'bg-blue-100 text-blue-700'
                            : report?.status === 'cfo_reviewed' ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-100 text-slate-600'
                        }>
                          {report ? (report.status === 'cfo_reviewed' ? 'Reviewed' : report.status) : 'No Report'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {allRecorded ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">All Recorded</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                            {projDraws.filter((d: any) => !d.expense_id).length} Pending
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Record Expense Dialog */}
      <Dialog open={!!recordDraw} onOpenChange={() => setRecordDraw(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Expense</DialogTitle>
            <DialogDescription>Confirm and record this misc draw as an expense.</DialogDescription>
          </DialogHeader>
          {recordDraw && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-slate-50 p-3 space-y-1">
                <div className="flex justify-between"><span className="text-slate-400">Project:</span><strong>{(recordDraw.projects as any)?.name}</strong></div>
                <div className="flex justify-between"><span className="text-slate-400">Amount:</span><strong>{formatCurrency(Number(recordDraw.amount_approved), 'KES')}</strong></div>
                <div className="flex justify-between"><span className="text-slate-400">Purpose:</span><strong>{recordDraw.purpose || 'Standing allocation'}</strong></div>
                <div className="flex justify-between"><span className="text-slate-400">Date:</span><strong>{formatDate(recordDraw.created_at)}</strong></div>
                <div className="flex justify-between"><span className="text-slate-400">Type:</span><strong>{recordDraw.draw_type === 'standing' ? 'Standing' : 'Top-Up'}</strong></div>
              </div>
              <p className="text-slate-500">This will create an expense entry and link it to this draw.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordDraw(null)}>Cancel</Button>
            <Button onClick={handleRecordExpense} disabled={recording}>
              {recording ? 'Recording...' : 'Confirm & Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
