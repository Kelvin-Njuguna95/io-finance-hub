'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentYearMonth } from '@/lib/format';
import { toast } from 'sonner';
import type { Project, ExpenseType } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import { getActiveProjects } from '@/lib/queries/projects';

interface ExpenseFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface ApprovedBudget {
  budget_id: string;
  budget_version_id: string;
  scope_name: string;
  project_id: string | null;
  department_id: string | null;
}

export function ExpenseFormDialog({ open, onClose, onSaved }: ExpenseFormDialogProps) {
  const { user } = useUser();
  const [budgets, setBudgets] = useState<ApprovedBudget[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [overheadCategories, setOverheadCategories] = useState<{ id: string; name: string }[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<{ id: string; name: string }[]>([]);

  const [expenseType, setExpenseType] = useState<ExpenseType>('project_expense');
  const [selectedBudgetIdx, setSelectedBudgetIdx] = useState('');
  const [projectId, setProjectId] = useState('');
  const [overheadCategoryId, setOverheadCategoryId] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amountUsd, setAmountUsd] = useState(0);
  const [amountKes, setAmountKes] = useState(0);
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);
  const [vendor, setVendor] = useState('');
  const [receiptRef, setReceiptRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const yearMonth = getCurrentYearMonth();

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();

      // Get approved budgets for current month
      const { data: budgetData } = await supabase
        .from('budgets')
        .select(`
          id, project_id, department_id,
          projects(name), departments(name),
          budget_versions!inner(id, status)
        `)
        .eq('year_month', yearMonth)
        .eq('budget_versions.status', 'approved');

      const approvedBudgets: ApprovedBudget[] = (budgetData || []).map((b: Record<string, unknown>) => ({
        budget_id: b.id as string,
        budget_version_id: ((b.budget_versions as Record<string, unknown>[])?.[0]?.id as string) || '',
        scope_name: ((b.projects as Record<string, unknown>)?.name as string) ||
                    ((b.departments as Record<string, unknown>)?.name as string) || '—',
        project_id: b.project_id as string | null,
        department_id: b.department_id as string | null,
      }));
      setBudgets(approvedBudgets);

      const [projRes, ohRes, ecRes] = await Promise.all([
        getActiveProjects(supabase),
        supabase.from('overhead_categories').select('id, name').eq('is_active', true).order('name'),
        supabase.from('expense_categories').select('id, name').eq('is_active', true).order('name'),
      ]);
      setProjects((projRes.data || []) as Project[]);
      setOverheadCategories((ohRes.data || []) as { id: string; name: string }[]);
      setExpenseCategories((ecRes.data || []) as { id: string; name: string }[]);
    }
    load();
  }, [open, yearMonth]);

  function reset() {
    setExpenseType('project_expense');
    setSelectedBudgetIdx('');
    setProjectId('');
    setOverheadCategoryId('');
    setExpenseCategoryId('');
    setDescription('');
    setAmountUsd(0);
    setAmountKes(0);
    setExpenseDate(new Date().toISOString().split('T')[0]);
    setVendor('');
    setReceiptRef('');
    setNotes('');
  }

  async function handleSave() {
    if (!description.trim()) { toast.error('Description is required'); return; }
    if (!selectedBudgetIdx) { toast.error('Please select a budget'); return; }

    const budget = budgets[Number(selectedBudgetIdx)];
    if (!budget) { toast.error('Invalid budget selection'); return; }

    if (expenseType === 'project_expense' && !projectId) {
      toast.error('Project is required for project expenses');
      return;
    }
    if (expenseType === 'shared_expense' && !overheadCategoryId) {
      toast.error('Overhead category is required for shared expenses');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from('expenses').insert({
      budget_id: budget.budget_id,
      budget_version_id: budget.budget_version_id,
      expense_type: expenseType,
      project_id: expenseType === 'project_expense' ? projectId : null,
      overhead_category_id: expenseType === 'shared_expense' ? overheadCategoryId : null,
      expense_category_id: expenseCategoryId || null,
      description,
      amount_usd: 0,
      amount_kes: amountKes,
      expense_date: expenseDate,
      year_month: yearMonth,
      vendor: vendor || null,
      receipt_reference: receiptRef || null,
      notes: notes || null,
      entered_by: user!.id,
    });

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Expense recorded');
      reset();
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Expense Type</Label>
            <Select value={expenseType} onValueChange={(v) => v && setExpenseType(v as ExpenseType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project_expense">Project Expense</SelectItem>
                <SelectItem value="shared_expense">Shared Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Approved Budget *</Label>
            <Select value={selectedBudgetIdx} onValueChange={(v) => v && setSelectedBudgetIdx(v)}>
              <SelectTrigger><SelectValue placeholder="Select budget..." /></SelectTrigger>
              <SelectContent>
                {budgets.map((b, idx) => (
                  <SelectItem key={b.budget_id} value={String(idx)}>
                    {b.scope_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {budgets.length === 0 && (
              <p className="text-xs text-red-500 mt-1">No approved budgets for {yearMonth}</p>
            )}
          </div>

          {expenseType === 'project_expense' && (
            <div className="space-y-1">
              <Label>Project *</Label>
              <Select value={projectId} onValueChange={(v) => v && setProjectId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project...">
                    {projects.find((project) => project.id === projectId)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {expenseType === 'shared_expense' && (
            <div className="space-y-1">
              <Label>Overhead Category *</Label>
              <Select value={overheadCategoryId} onValueChange={(v) => v && setOverheadCategoryId(v)}>
                <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                <SelectContent>
                  {overheadCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Expense Category</Label>
            <Select value={expenseCategoryId} onValueChange={(v) => v && setExpenseCategoryId(v)}>
              <SelectTrigger><SelectValue placeholder="Optional..." /></SelectTrigger>
              <SelectContent>
                {expenseCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Description *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was this expense for?" />
          </div>

          <div className="space-y-1">
            <Label>Amount (KES) *</Label>
            <Input type="number" step="0.01" min={0} value={amountKes || ''} onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)} />
          </div>

          <div className="space-y-1">
            <Label>Expense Date</Label>
            <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Vendor</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label>Receipt Ref</Label>
              <Input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
