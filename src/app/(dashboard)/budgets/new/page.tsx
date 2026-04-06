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
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { Project, Department } from '@/types/database';

interface LineItem {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unit_cost_usd: number;
  unit_cost_kes: number;
  notes: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export default function NewBudgetPage() {
  const { user } = useUser();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [scopeType, setScopeType] = useState<'project' | 'department'>('project');
  const [scopeId, setScopeId] = useState('');
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([
    { id: generateId(), description: '', category: '', quantity: 1, unit_cost_usd: 0, unit_cost_kes: 0, notes: '' },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      if (user?.role === 'team_leader') {
        // Load only assigned projects
        const { data: assignments } = await supabase
          .from('user_project_assignments')
          .select('project_id')
          .eq('user_id', user.id);
        const pids = (assignments || []).map((a) => a.project_id);
        if (pids.length > 0) {
          const { data } = await supabase.from('projects').select('*').in('id', pids).eq('is_active', true);
          setProjects(data || []);
        }
        setScopeType('project');
      } else if (user?.role === 'project_manager') {
        // Load only assigned departments
        const { data: assignments } = await supabase
          .from('user_department_assignments')
          .select('department_id')
          .eq('user_id', user.id);
        const dids = (assignments || []).map((a) => a.department_id);
        if (dids.length > 0) {
          const { data } = await supabase.from('departments').select('*').in('id', dids);
          setDepartments(data || []);
        }
        setScopeType('department');
      } else if (user?.role === 'cfo') {
        const [projRes, deptRes] = await Promise.all([
          supabase.from('projects').select('*').eq('is_active', true).order('name'),
          supabase.from('departments').select('*').order('name'),
        ]);
        setProjects(projRes.data || []);
        setDepartments(deptRes.data || []);
      }
    }
    if (user) load();
  }, [user]);

  function addItem() {
    setItems([...items, { id: generateId(), description: '', category: '', quantity: 1, unit_cost_usd: 0, unit_cost_kes: 0, notes: '' }]);
  }

  function removeItem(id: string) {
    if (items.length <= 1) return;
    setItems(items.filter((i) => i.id !== id));
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  function getItemTotal(item: LineItem) {
    return {
      usd: item.quantity * item.unit_cost_usd,
      kes: item.quantity * item.unit_cost_kes,
    };
  }

  const totalUsd = items.reduce((s, i) => s + i.quantity * i.unit_cost_usd, 0);
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

    setSaving(true);
    const supabase = createClient();

    // Create budget
    const { data: budget, error: budgetError } = await supabase
      .from('budgets')
      .insert({
        project_id: scopeType === 'project' ? scopeId : null,
        department_id: scopeType === 'department' ? scopeId : null,
        year_month: yearMonth,
        current_version: 1,
        created_by: user!.id,
      })
      .select()
      .single();

    if (budgetError) {
      toast.error(budgetError.message);
      setSaving(false);
      return;
    }

    // Create budget version
    const { data: version, error: versionError } = await supabase
      .from('budget_versions')
      .insert({
        budget_id: budget.id,
        version_number: 1,
        status: submit ? 'submitted' : 'draft',
        total_amount_usd: totalUsd,
        total_amount_kes: totalKes,
        submitted_by: submit ? user!.id : null,
        submitted_at: submit ? new Date().toISOString() : null,
        notes,
      })
      .select()
      .single();

    if (versionError) {
      toast.error(versionError.message);
      setSaving(false);
      return;
    }

    // Create budget items
    const itemRows = items.map((item, idx) => ({
      budget_version_id: version.id,
      description: item.description,
      category: item.category || null,
      amount_usd: item.quantity * item.unit_cost_usd,
      amount_kes: item.quantity * item.unit_cost_kes,
      quantity: item.quantity,
      unit_cost_usd: item.unit_cost_usd,
      unit_cost_kes: item.unit_cost_kes,
      notes: item.notes || null,
      sort_order: idx,
    }));

    const { error: itemsError } = await supabase.from('budget_items').insert(itemRows);

    if (itemsError) {
      toast.error(itemsError.message);
      setSaving(false);
      return;
    }

    toast.success(submit ? 'Budget submitted for approval' : 'Budget saved as draft');
    router.push('/budgets');
  }

  return (
    <div>
      <PageHeader title="New Budget" description="Create a new budget submission" />

      <div className="p-6 max-w-4xl space-y-6">
        {/* Scope selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Budget Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(user?.role === 'cfo') && (
                <div className="space-y-1">
                  <Label>Scope Type</Label>
                  <Select value={scopeType} onValueChange={(v) => { if (v) { setScopeType(v as 'project' | 'department'); setScopeId(''); } }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">Project</SelectItem>
                      <SelectItem value="department">Department</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1">
                <Label>{scopeType === 'project' ? 'Project' : 'Department'}</Label>
                <Select value={scopeId} onValueChange={(v) => v && setScopeId(v)}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
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
                  <span className="text-xs font-medium text-neutral-400">Item {idx + 1}</span>
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
                    <Input
                      value={item.category}
                      onChange={(e) => updateItem(item.id, 'category', e.target.value)}
                      placeholder="e.g. Personnel"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
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
                    <Label className="text-xs">Unit Cost (USD)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.unit_cost_usd || ''}
                      onChange={(e) => updateItem(item.id, 'unit_cost_usd', parseFloat(e.target.value) || 0)}
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

                <div className="flex justify-end gap-4 text-xs text-neutral-500">
                  <span>Subtotal: {formatCurrency(getItemTotal(item).usd, 'USD')}</span>
                  <span>{formatCurrency(getItemTotal(item).kes, 'KES')}</span>
                </div>
              </div>
            ))}

            <Separator />

            <div className="flex justify-end gap-6 text-sm font-semibold">
              <span>Total: {formatCurrency(totalUsd, 'USD')}</span>
              <span>{formatCurrency(totalKes, 'KES')}</span>
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
          <Button onClick={() => handleSave(true)} disabled={saving} className="gap-1">
            <Send className="h-4 w-4" /> Submit for Approval
          </Button>
        </div>
      </div>
    </div>
  );
}
