'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { formatYearMonth } from '@/lib/format';
import { parseBackdatedMeta, type BackdatedMeta } from '@/lib/backdated-utils';

// Matches InvoiceRowData (invoices/page.tsx:27-40) + updated_at.
export type EditableInvoice = {
  id: string;
  invoice_number: string;
  billing_period: string;
  invoice_date: string;
  due_date: string | null;
  description: string | null;
  updated_at: string;
};

interface Props {
  invoice: EditableInvoice | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

// billing_period + 1 month → "MMM YYYY" (lagged-revenue: AGENTS rule 1).
function recognitionMonth(billingPeriod: string): string {
  const match = billingPeriod.match(/^(\d{4})-(\d{2})$/);
  if (!match) return billingPeriod;
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-12
  const nextDate = new Date(year, month, 1); // month index = (month-1) + 1 = month
  return formatYearMonth(
    `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`,
  );
}

// Mirrors §1 server-side helper and invoices/page.tsx:112 strip-regex.
function extractBackdatedPrefix(description: string | null): string | null {
  if (!description) return null;
  const match = description.match(/^\[BACKDATED\]\S*/);
  return match ? match[0] : null;
}

export function InvoiceEditDialog({ invoice, open, onClose, onSaved }: Props) {
  const [billingPeriod, setBillingPeriod] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Loaded once on open; re-attached invisibly on Save (Q4 in §5).
  const backdatedPrefix = useMemo(
    () => extractBackdatedPrefix(invoice?.description ?? null),
    [invoice?.id, invoice?.description],
  );

  // A4 — parsed backdated meta surfaced as read-only strip in the header.
  const backdatedMeta = useMemo<BackdatedMeta | null>(
    () => parseBackdatedMeta(invoice?.description ?? null),
    [invoice?.id, invoice?.description],
  );

  useEffect(() => {
    if (!open || !invoice) return;
    setBillingPeriod(invoice.billing_period || '');
    setInvoiceDate(invoice.invoice_date || '');
    setDueDate(invoice.due_date || '');
    // Hide the [BACKDATED] prefix from the textarea; re-attached on Save.
    const raw = invoice.description || '';
    const visible = backdatedPrefix
      ? raw.slice(backdatedPrefix.length).replace(/^\s+/, '')
      : raw;
    setDescription(visible);
  }, [open, invoice, backdatedPrefix]);

  const billingChanged = !!invoice && billingPeriod !== invoice.billing_period;
  // A5 — Save disabled when description (excl. [BACKDATED] prefix) is empty.
  const descriptionEmpty = description.trim() === '';

  async function handleSave() {
    if (!invoice) return;

    // Re-attach the prefix exactly; keep it even if operator cleared text.
    const trimmed = description.trim();
    const reattachedDescription = backdatedPrefix
      ? (trimmed ? `${backdatedPrefix} ${trimmed}` : backdatedPrefix)
      : trimmed;

    // Build a patch of only-what-changed (matches the route's semantics:
    // undefined → leave alone; null → write NULL).
    const patch: Record<string, unknown> = {};
    if (billingPeriod !== invoice.billing_period) patch.billing_period = billingPeriod;
    if (invoiceDate !== (invoice.invoice_date || '')) patch.invoice_date = invoiceDate || null;
    if (dueDate !== (invoice.due_date || '')) patch.due_date = dueDate || null;
    if (reattachedDescription !== (invoice.description || '')) {
      patch.description = reattachedDescription || null;
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/invoices/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ id: invoice.id, expected_updated_at: invoice.updated_at, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          toast.error('This invoice was modified by someone else. Please reload and try again.');
          onClose();
          return;
        }
        toast.error(json?.error || 'Failed to save invoice.');
        return;
      }
      toast.success('Invoice updated.');
      onSaved();
      onClose();
    } catch {
      toast.error('Failed to save invoice.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit invoice {invoice?.invoice_number ?? ''}
            {backdatedPrefix ? (
              <span className="ml-2 inline-flex rounded-md border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-[11px] font-medium text-yellow-800">Backdated invoice</span>
            ) : null}
          </DialogTitle>
          {backdatedMeta ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Backdated to: {invoice?.billing_period} · entered by {backdatedMeta.entered_by} on {backdatedMeta.entry_date}
            </p>
          ) : null}
        </DialogHeader>

        <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-1">
            <Label>Billing Period (YYYY-MM)</Label>
            <Input value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value)} placeholder="2026-04" />
            {billingChanged && invoice ? (
              <p className="rounded-md border border-yellow-300 bg-yellow-50 px-2 py-1 text-[11px] text-yellow-800">
                Changing the billing period will shift this invoice&apos;s revenue recognition from <strong>{recognitionMonth(invoice.billing_period)}</strong> to <strong>{recognitionMonth(billingPeriod)}</strong>.
              </p>
            ) : null}
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

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            {descriptionEmpty ? (
              <p className="text-[11px] text-destructive">Description is required.</p>
            ) : backdatedPrefix ? (
              <p className="text-[11px] text-muted-foreground">The backdated marker is preserved automatically on save.</p>
            ) : null}
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !invoice || descriptionEmpty}>{saving ? 'Saving...' : 'Save changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
