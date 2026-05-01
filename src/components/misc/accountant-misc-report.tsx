'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCompactKES, formatCurrency } from '@/lib/format';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

import { cn } from '@/lib/utils';
import {
  MiscStatusPill,
  type MiscStatusKind,
} from '@/app/(dashboard)/misc/_components/MiscStatusPill';

interface ApprovedRequest {
  id: string;
  purpose: string;
  amount_requested: number;
  amount_approved: number;
}

interface ReportItem {
  id?: string;
  description: string;
  amount: number;
  expense_date: string;
  misc_request_id: string;
  receipt_url: string;
  isNew?: boolean;
}

interface MiscReport {
  id: string;
  status: string;
  total_approved: number;
  total_claimed: number;
  variance: number;
}

const REF_GRID = 'grid grid-cols-[1.6fr_140px_140px] items-baseline gap-3';
const ITEM_GRID = 'grid grid-cols-[120px_2fr_140px_1.4fr_44px] items-end gap-2.5';

function statusToKind(status: string): MiscStatusKind {
  if (status === 'cfo_reviewed') return 'reviewed';
  if (status === 'submitted') return 'in-review';
  return 'draft';
}

export function AccountantMiscReport() {
  const { user } = useUser();
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequest[]>([]);
  const [report, setReport] = useState<MiscReport | null>(null);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthLabel = new Intl.DateTimeFormat('en-KE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  }).format(now);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const supabase = createClient();

    const { data: reqs } = await supabase
      .from('accountant_misc_requests')
      .select('id, purpose, amount_requested, amount_approved')
      .eq('period_month', periodMonth)
      .in('status', ['approved', 'reported']);
    setApprovedRequests((reqs || []) as ApprovedRequest[]);

    const { data: rep } = await supabase
      .from('accountant_misc_report')
      .select('*')
      .eq('period_month', periodMonth)
      .single();

    if (rep) {
      setReport(rep as MiscReport);
      const { data: itemData } = await supabase
        .from('accountant_misc_report_items')
        .select('*')
        .eq('accountant_misc_report_id', rep.id)
        .order('expense_date');
      setItems((itemData || []) as ReportItem[]);
    }
  }

  async function createReport() {
    const supabase = createClient();
    const totalApproved = approvedRequests.reduce(
      (s, r) => s + Number(r.amount_approved),
      0,
    );

    const { data, error } = await supabase
      .from('accountant_misc_report')
      .insert({
        period_month: periodMonth,
        submitted_by: user!.id,
        total_approved: totalApproved,
      })
      .select()
      .single();

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      setReport(data as MiscReport);
      toast.success('Misc report created');
    }
  }

  function addItem() {
    setItems([
      ...items,
      {
        description: '',
        amount: 0,
        expense_date: new Date().toISOString().split('T')[0],
        misc_request_id: '',
        receipt_url: '',
        isNew: true,
      },
    ]);
  }

  function updateItem(idx: number, field: string, value: string | number) {
    setItems(items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    const supabase = createClient();

    await supabase
      .from('accountant_misc_report_items')
      .delete()
      .eq('accountant_misc_report_id', report.id);

    const rows = items
      .filter((i) => i.description.trim() && i.amount > 0)
      .map((i) => ({
        accountant_misc_report_id: report.id,
        misc_request_id: i.misc_request_id || null,
        description: i.description,
        amount: i.amount,
        expense_date: i.expense_date,
        receipt_url: i.receipt_url || null,
      }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from('accountant_misc_report_items')
        .insert(rows);
      if (error) {
        toast.error(getUserErrorMessage());
        setSaving(false);
        return;
      }
    }

    toast.success('Report saved');
    setSaving(false);
    load();
  }

  async function handleSubmit() {
    if (!report) return;
    await handleSave();
    const supabase = createClient();
    await supabase
      .from('accountant_misc_report')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', report.id);

    await supabase
      .from('accountant_misc_requests')
      .update({ status: 'reported' })
      .eq('period_month', periodMonth)
      .eq('status', 'approved');

    toast.success('Report submitted for CFO review');
    load();
  }

  const totalClaimed = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalApproved = approvedRequests.reduce(
    (s, r) => s + Number(r.amount_approved),
    0,
  );
  const variance = totalApproved - totalClaimed;
  const isDraft = report?.status === 'draft';

  if (approvedRequests.length === 0) {
    return null; // Hide if no approved requests
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Misc accountability
          <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
          <span className="text-foreground">{monthLabel}</span>
          {report && (
            <>
              <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
              <span className="text-foreground">
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            </>
          )}
        </span>
        {report && <MiscStatusPill kind={statusToKind(report.status)} />}
      </div>

      <div className="space-y-5 px-5 py-5">
        {/* Approved-requests reference */}
        <section>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Approved requests this month
          </div>
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
            <div
              className={cn(
                REF_GRID,
                'border-b border-border-subtle bg-[var(--paper-2)] px-4 py-2.5',
                'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground',
              )}
            >
              <div>Purpose</div>
              <div className="text-right">Requested</div>
              <div className="text-right">Approved</div>
            </div>
            {approvedRequests.map((r) => (
              <div
                key={r.id}
                className={cn(REF_GRID, 'border-b border-border-subtle px-4 py-2 last:border-b-0 text-[12.5px]')}
              >
                <div className="truncate text-foreground">{r.purpose}</div>
                <div className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(r.amount_requested, 'KES')}
                </div>
                <div className="text-right font-mono font-medium tabular-nums text-foreground">
                  {formatCurrency(r.amount_approved, 'KES')}
                </div>
              </div>
            ))}
            <div
              className={cn(
                REF_GRID,
                'border-t border-border-subtle bg-[var(--paper-2)] px-4 py-2.5',
                'font-mono text-[10.5px] uppercase tracking-[0.14em]',
              )}
            >
              <div className="text-muted-foreground">Total approved</div>
              <div />
              <div className="text-right text-[12.5px] tabular-nums text-foreground">
                {formatCurrency(totalApproved, 'KES')}
              </div>
            </div>
          </div>
        </section>

        {/* Create CTA when no report yet */}
        {!report ? (
          <Button onClick={createReport} className="w-full">
            Create misc report for {monthLabel}
          </Button>
        ) : (
          <>
            {/* Itemised entry */}
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Itemised expenditure
                </div>
                {isDraft && (
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={addItem}>
                    <Plus className="size-3" /> Add item
                  </Button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-border bg-[var(--paper-2)]/50 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                  No expenditure items yet. Click &ldquo;Add item&rdquo; to start.
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
                  {/* Column header */}
                  <div
                    className={cn(
                      ITEM_GRID,
                      'border-b border-border-subtle bg-[var(--paper-2)] px-4 py-2.5 items-center',
                      'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground',
                    )}
                  >
                    <div>Date</div>
                    <div>Description</div>
                    <div>Amount (KES)</div>
                    <div>Linked request</div>
                    <div />
                  </div>
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        ITEM_GRID,
                        'border-b border-border-subtle px-4 py-2.5 last:border-b-0 items-center',
                      )}
                    >
                      <div>
                        <Label className="sr-only">Date</Label>
                        <Input
                          type="date"
                          value={item.expense_date}
                          onChange={(e) => updateItem(idx, 'expense_date', e.target.value)}
                          disabled={!isDraft}
                          className="h-8 font-mono text-[12px] tabular-nums"
                        />
                      </div>
                      <div>
                        <Label className="sr-only">Description</Label>
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(idx, 'description', e.target.value)}
                          disabled={!isDraft}
                          placeholder="What was spent"
                          className="h-8 text-[13px]"
                        />
                      </div>
                      <div>
                        <Label className="sr-only">Amount</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.amount || ''}
                          onChange={(e) => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)}
                          disabled={!isDraft}
                          className="h-8 text-right font-mono text-[12.5px] tabular-nums"
                        />
                      </div>
                      <div>
                        <Label className="sr-only">Linked request</Label>
                        <select
                          className={cn(
                            'h-8 w-full rounded-[var(--radius-sm)] border border-border bg-card px-2 text-[12px]',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                          )}
                          value={item.misc_request_id}
                          onChange={(e) => updateItem(idx, 'misc_request_id', e.target.value)}
                          disabled={!isDraft}
                        >
                          <option value="">—</option>
                          {approvedRequests.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.purpose.substring(0, 40)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex justify-end">
                        {isDraft && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => removeItem(idx)}
                            title="Remove item"
                          >
                            <Trash2 className="size-3.5 text-[var(--danger)]" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Footer strip — totals + variance + actions */}
      {report && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--paper-2)] px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.10em]">
            <span>
              <span className="text-muted-foreground">Claimed</span>{' '}
              <span className="text-[12.5px] tabular-nums text-foreground">
                {formatCurrency(totalClaimed, 'KES')}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Variance</span>{' '}
              <span
                className={cn(
                  'text-[12.5px] tabular-nums',
                  variance < 0
                    ? 'text-[var(--danger)]'
                    : variance === 0
                      ? 'text-success-soft-foreground'
                      : 'text-foreground',
                )}
              >
                {formatCompactKES(variance)}
              </span>
            </span>
          </div>
          {isDraft && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                <Save className="size-3.5" /> Save draft
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSubmit}
                disabled={saving}
              >
                <Send className="size-3.5" /> Submit report
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
