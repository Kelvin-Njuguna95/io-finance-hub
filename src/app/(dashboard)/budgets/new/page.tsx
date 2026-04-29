'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { formatYearMonth, getCurrentYearMonth } from '@/lib/format';
import { toast } from 'sonner';
import type { Department } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import {
  getActiveProjects,
  getAssignedActiveProjects,
} from '@/lib/queries/projects';
import { canSubmitDepartmentBudget } from '@/lib/permissions';
import {
  BudgetForm,
  type ExistingBudgetSummary,
  type ScopeKind,
} from '@/components/budgets/budget-form';
import type { LineItem } from '@/components/budgets/line-item-editor';

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
      quantity: 1,
      unit_cost_kes: 0,
      notes: '',
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
        quantity: 1,
        unit_cost_kes: 0,
        notes: '',
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

  const totalKes = items.reduce(
    (s, i) => s + i.quantity * i.unit_cost_kes,
    0,
  );

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
      toast.error(
        'Each line item must have quantity and amount greater than zero.',
      );
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
        <BudgetForm
          scopeOptions={{
            projects,
            departments: departments.map((d) => ({ id: d.id, name: d.name })),
            canCreateDepartment: canCreateDepartmentBudget,
          }}
          scope={{ type: scopeType, id: scopeId, yearMonth }}
          onScopeChange={(next) => {
            if (next.type !== undefined) setScopeType(next.type);
            if (next.id !== undefined) setScopeId(next.id);
            if (next.yearMonth !== undefined) setYearMonth(next.yearMonth);
          }}
          notes={notes}
          onNotesChange={setNotes}
          items={items}
          categories={categories}
          lineItemHandlers={{
            onAdd: addItem,
            onRemove: removeItem,
            onUpdate: updateItem,
          }}
          existingBudgets={existingBudgets}
          miscGateBlocked={miscGateBlocked}
          miscGateMessage={miscGateMessage}
          submitting={saving}
          showScopeTypeToggle={showScopeTypeToggle}
          showFirstSubmitterNotice={showFirstSubmitterNotice}
          onDiscard={() => router.push('/budgets')}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
