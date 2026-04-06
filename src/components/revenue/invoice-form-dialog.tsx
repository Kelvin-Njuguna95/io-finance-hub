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
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { toast } from 'sonner';
import type { Project } from '@/types/database';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function InvoiceFormDialog({ open, onClose, onSaved }: Props) {
  const { user } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [billingPeriod, setBillingPeriod] = useState(getCurrentYearMonth());
  const [amountUsd, setAmountUsd] = useState(0);
  const [amountKes, setAmountKes] = useState(0);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('projects').select('*').eq('is_active', true).order('name');
      setProjects((data || []) as Project[]);
    }
    load();
  }, [open]);

  async function handleSave() {
    if (!projectId || !invoiceNumber.trim() || amountUsd <= 0) {
      toast.error('Project, invoice number, and amount are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from('invoices').insert({
      project_id: projectId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      billing_period: billingPeriod,
      amount_usd: amountUsd,
      amount_kes: amountKes,
      status: 'sent',
      description: description || null,
      created_by: user!.id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Invoice created');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Project *</Label>
            <Select value={projectId} onValueChange={(v) => v && setProjectId(v)}>
              <SelectTrigger><SelectValue placeholder="Select project..." /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Invoice Number *</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-001" />
            </div>
            <div className="space-y-1">
              <Label>Billing Period</Label>
              <Select value={billingPeriod} onValueChange={(v) => v && setBillingPeriod(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 6 }, (_, i) => {
                    const d = new Date(); d.setMonth(d.getMonth() - i);
                    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount (USD) *</Label>
              <Input type="number" step="0.0001" min={0} value={amountUsd || ''} onChange={(e) => setAmountUsd(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" step="0.01" min={0} value={amountKes || ''} onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Create Invoice'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
