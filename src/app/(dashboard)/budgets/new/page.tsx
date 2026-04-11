'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { Plus, Trash2, Save, Send, AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { Department } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import { getActiveProjects, getAssignedActiveProjects } from '@/lib/queries/projects';
import { canSubmitDepartmentBudget } from '@/lib/permissions';
import { ROLE_LABELS } from '@/types/database';

interface LineItem {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unit_cost_kes: number;
  notes: string;
}

interface ExistingBudgetInfo {
  submitted_by_role: string;
  submitted_by_name: string;
  submitted_at: string;
  total_kes: number;
  status: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function NewBudgetPage() {
  const { user } = useUser();
  const router = useRouter();
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [scopeType, setScopeType] = useState<'project' | 'department'>('project');
  const [scopeId, setScopeId] = useState('');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    { id: generateId(), description: '', category: '', quantity: 1, unit_cost_kes: 0, notes: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [existingBudgets, setExistingBudgets] = useState<ExistingBudgetInfo[]>([]);
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
        const { data: assignedProjects } = await getAssignedActiveProjects(supabase, user.id);
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
        const { data: assignedProjects } = await getAssignedActiveProjects(supabase, user.id);
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
        .select('id, submitted_by_role, created_by, budget_versions(status, total_amount_kes, submitted_at, submitted_by)')
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
      data.forEach((b: /* // */ any) => { if (b.created_by) userIds.add(b.created_by); });
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', Array.from(userIds));
      const nameMap = new Map((users || []).map((u: /* // */ any) => [u.id, u.full_name]));

      const infos: ExistingBudgetInfo[] = data.map((b: /* // */ any) => {
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
      const prevDate = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]) - 2, 1);
      const prevMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

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
        const pmAssign = projAssign?.find((a: /* // */ any) => true); // Get any assigned user
        const pmName = (pmAssign as /* // */ any)?.users?.full_name || 'the Project Manager';
        const projectName = projects.find(p => p.id === scopeId)?.name || 'this project';

        setMiscGateBlocked(true);
        setMiscGateMessage(
          `${pmName}'s misc report for ${formatYearMonth(prevMonth)} has not been submitted for ${projectName}. The budget cannot be submitted until this is complete. Contact ${pmName} to submit their misc report.`
        );
      } else {
        setMiscGateBlocked(false);
      }
    }
    checkMiscGate();
  }, [scopeId, yearMonth, isAccountant, scopeType, projects]);

  function addItem() {
    setItems([...items, { id: generateId(), description: '', category: '', quantity: 1, unit_cost_kes: 0, notes: '' }]);
  }

  function removeItem(id: string) {
    if (items.length <= 1) return;
    setItems(items.filter((i) => i.id !== id));
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  function getItemTotal(item: LineItem) {
    return {
      kes: item.quantity * item.unit_cost_kes,
    };
  }

  const totalKes = items.reduce((s, i) => s + i.quantity * i.unit_cost_kes, 0);

  async function handleSave(submit: boolean) {
    if (!scopeId) {
      toast.error('Please select a project or department');
      return;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error('All line items must have a description');
      return;
    }
    if (items.some((i) => i.quantity <= 0 || i.unit_cost_kes <= 0)) {
      toast.error('Each line item must have quantity and amount greater than zero.');
      return;
    }
    if (totalKes <= 0) {
      toast.error('Total budget amount must be greater than zero.');
      return;
    }
    if (submit && miscGateBlocked) {
      toast.error('Cannot submit — misc report gate is blocking. See the warning above.');
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();

      // Determine submitted_by_role
      const submittedByRole = user?.role === 'accountant'
        ? 'accountant'
        : user?.role === 'project_manager'
          ? 'project_manager'
          : user?.role === 'department_head'
            ? 'department_head'
            : user?.role === 'cfo'
              ? 'cfo'
              : 'team_leader';

      // Get auth session for API calls
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired. Please log in again.');
        return;
      }

      // Create budget via API (bypasses RLS, uses admin client)
      const createRes = await fetch('/api/budgets/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeId,
          year_month: yearMonth,
          notes,
          items: items.map(item => ({
            description: item.description,
            category: item.category || null,
            quantity: item.quantity,
            unit_cost_kes: item.unit_cost_kes,
            notes: item.notes || null,
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
        const scopeName = scopeType === 'project'
          ? projects.find((p) => p.id === scopeId)?.name ?? 'Unknown'
          : departments.find((d) => d.id === scopeId)?.name ?? 'Unknown';
        try {
          await fetch('/api/budgets/accountant-submit-notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              budget_id: createData.budget_id,
              ...(scopeType === 'project'
                ? { project_id: scopeId, project_name: scopeName }
                : { department_id: scopeId, department_name: scopeName }),
              year_month: yearMonth,
              total_kes: totalKes,
              submitted_by_role: submittedByRole,
              existing_tl_budget: existingBudgets.some(b => b.submitted_by_role === 'team_leader'),
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
      toast.error(getUserErrorMessage(error, 'Could not save budget right now. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Budget" description={isAccountant ? 'Submit a project or department budget' : 'Create a new budget submission'} />

      <div className="p-6 max-w-4xl space-y-6">
        {/* Scope selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Budget Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(user?.role === 'cfo' || user?.role === 'project_manager' || user?.role === 'accountant') && (
                <div className="space-y-1">
                  <Label>Scope Type</Label>
                  <Select value={scopeType} onValueChange={(v) => { if (v) { setScopeType(v as 'project' | 'department'); setScopeId(''); } }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Project</SelectItem>
                      {canCreateDepartmentBudget && <SelectItem value="department">Department</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>{scopeType === 'project' ? 'Project' : 'Department'} *</Label>
                <Select value={scopeId} onValueChange={(v) => v && setScopeId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeType === 'project'
                      ? projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                      : departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Period</Label>
                <Select value={yearMonth} onValueChange={(v) => v && setYearMonth(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 6 }, (_, i) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + i);
                      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                      return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Existing budgets context panel */}
            {scopeId && scopeType === 'project' && existingBudgets.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  {projects.find(p => p.id === scopeId)?.name} — {formatYearMonth(yearMonth)}
                </div>
                <p className="text-sm text-amber-700">
                  Existing budgets this month:
                </p>
                {existingBudgets.map((eb, i) => (
                  <p key={i} className="text-sm text-amber-700 pl-2">
                    — Submitted by <strong>{eb.submitted_by_name}</strong> ({ROLE_LABELS[eb.submitted_by_role as keyof typeof ROLE_LABELS] || eb.submitted_by_role})
                    {eb.status !== 'draft' && <> · {formatCurrency(eb.total_kes, 'KES')} · Status: {eb.status}</>}
                  </p>
                ))}
                <p className="text-xs text-amber-600 mt-1">
                  Submitting yours will create an additional version. Both will be visible to the PM for review.
                </p>
              </div>
            )}

            {scopeId && scopeType === 'project' && existingBudgets.length === 0 && (isAccountant || user?.role === 'team_leader') && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center gap-2 text-blue-700 text-sm">
                  <Info className="h-4 w-4" />
                  No budget submitted yet for this period. You are the first to submit.
                </div>
              </div>
            )}

            {scopeType === 'department' && scopeId && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center gap-2 text-blue-700 text-sm">
                  <Info className="h-4 w-4" />
                  Department expenditures are classified as <strong>shared costs</strong> and will be distributed across projects during P&amp;L reporting.
                </div>
              </div>
            )}

            {/* Misc gate warning */}
            {miscGateBlocked && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  Submission Blocked
                </div>
                <p className="text-sm text-red-700 mt-1">{miscGateMessage}</p>
              </div>
            )}

            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional budget notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Line Items</CardTitle>
            <Button variant="outline" size="sm" onClick={addItem} className="gap-1">
              <Plus className="h-3 w-3" /> Add Item
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {items.map((item, idx) => (
              <div key={item.id} className="space-y-3 rounded-md border p-4">
                <div className="flex items-start justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                  {items.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeItem(item.id)}
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Description *</Label>
                    <Input
                      value={item.description}
                      onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                      placeholder="e.g. Agent salaries"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={item.category || undefined}
                      onValueChange={(value) => {
                        if (value) updateItem(item.id, 'category', value);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, 'quantity', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Unit Cost (KES)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.unit_cost_kes || ''}
                      onChange={(e) => updateItem(item.id, 'unit_cost_kes', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>

                <div className="flex justify-end text-xs text-muted-foreground">
                  <span>Subtotal: {formatCurrency(getItemTotal(item).kes, 'KES')}</span>
                </div>
              </div>
            ))}

            <Separator />

            <div className="flex justify-end text-sm font-semibold">
              <span>Total: {formatCurrency(totalKes, 'KES')}</span>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => router.push('/budgets')}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving} className="gap-1">
            <Save className="h-4 w-4" /> Save Draft
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving || miscGateBlocked} className="gap-1">
            <Send className="h-4 w-4" /> Submit for Approval
          </Button>
        </div>
      </div>
    </div>
  );
}
