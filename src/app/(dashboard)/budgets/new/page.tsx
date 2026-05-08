'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Info, Plus, Save, Send, Trash2, X } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  formatCurrency,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { toast } from 'sonner';
import type { Department } from '@/types/database';
import { ROLE_LABELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import {
  getActiveProjects,
  getAssignedActiveProjects,
} from '@/lib/queries/projects';
import { canSubmitDepartmentBudget } from '@/lib/permissions';

type ScopeKind = 'project' | 'department';

type LineItem = {
  id: string;
  description: string;
  category: string;
  amount_kes: number;
};

type ExistingBudgetSummary = {
  submitted_by_role: string;
  submitted_by_name: string;
  submitted_at: string;
  total_kes: number;
  status: string;
};

const MONTH_OPTIONS = 6;

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function NewBudgetPage() {
  const { user } = useUser();
  const router = useRouter();
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [scopeType, setScopeType] = useState<ScopeKind>('project');
  const [scopeId, setScopeId] = useState('');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    {
      id: generateId(),
      description: '',
      category: '',
      amount_kes: 0,
    },
  ]);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [existingBudgets, setExistingBudgets] = useState<ExistingBudgetSummary[]>([]);
  const [miscGateBlocked, setMiscGateBlocked] = useState(false);
  const [miscGateMessage, setMiscGateMessage] = useState('');

  const isAccountant = user?.role === 'accountant';
  const canCreateDepartmentBudget = canSubmitDepartmentBudget(user?.role);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Load budget categories (expense categories minus Administration)
      const { data: cats } = await supabase
        .from('expense_categories')
        .select('name')
        .eq('is_active', true)
        .neq('name', 'Administration')
        .order('name');
      setCategories((cats || []).map((c: { name: string }) => c.name));

      if (user?.role === 'team_leader') {
        // Load only assigned projects
        const { data: assignedProjects } = await getAssignedActiveProjects(
          supabase,
          user.id,
        );
        setProjects(assignedProjects || []);
        setScopeType('project');
      } else if (user?.role === 'accountant') {
        // Accountant can submit for ANY active project or department
        const [projectsRes, departmentsRes] = await Promise.all([
          getActiveProjects(supabase),
          supabase.from('departments').select('*').order('name'),
        ]);
        setProjects(projectsRes.data || []);
        setDepartments(departmentsRes.data || []);
        setScopeType('project');
      } else if (user?.role === 'project_manager') {
        const { data: assignedProjects } = await getAssignedActiveProjects(
          supabase,
          user.id,
        );
        setProjects(assignedProjects || []);
        setScopeType('project');
      } else if (user?.role === 'department_head') {
        const { data: departmentsRes } = await supabase
          .from('departments')
          .select('*')
          .eq('owner_user_id', user.id)
          .order('name');
        setDepartments(departmentsRes || []);
        setScopeType('department');
      } else if (user?.role === 'cfo') {
        const [projRes, deptRes] = await Promise.all([
          getActiveProjects(supabase),
          supabase.from('departments').select('*').order('name'),
        ]);
        setProjects(projRes.data || []);
        setDepartments(deptRes.data || []);
      }
    }
    if (user) load();
  }, [user]);

  // Check for existing budgets when scope/month changes
  useEffect(() => {
    if (!canCreateDepartmentBudget && scopeType === 'department') {
      setScopeType('project');
      setScopeId('');
    }
  }, [canCreateDepartmentBudget, scopeType]);

  useEffect(() => {
    async function checkExisting() {
      if (!scopeId || !yearMonth) {
        setExistingBudgets([]);
        return;
      }
      const supabase = createClient();
      const query = supabase
        .from('budgets')
        .select(
          'id, submitted_by_role, created_by, budget_versions(status, total_amount_kes, submitted_at, submitted_by)',
        )
        .eq('year_month', yearMonth);

      if (scopeType === 'project') {
        query.eq('project_id', scopeId);
      } else {
        query.eq('department_id', scopeId);
      }

      const { data } = await query;

      if (!data || data.length === 0) {
        setExistingBudgets([]);
        return;
      }

      // Get user names for submitters
      const userIds = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data.forEach((b: any) => {
        if (b.created_by) userIds.add(b.created_by);
      });
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', Array.from(userIds));
      const nameMap = new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (users || []).map((u: any) => [u.id, u.full_name]),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const infos: ExistingBudgetSummary[] = data.map((b: any) => {
        const vers = (b.budget_versions || [])[0];
        return {
          submitted_by_role: b.submitted_by_role || 'team_leader',
          submitted_by_name: nameMap.get(b.created_by) || 'Unknown',
          submitted_at: vers?.submitted_at || '',
          total_kes: Number(vers?.total_amount_kes || 0),
          status: vers?.status || 'draft',
        };
      });
      setExistingBudgets(infos);
    }
    checkExisting();
  }, [scopeId, yearMonth, scopeType]);

  // Misc gate check for accountant submissions
  useEffect(() => {
    async function checkMiscGate() {
      if (!isAccountant || !scopeId || scopeType !== 'project') {
        setMiscGateBlocked(false);
        return;
      }
      const supabase = createClient();

      // Check misc gate start month
      const { data: gateSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'misc_gate_start_month')
        .single();
      const gateStartMonth = gateSetting?.value || '2026-04';
      if (yearMonth < gateStartMonth) {
        setMiscGateBlocked(false);
        return;
      }

      // Previous month
      const prevDate = new Date(
        parseInt(yearMonth.split('-')[0]),
        parseInt(yearMonth.split('-')[1]) - 2,
        1,
      );
      const prevMonth =
        prevDate.getFullYear() +
        '-' +
        String(prevDate.getMonth() + 1).padStart(2, '0');

      if (prevMonth < gateStartMonth) {
        setMiscGateBlocked(false);
        return;
      }

      // Check if misc report exists for previous month
      const { data: miscReport } = await supabase
        .from('misc_reports')
        .select('id, status')
        .eq('project_id', scopeId)
        .eq('period_month', prevMonth)
        .neq('status', 'draft')
        .limit(1);

      if (!miscReport || miscReport.length === 0) {
        // Get PM name for this project
        const { data: projAssign } = await supabase
          .from('user_project_assignments')
          .select('user_id, users(full_name)')
          .eq('project_id', scopeId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        const pmAssign = projAssign?.find((a: any) => true);
        const pmName =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (pmAssign as any)?.users?.full_name || 'the Project Manager';
        const projectName =
          projects.find((p) => p.id === scopeId)?.name || 'this project';

        setMiscGateBlocked(true);
        setMiscGateMessage(
          `${pmName}'s misc report for ${formatYearMonth(prevMonth)} has not been submitted for ${projectName}. The budget cannot be submitted until this is complete. Contact ${pmName} to submit their misc report.`,
        );
      } else {
        setMiscGateBlocked(false);
      }
    }
    checkMiscGate();
  }, [scopeId, yearMonth, isAccountant, scopeType, projects]);

  function addItem() {
    setItems([
      ...items,
      {
        id: generateId(),
        description: '',
        category: '',
        amount_kes: 0,
      },
    ]);
  }

  function removeItem(id: string) {
    if (items.length <= 1) return;
    setItems(items.filter((i) => i.id !== id));
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)),
    );
  }

  const totalKes = items.reduce((s, i) => s + (i.amount_kes || 0), 0);

  async function handleSave(submit: boolean) {
    if (!scopeId) {
      toast.error('Please select a project or department');
      return;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error('All line items must have a description');
      return;
    }
    if (items.some((i) => i.amount_kes <= 0)) {
      toast.error('Each line item must have an amount greater than zero.');
      return;
    }
    if (totalKes <= 0) {
      toast.error('Total budget amount must be greater than zero.');
      return;
    }
    if (submit && miscGateBlocked) {
      toast.error(
        'Cannot submit — misc report gate is blocking. See the warning above.',
      );
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();

      // Determine submitted_by_role
      const submittedByRole =
        user?.role === 'accountant'
          ? 'accountant'
          : user?.role === 'project_manager'
            ? 'project_manager'
            : user?.role === 'department_head'
              ? 'department_head'
              : user?.role === 'cfo'
                ? 'cfo'
                : 'team_leader';

      // Get auth session for API calls
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired. Please log in again.');
        return;
      }

      // Create budget via API (bypasses RLS, uses admin client)
      const createRes = await fetch('/api/budgets/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeId,
          year_month: yearMonth,
          notes,
          items: items.map((item) => ({
            description: item.description,
            category: item.category || null,
            quantity: 1,
            unit_cost_kes: item.amount_kes,
            notes: null,
          })),
          submit,
        }),
      });

      const createData = await createRes.json();

      if (!createRes.ok) {
        toast.error(getUserErrorMessage(createData?.error, 'Failed to create budget'));
        return;
      }

      // Send notifications and audit log if submitting
      if (submit) {
        const scopeName =
          scopeType === 'project'
            ? projects.find((p) => p.id === scopeId)?.name ?? 'Unknown'
            : departments.find((d) => d.id === scopeId)?.name ?? 'Unknown';
        try {
          await fetch('/api/budgets/accountant-submit-notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              budget_id: createData.budget_id,
              ...(scopeType === 'project'
                ? { project_id: scopeId, project_name: scopeName }
                : { department_id: scopeId, department_name: scopeName }),
              year_month: yearMonth,
              total_kes: totalKes,
              submitted_by_role: submittedByRole,
              existing_tl_budget: existingBudgets.some(
                (b) => b.submitted_by_role === 'team_leader',
              ),
              scope_type: scopeType,
              scope_name: scopeName,
            }),
          });
        } catch (e) {
          // Non-blocking — notifications are best-effort
          console.error('Notification failed:', e);
        }
      }

      const submittedStatus = createData?.status as string | undefined;
      const successMessage = submit
        ? submittedStatus === 'pm_review'
          ? 'Budget submitted for PM review'
          : 'Budget submitted to CFO queue'
        : 'Budget saved as draft';
      toast.success(successMessage);
      router.push('/budgets');
    } catch (error) {
      toast.error(
        getUserErrorMessage(
          error,
          'Could not save budget right now. Please try again.',
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const showScopeTypeToggle =
    user?.role === 'cfo' ||
    user?.role === 'project_manager' ||
    user?.role === 'accountant';
  const showFirstSubmitterNotice =
    isAccountant || user?.role === 'team_leader';
  const activeScopeOptions =
    scopeType === 'project'
      ? projects
      : departments.map((d) => ({ id: d.id, name: d.name }));
  const selectedScopeName =
    activeScopeOptions.find((s) => s.id === scopeId)?.name ?? '';

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="New budget"
          accent="draft"
          subtitle={
            user
              ? `${formatYearMonth(yearMonth)} · author ${user.full_name}`
              : formatYearMonth(yearMonth)
          }
        />
      </div>

      <div className="p-6">
        {/* Two-column form layout: 1.6fr / 1fr on desktop, stack on mobile */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          {/* Left column — basics + line items */}
          <div className="space-y-6">
            {/* Card 1 — Budget basics */}
            <section className="rounded-lg border border-border bg-card p-6">
              <header className="mb-4">
                <h3 className="font-display text-[17px] font-medium text-foreground">
                  Budget basics
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                  Pick the scope and period. The budget number is generated on submit.
                </p>
              </header>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {showScopeTypeToggle && (
                  <div className="space-y-1.5">
                    <Label>Scope type</Label>
                    <Select
                      value={scopeType}
                      onValueChange={(v) => {
                        if (!v) return;
                        setScopeType(v as ScopeKind);
                        setScopeId('');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="project">Project</SelectItem>
                        {canCreateDepartmentBudget && (
                          <SelectItem value="department">Department</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>{scopeType === 'project' ? 'Project' : 'Department'} *</Label>
                  <Select
                    value={scopeId || undefined}
                    onValueChange={(v) => v && setScopeId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeScopeOptions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Period</Label>
                  <Select
                    value={yearMonth}
                    onValueChange={(v) => v && setYearMonth(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: MONTH_OPTIONS }, (_, i) => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + i);
                        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                        return (
                          <SelectItem key={ym} value={ym}>
                            {formatYearMonth(ym)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {scopeId && scopeType === 'project' && existingBudgets.length > 0 && (
                <div className="mt-4 space-y-1 rounded-lg border border-warning/30 bg-warning-soft/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-warning-soft-foreground">
                    <AlertTriangle className="size-4" />
                    {selectedScopeName} — {formatYearMonth(yearMonth)}
                  </div>
                  <p className="text-sm text-warning-soft-foreground">
                    Existing budgets this month:
                  </p>
                  {existingBudgets.map((eb, i) => (
                    <p key={i} className="pl-2 text-sm text-warning-soft-foreground">
                      — Submitted by <strong>{eb.submitted_by_name}</strong> (
                      {ROLE_LABELS[eb.submitted_by_role as keyof typeof ROLE_LABELS] ??
                        eb.submitted_by_role}
                      )
                      {eb.status !== 'draft' && (
                        <>
                          {' '}
                          · {formatCurrency(eb.total_kes, 'KES')} · Status: {eb.status}
                        </>
                      )}
                    </p>
                  ))}
                  <p className="mt-1 text-xs text-warning-soft-foreground">
                    Submitting yours will create an additional version. Both will be
                    visible to the PM for review.
                  </p>
                </div>
              )}

              {scopeId &&
                scopeType === 'project' &&
                existingBudgets.length === 0 &&
                showFirstSubmitterNotice && (
                  <div className="mt-4 rounded-lg border border-info/40 bg-info-soft/40 p-3">
                    <div className="flex items-center gap-2 text-sm text-info-soft-foreground">
                      <Info className="size-4" />
                      No budget submitted yet for this period. You are the first to
                      submit.
                    </div>
                  </div>
                )}

              {scopeType === 'department' && scopeId && (
                <div className="mt-4 rounded-lg border border-info/40 bg-info-soft/40 p-3">
                  <div className="flex items-center gap-2 text-sm text-info-soft-foreground">
                    <Info className="size-4" />
                    Department expenditures are classified as{' '}
                    <strong>shared costs</strong> and will be distributed across
                    projects during P&amp;L reporting.
                  </div>
                </div>
              )}

              {miscGateBlocked && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-danger-soft-foreground">
                    <AlertTriangle className="size-4" />
                    Submission blocked
                  </div>
                  <p className="mt-1 text-sm text-danger-soft-foreground">
                    {miscGateMessage}
                  </p>
                </div>
              )}

              <div className="mt-5 space-y-1.5">
                <Label htmlFor="budget-description">Description</Label>
                <Textarea
                  id="budget-description"
                  placeholder="What this budget pays for, written in sentence case."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
                <p className="text-[11.5px] text-[var(--warm-grey-3)]">
                  Treasury register. No marketing voice.
                </p>
              </div>
            </section>

            {/* Card 2 — Line items */}
            <section className="rounded-lg border border-border bg-card p-6">
              <header className="mb-4">
                <h3 className="font-display text-[17px] font-medium text-foreground">
                  Line items
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                  Break the budget into categories. Variance is tracked per line.
                </p>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border-subtle px-2 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground w-[36px]">
                        #
                      </th>
                      <th className="border-b border-border-subtle px-2 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Description
                      </th>
                      <th className="border-b border-border-subtle px-2 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground w-[26%]">
                        Category
                      </th>
                      <th className="border-b border-border-subtle px-2 py-2.5 text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground w-[20%]">
                        Amount · KES
                      </th>
                      <th aria-hidden className="border-b border-border-subtle w-[36px] px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={item.id} className="border-b border-border-subtle last:border-b-0">
                        <td className="px-2 py-2 align-middle font-mono tabular-nums text-[12px] text-muted-foreground">
                          {String(idx + 1).padStart(2, '0')}
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input
                            value={item.description}
                            onChange={(e) =>
                              updateItem(item.id, 'description', e.target.value)
                            }
                            placeholder="e.g. Translator licences"
                            className="h-9"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Select
                            value={item.category || undefined}
                            onValueChange={(v) => v && updateItem(item.id, 'category', v)}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder="Select…" />
                            </SelectTrigger>
                            <SelectContent>
                              {categories.map((cat) => (
                                <SelectItem key={cat} value={cat}>
                                  {cat}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={item.amount_kes || ''}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                'amount_kes',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            placeholder="0"
                            className="h-9 text-right font-mono tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <button
                            type="button"
                            aria-label="Remove line item"
                            disabled={items.length <= 1}
                            onClick={() => removeItem(item.id)}
                            className="inline-flex size-7 items-center justify-center rounded-[var(--radius)] border border-transparent bg-transparent text-muted-foreground transition-colors hover:border-danger-soft hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:hover:border-transparent"
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={addItem}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-[var(--paper-4)] bg-transparent px-3.5 py-2 text-[12.5px] text-[var(--warm-grey-3)] transition-colors hover:border-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                Add line item
              </button>
            </section>
          </div>

          {/* Right column — sticky summary placeholder (filled in commit 3) */}
          <aside className="space-y-6">
            <section
              className="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-20"
            >
              <header className="mb-3">
                <h3 className="font-display text-[17px] font-medium text-foreground">
                  Summary
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                  Live as you edit.
                </p>
              </header>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Approved total
              </div>
              <div className="mt-2 font-mono text-[32px] font-medium leading-none tracking-[-0.01em] tabular-nums text-foreground">
                <span className="mr-1.5 text-xs text-muted-foreground tracking-[0.04em]">KES</span>
                {totalKes.toLocaleString('en-KE')}
              </div>
              <p className="mt-4 text-[12.5px] text-[var(--warm-grey-3)]">
                Summary panel content lands in the next commit.
              </p>
            </section>
          </aside>
        </div>

        {/* Sticky footer — buttons move into the summary panel in commit 3 */}
        <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/budgets')}
              disabled={saving}
              className="gap-1"
            >
              <X className="size-4" /> Discard
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={saving}
              className="gap-1"
            >
              <Save className="size-4" /> Save as draft
            </Button>
            <Button
              size="sm"
              onClick={() => handleSave(true)}
              disabled={saving || miscGateBlocked}
              className="gap-1"
            >
              <Send className="size-4" /> Submit for approval
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
