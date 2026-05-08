'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Info, Plus, Save, Send, Trash2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
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

// Mirrors ALLOWED_BUDGET_CREATOR_ROLES at /api/budgets/create/route.ts:5.
// Anyone outside this set is bounced back to /budgets on mount.
const ALLOWED_BUDGET_CREATOR_ROLES = [
  'team_leader',
  'accountant',
  'project_manager',
  'cfo',
  'department_head',
] as const;

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function NewBudgetPage() {
  return (
    <Suspense fallback={null}>
      <NewBudgetPageInner />
    </Suspense>
  );
}

function NewBudgetPageInner() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idFromUrl = searchParams.get('id');
  // One UUID per page load. Both create-paths (handleSave's first save
  // and handleSubmit's no-budgetId path) carry it so that a duplicate
  // POST hits the partial unique index instead of writing a second
  // budget. Page navigates away on submit; on save the URL replaces
  // and budgetId is set so subsequent saves no longer hit /create.
  const [idempotencyKey] = useIdempotencyKey();
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
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState<boolean>(!!idFromUrl);

  const isAccountant = user?.role === 'accountant';
  const canCreateDepartmentBudget = canSubmitDepartmentBudget(user?.role);

  // Page-level role gate. Mirrors server-side ALLOWED_BUDGET_CREATOR_ROLES
  // at /api/budgets/create/route.ts:5 — directors and any other role get
  // bounced back to the list view.
  useEffect(() => {
    if (!user) return;
    if (
      !ALLOWED_BUDGET_CREATOR_ROLES.includes(
        user.role as (typeof ALLOWED_BUDGET_CREATOR_ROLES)[number],
      )
    ) {
      router.replace('/budgets');
    }
  }, [user, router]);

  // Load existing draft when ?id= is present in the URL. If the budget's
  // active version is not in 'draft' status, the [id] detail page handles
  // it — bounce there instead of trying to edit non-draft state.
  useEffect(() => {
    if (!idFromUrl) {
      setLoadingDraft(false);
      return;
    }
    let cancelled = false;
    async function loadDraft() {
      const id = idFromUrl as string;
      const supabase = createClient();
      const { data: budget, error } = await supabase
        .from('budgets')
        .select('id, project_id, department_id, year_month, current_version')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !budget) {
        toast.error('Draft not found.');
        router.replace('/budgets/new');
        return;
      }
      const { data: version } = await supabase
        .from('budget_versions')
        .select('id, status, notes, version_number')
        .eq('budget_id', id)
        .eq('version_number', budget.current_version)
        .maybeSingle();
      if (cancelled) return;
      if (!version) {
        toast.error('Draft has no active version.');
        router.replace('/budgets/new');
        return;
      }
      if (version.status !== 'draft') {
        router.replace(`/budgets/${id}`);
        return;
      }
      const { data: itemRows } = await supabase
        .from('budget_items')
        .select('id, description, category, amount_kes')
        .eq('budget_version_id', version.id)
        .order('sort_order');
      if (cancelled) return;

      setBudgetId(id);
      setScopeType(budget.project_id ? 'project' : 'department');
      setScopeId(budget.project_id || budget.department_id || '');
      setYearMonth(budget.year_month);
      setNotes(version.notes || '');
      if (itemRows && itemRows.length > 0) {
        setItems(
          itemRows.map((r) => ({
            id: r.id,
            description: r.description || '',
            category: r.category || '',
            amount_kes: Number(r.amount_kes || 0),
          })),
        );
      }
      setLoadingDraft(false);
    }
    loadDraft();
    return () => {
      cancelled = true;
    };
  }, [idFromUrl, router]);

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

  function validateBeforeSubmit(submitting: boolean): boolean {
    if (!scopeId) {
      toast.error('Please select a project or department');
      return false;
    }
    if (!yearMonth) {
      toast.error('Please select a period');
      return false;
    }
    if (
      items.length === 0 ||
      items.every(
        (i) => !i.description.trim() && (i.amount_kes || 0) === 0,
      )
    ) {
      toast.error('Add at least one line item with a description and amount.');
      return false;
    }
    if (items.some((i) => !i.description.trim())) {
      toast.error('All line items must have a description');
      return false;
    }
    if (items.some((i) => i.amount_kes <= 0)) {
      toast.error('Each line item must have an amount greater than zero.');
      return false;
    }
    if (totalKes <= 0) {
      toast.error('Total budget amount must be greater than zero.');
      return false;
    }
    if (submitting && miscGateBlocked) {
      toast.error(
        'Cannot submit — misc report gate is blocking. See the warning above.',
      );
      return false;
    }
    return true;
  }

  // Diffs the local `items` array against budget_items in DB by row id and
  // applies inserts / updates / deletes individually, then recomputes
  // budget_versions.total_amount_kes. Mirrors the pattern at
  // /budgets/[id]/page.tsx:351–453. After the sync, refreshes local items
  // from DB so freshly-inserted rows pick up their UUID and a subsequent
  // sync diffs cleanly.
  async function syncItemsToDraft(currentBudgetId: string): Promise<void> {
    const supabase = createClient();
    const { data: budget } = await supabase
      .from('budgets')
      .select('current_version')
      .eq('id', currentBudgetId)
      .single();
    if (!budget) throw new Error('Budget no longer exists');
    const { data: version } = await supabase
      .from('budget_versions')
      .select('id')
      .eq('budget_id', currentBudgetId)
      .eq('version_number', budget.current_version)
      .single();
    if (!version) throw new Error('Active version not found');

    type DbItem = {
      id: string;
      description: string | null;
      category: string | null;
      amount_kes: number | string | null;
    };
    const { data: dbItems } = await supabase
      .from('budget_items')
      .select('id, description, category, amount_kes')
      .eq('budget_version_id', version.id);
    const typedDbItems: DbItem[] = (dbItems as DbItem[] | null) || [];
    const dbMap = new Map<string, DbItem>(typedDbItems.map((r) => [r.id, r]));
    const localMap = new Map(items.map((i) => [i.id, i]));

    const toDelete = typedDbItems
      .filter((d) => !localMap.has(d.id))
      .map((d) => d.id);
    if (toDelete.length > 0) {
      await supabase.from('budget_items').delete().in('id', toDelete);
    }

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const existing = dbMap.get(it.id);
      if (!existing) {
        await supabase.from('budget_items').insert({
          budget_version_id: version.id,
          description: it.description,
          category: it.category || null,
          amount_kes: it.amount_kes,
          unit_cost_kes: it.amount_kes,
          quantity: 1,
          sort_order: idx,
        });
      } else {
        const changed =
          (existing.description ?? '') !== it.description ||
          (existing.category ?? '') !== (it.category || '') ||
          Number(existing.amount_kes ?? 0) !== it.amount_kes;
        if (changed) {
          await supabase
            .from('budget_items')
            .update({
              description: it.description,
              category: it.category || null,
              amount_kes: it.amount_kes,
              unit_cost_kes: it.amount_kes,
              sort_order: idx,
            })
            .eq('id', it.id);
        }
      }
    }

    const { data: fresh } = await supabase
      .from('budget_items')
      .select('id, description, category, amount_kes')
      .eq('budget_version_id', version.id)
      .order('sort_order');
    const total = (fresh || []).reduce(
      (s: number, r: { amount_kes: number | string | null }) =>
        s + Number(r.amount_kes ?? 0),
      0,
    );
    await supabase
      .from('budget_versions')
      .update({ total_amount_kes: total })
      .eq('id', version.id);

    setItems(
      (fresh || []).map(
        (r: {
          id: string;
          description: string | null;
          category: string | null;
          amount_kes: number | string | null;
        }) => ({
          id: r.id,
          description: r.description || '',
          category: r.category || '',
          amount_kes: Number(r.amount_kes || 0),
        }),
      ),
    );
  }

  // Persists pending parent + items edits on an existing draft. Returns
  // false on parent-update failure so callers can abort; toasts surface
  // the error to the user.
  async function persistDraftEdits(
    currentBudgetId: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    // Pass force: true to bypass the sibling-collision confirm — at /new
    // the user already saw the existingBudgets warning at first save, so
    // subsequent edits to the same draft are committed without re-prompt.
    const updateRes = await fetch('/api/budgets/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        budget_id: currentBudgetId,
        project_id: scopeType === 'project' ? scopeId : null,
        department_id: scopeType === 'department' ? scopeId : null,
        year_month: yearMonth,
        notes,
        force: true,
      }),
    });
    const updateJson = await updateRes.json();
    if (!updateRes.ok || updateJson?.success === false) {
      toast.error(
        getUserErrorMessage(updateJson?.error, 'Failed to update draft'),
      );
      return false;
    }
    await syncItemsToDraft(currentBudgetId);
    return true;
  }

  async function getAuthHeaders(): Promise<Record<string, string> | null> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error('Session expired. Please log in again.');
      return null;
    }
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function handleSave() {
    if (!validateBeforeSubmit(false)) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;

      if (!budgetId) {
        // First Save → create draft via /api/budgets/create
        const createRes = await fetch('/api/budgets/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
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
            submit: false,
            idempotency_key: idempotencyKey,
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          toast.error(
            getUserErrorMessage(createData?.error, 'Failed to save draft'),
          );
          return;
        }
        toast.success('Draft saved');
        setBudgetId(createData.budget_id);
        router.replace(`/budgets/new?id=${createData.budget_id}`, {
          scroll: false,
        });
        // Sync local item ids with DB UUIDs so the next save diffs cleanly
        await syncItemsToDraft(createData.budget_id);
      } else {
        // Subsequent Save → update parent fields + sync items
        const ok = await persistDraftEdits(budgetId, headers);
        if (ok) toast.success('Draft saved');
      }
    } catch (error) {
      toast.error(
        getUserErrorMessage(error, 'Could not save draft. Please try again.'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!validateBeforeSubmit(true)) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;

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
      const scopeName =
        scopeType === 'project'
          ? projects.find((p) => p.id === scopeId)?.name ?? 'Unknown'
          : departments.find((d) => d.id === scopeId)?.name ?? 'Unknown';

      if (!budgetId) {
        // No saved draft → create + submit in one shot (single-version path)
        const createRes = await fetch('/api/budgets/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
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
            submit: true,
            idempotency_key: idempotencyKey,
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
          toast.error(
            getUserErrorMessage(createData?.error, 'Failed to submit budget'),
          );
          return;
        }
        try {
          await fetch('/api/budgets/accountant-submit-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
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
          // Notifications are best-effort
          console.error('Notification failed:', e);
        }
        const submittedStatus = createData?.status as string | undefined;
        toast.success(
          submittedStatus === 'pm_review'
            ? 'Budget submitted for PM review'
            : 'Budget submitted to CFO queue',
        );
        router.push(`/budgets/${createData.budget_id}`);
      } else {
        // Saved draft → persist pending edits, then resubmit (creates v2)
        const ok = await persistDraftEdits(budgetId, headers);
        if (!ok) return;
        const resRes = await fetch('/api/budgets/resubmit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ budget_id: budgetId }),
        });
        const resJson = await resRes.json();
        if (!resRes.ok) {
          toast.error(
            getUserErrorMessage(resJson?.error, 'Failed to submit budget'),
          );
          return;
        }
        toast.success('Budget submitted for PM review');
        router.push(`/budgets/${budgetId}`);
      }
    } catch (error) {
      toast.error(
        getUserErrorMessage(error, 'Could not submit budget. Please try again.'),
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

  // Validation traffic-light. Red blocks both Save and Submit; amber lets
  // them through (handleSave's per-field toasts catch the rest); green
  // means ready.
  const itemsAreEmpty =
    items.length === 0 ||
    items.every((i) => !i.description.trim() && (i.amount_kes || 0) === 0);
  const validationIssues: string[] = [];
  if (!scopeId) {
    validationIssues.push(
      scopeType === 'project' ? 'Project not selected' : 'Department not selected',
    );
  }
  if (!yearMonth) validationIssues.push('Period not selected');
  if (items.some((i) => !i.description.trim())) {
    validationIssues.push('Some items have no description');
  }
  if (items.some((i) => (i.amount_kes || 0) <= 0)) {
    validationIssues.push('Some items have no amount');
  }
  if (miscGateBlocked) validationIssues.push('Misc report gate is blocking');

  const validationState: 'red' | 'amber' | 'green' = itemsAreEmpty
    ? 'red'
    : validationIssues.length > 0
      ? 'amber'
      : 'green';
  const validationCopy =
    validationState === 'red'
      ? 'Add at least one line item with a description and amount.'
      : validationState === 'amber'
        ? validationIssues.join(' · ')
        : 'Ready to submit.';
  const validationCardClasses =
    validationState === 'red'
      ? 'border-danger/30 bg-danger-soft/40 text-danger-soft-foreground'
      : validationState === 'amber'
        ? 'border-warning/30 bg-warning-soft/40 text-warning-soft-foreground'
        : 'border-success/30 bg-success-soft/40 text-success-soft-foreground';

  const editingDraft = !!budgetId;
  const saveDisabled = saving || validationState === 'red';
  const submitDisabled = saveDisabled || miscGateBlocked;

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
        {editingDraft && !loadingDraft && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-info/40 bg-info-soft/40 px-4 py-2.5 text-sm text-info-soft-foreground">
            <Info className="size-4 shrink-0" strokeWidth={1.75} />
            <span>
              Editing draft. Save updates this draft in place; Submit routes
              it for PM review.
            </span>
          </div>
        )}

        {loadingDraft && (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Loading draft…
          </div>
        )}

        {/* Two-column form layout: 1.6fr / 1fr on desktop, stack on mobile */}
        <div
          className={`grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr] ${loadingDraft ? 'hidden' : ''}`}
        >
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

          {/* Right column — sticky summary panel */}
          <aside>
            <section className="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-20">
              <header className="mb-3">
                <h3 className="font-display text-[17px] font-medium text-foreground">
                  Summary
                </h3>
                <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                  Live as you edit.
                </p>
              </header>

              {/* Approved total */}
              <div className="mt-2">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Approved total
                </div>
                <div className="mt-2 font-mono text-[32px] font-medium leading-none tracking-[-0.01em] tabular-nums text-foreground">
                  <span className="mr-1.5 text-xs text-muted-foreground tracking-[0.04em]">
                    KES
                  </span>
                  {totalKes.toLocaleString('en-KE')}
                </div>
              </div>

              {/* Item count */}
              <div className="mt-5 flex items-baseline justify-between border-t border-border-subtle pt-3">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  Line items
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              {/* Validation card */}
              <div className={`mt-5 rounded-lg border p-3 text-[12.5px] leading-snug ${validationCardClasses}`}>
                <div className="flex items-start gap-2">
                  {validationState === 'green' ? (
                    <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                  )}
                  <span>{validationCopy}</span>
                </div>
              </div>

              {/* Stacked action buttons */}
              <div className="mt-5 flex flex-col gap-2 border-t border-border-subtle pt-5">
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={saveDisabled}
                  className="w-full justify-center gap-1.5"
                >
                  <Save className="size-4" /> Save as draft
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitDisabled}
                  className="w-full justify-center gap-1.5"
                >
                  <Send className="size-4" /> Submit for PM Review
                </Button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
