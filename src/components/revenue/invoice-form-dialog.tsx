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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { encodeBackdatedNotes, type BackdatedMeta } from '@/lib/backdated-utils';
import { toast } from 'sonner';
import type { Project } from '@/types/database';
import { getUserErrorMessage } from '@/lib/errors';
import { getActiveProjects } from '@/lib/queries/projects';
import { INVOICE_STATUS } from '@/lib/constants/status';

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
  const [isBackdated, setIsBackdated] = useState(false);
  const [backdatedReason, setBackdatedReason] = useState('');
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setProjectId('');
    setInvoiceNumber('');
    setInvoiceDate(new Date().toISOString().split('T')[0]);
    setDueDate('');
    setBillingPeriod(getCurrentYearMonth());
    setAmountUsd(0);
    setAmountKes(0);
    setDescription('');
    setIsBackdated(false);
    setBackdatedReason('');
  }

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const { data } = await getActiveProjects(supabase);
      setProjects((data || []) as Project[]);
    }
    load();
  }, [open]);

  async function handleSave() {
    if (!projectId || !invoiceNumber.trim() || amountUsd <= 0) {
      toast.error('Project, invoice number, and amount are required');
      return;
    }

    if (isBackdated && !backdatedReason.trim()) {
      toast.error('Reason for late entry is required for backdated invoices');
      return;
    }
    if (dueDate && invoiceDate && new Date(dueDate) < new Date(invoiceDate)) {
      toast.error('Due date cannot be earlier than invoice date');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    let finalDescription: string | null = description || null;
    if (isBackdated) {
      const meta: BackdatedMeta = {
        reason: backdatedReason.trim(),
        entry_date: new Date().toISOString().split('T')[0],
        entered_by: user!.full_name || user!.email,
      };
      finalDescription = encodeBackdatedNotes(meta, description || undefined);
    }

    const { error } = await supabase.from('invoices').insert({
      project_id: projectId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      billing_period: billingPeriod,
      amount_usd: amountUsd,
      amount_kes: amountKes,
      status: INVOICE_STATUS.SENT,
      description: finalDescription,
      created_by: user!.id,
    });

    if (error) {
      toast.error(getUserErrorMessage(error, 'Failed to create invoice. Please review the form and try again.'));
    } else {
      toast.success('Invoice created');
      resetForm();
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isBackdated ? 'New Backdated Invoice' : 'New Invoice'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="backdated-toggle" className="text-sm font-medium">Backdated Invoice</Label>
            <Switch id="backdated-toggle" checked={isBackdated} onCheckedChange={setIsBackdated} />
          </div>

          {isBackdated && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              This is for invoices from prior periods being entered late. A reason for the late entry is required.
            </div>
          )}

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
                  {Array.from({ length: isBackdated ? 12 : 6 }, (_, i) => {
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
              <p className="text-xs text-muted-foreground">Select the invoice issue date for this billing record.</p>
            </div>
            <div className="space-y-1">
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Choose the expected payment due date.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount (USD) *</Label>
              <Input type="number" step="0.0001" min={0} value={amountUsd || ''} onChange={(e) => setAmountUsd(parseFloat(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground">Enter amount in USD using numbers only.</p>
            </div>
            <div className="space-y-1">
              <Label>Amount (KES)</Label>
              <Input type="number" step="0.01" min={0} value={amountKes || ''} onChange={(e) => setAmountKes(parseFloat(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground">Optional KES equivalent for local reconciliation.</p>
            </div>
          </div>

          {isBackdated && (
            <div className="space-y-1">
              <Label>Reason for Late Entry *</Label>
              <Textarea
                value={backdatedReason}
                onChange={(e) => setBackdatedReason(e.target.value)}
                rows={2}
                placeholder="Explain why this invoice is being entered late..."
              />
            </div>
          )}

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
