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
import { formatCurrency } from '@/lib/format';
import { toast } from 'sonner';

interface InvoiceOption {
  id: string;
  invoice_number: string;
  amount_usd: number;
  project_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function PaymentFormDialog({ open, onClose, onSaved }: Props) {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountUsd, setAmountUsd] = useState(0);
  const [amountKes, setAmountKes] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<{ id: string; name: string }[]>([]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    async function load() {
      const supabase = createClient();
      const [invRes, pmRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('id, invoice_number, amount_usd, projects(name)')
          .in('status', ['sent', 'partially_paid', 'overdue'])
          .order('invoice_date', { ascending: false }),
        supabase
          .from('payment_methods')
          .select('id, name')
          .eq('is_active', true)
          .order('name'),
      ]);
      setPaymentMethods((pmRes.data || []) as { id: string; name: string }[]);
      const data = invRes.data;

      setInvoices(
        (data || []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          invoice_number: i.invoice_number as string,
          amount_usd: Number(i.amount_usd),
          project_name: ((i.projects as Record<string, unknown>)?.name as string) || '—',
        }))
      );
    }
    load();
  }, [open]);

  async function handleSave() {
    if (!invoiceId || amountUsd <= 0) {
      toast.error('Invoice and amount are required');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from('payments').insert({
      invoice_id: invoiceId,
      payment_date: paymentDate,
      amount_usd: amountUsd,
      amount_kes: amountKes,
      payment_method: paymentMethod || null,
      reference: reference || null,
      notes: notes || null,
      recorded_by: user!.id,
    });

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Payment recorded');
      onSaved();
      onClose();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Invoice *</Label>
            <Select value={invoiceId} onValueChange={(v) => v && setInvoiceId(v)}>
              <SelectTrigger><SelectValue placeholder="Select invoice..." /></SelectTrigger>
              <SelectContent>
                {invoices.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.invoice_number} — {i.project_name} ({formatCurrency(i.amount_usd, 'USD')})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v)}>
                <SelectTrigger><SelectValue placeholder="Select method..." /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((pm) => (
                    <SelectItem key={pm.id} value={pm.name}>{pm.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Reference</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction ID" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Record Payment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
