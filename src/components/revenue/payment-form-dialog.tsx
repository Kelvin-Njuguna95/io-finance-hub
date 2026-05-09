'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
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
import { getUserErrorMessage } from '@/lib/errors';
import { isIdempotencyConflict } from '@/lib/idempotency';
import { fireDuplicateBlocked } from '@/lib/audit-duplicate-blocked';

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
  const [idempotencyKey, regenerateIdempotencyKey] = useIdempotencyKey();

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
      idempotency_key: idempotencyKey,
    });

    if (error && !isIdempotencyConflict(error)) {
      toast.error(getUserErrorMessage());
    } else {
      if (error && isIdempotencyConflict(error)) {
        // IDEMP-4..IDEMP-10: fire telemetry server-side; client can't
        // write audit_logs through RLS. Fire-and-forget.
        void fireDuplicateBlocked('payments', idempotencyKey);
        // Don't re-run the parent invoice recompute on the conflict
        // path — the original successful attempt was responsible for
        // it (or, in pre-fix historical data, didn't run it; that's
        // what the one-shot SQL backfill handles, not retry-time
        // recovery from this dialog).
      } else {
        // Fresh INSERT succeeded → propagate to the parent invoice's
        // denormalised fields. Without this, the invoice stays at
        // 'sent' / 'overdue' even when fully paid, and the dashboard's
        // Pending Invoices rail keeps showing it as outstanding (the
        // bug fixed by this commit). Mirrors the recompute in
        // revenue/page.tsx:359-371. Best-effort: a failed UPDATE is
        // logged but does not block the success toast — the payment
        // IS recorded. The structural fix (a DB trigger that owns this
        // recompute end-to-end) is tracked separately.
        try {
          const { data: invoice } = await supabase
            .from('invoices')
            .select('amount_usd, total_paid')
            .eq('id', invoiceId)
            .single();
          if (invoice) {
            const currentTotalPaid = Number(invoice.total_paid ?? 0);
            const nextTotalPaid = currentTotalPaid + amountUsd;
            const remainingOutstanding = Math.max(
              0,
              Number(invoice.amount_usd ?? 0) - nextTotalPaid,
            );
            const nextStatus =
              remainingOutstanding <= 0 ? 'paid' : 'partially_paid';
            await supabase
              .from('invoices')
              .update({
                total_paid: nextTotalPaid,
                balance_outstanding: remainingOutstanding,
                payment_status: nextStatus,
                status: nextStatus,
              })
              .eq('id', invoiceId);
          }
        } catch (updateErr) {
          console.error(
            '[payment-form-dialog] parent invoice denormalisation failed',
            updateErr,
          );
        }
      }
      // Either fresh insert succeeded, or a prior attempt with the same
      // key already created the row — same outcome from the user's view.
      toast.success('Payment recorded');
      regenerateIdempotencyKey();
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
