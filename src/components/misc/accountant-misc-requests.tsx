'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { formatCompactKES, formatCurrency } from '@/lib/format';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

import { cn } from '@/lib/utils';

const DELETION_MARKER = '[PENDING_DELETE]';

interface MiscRequest {
  id: string;
  purpose: string;
  amount_requested: number;
  amount_approved: number | null;
  status: string;
  cfo_notes: string | null;
  created_at: string;
}

const ROW_GRID = 'grid grid-cols-[130px_1.6fr_120px_120px_50px] items-start gap-4';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-warning-soft text-warning-soft-foreground',
  approved: 'bg-success-soft text-success-soft-foreground',
  declined: 'bg-danger-soft text-danger-soft-foreground',
  reported: 'bg-info-soft text-info-soft-foreground',
};

function isPendingDeletion(r: MiscRequest): boolean {
  return (r.cfo_notes || '').includes(DELETION_MARKER);
}

function cleanNotes(notes: string | null): string {
  if (!notes) return '';
  return notes
    .replace(/\[PENDING_DELETE\]/g, '')
    .replace(/\[prev:\w+\]/g, '')
    .trim();
}

export function AccountantMiscRequests() {
  const { user } = useUser();
  const [requests, setRequests] = useState<MiscRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MiscRequest | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const supabase = createClient();
    const now = new Date();
    const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { data } = await supabase
      .from('accountant_misc_requests')
      .select('*')
      .eq('period_month', periodMonth)
      .order('created_at', { ascending: false });
    setRequests((data || []) as MiscRequest[]);
  }

  async function handleSubmit() {
    if (!purpose.trim() || amount <= 0) {
      toast.error('Purpose and amount are required');
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const now = new Date();
    const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { error } = await supabase.from('accountant_misc_requests').insert({
      requested_by: user!.id,
      period_month: periodMonth,
      purpose,
      amount_requested: amount,
    });

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Misc request submitted to CFO');
      setPurpose('');
      setAmount(0);
      setShowForm(false);
      load();
    }
    setSaving(false);
  }

  async function handleRequestDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const supabase = createClient();
    const prevNotes = deleteTarget.cfo_notes || '';
    const meta = `${DELETION_MARKER}[prev:${deleteTarget.status}]`;
    const newNotes = prevNotes ? `${meta} ${prevNotes}` : meta;

    const { error } = await supabase
      .from('accountant_misc_requests')
      .update({ cfo_notes: newNotes })
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Deletion requested — awaiting CFO confirmation');
      setDeleteTarget(null);
      load();
    }
    setDeleting(false);
  }

  const totalApproved = requests
    .filter((r) => (r.status === 'approved' || r.status === 'reported') && !isPendingDeletion(r))
    .reduce((s, r) => s + Number(r.amount_approved || 0), 0);

  const totalRequested = requests
    .filter((r) => !isPendingDeletion(r))
    .reduce((s, r) => s + Number(r.amount_requested || 0), 0);

  return (
    <>
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        {/* Header strip */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Misc fund requests
            {requests.length > 0 && (
              <>
                <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
                <span className="text-foreground">
                  {requests.length} this month
                </span>
                {totalRequested > 0 && (
                  <>
                    <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
                    <span className="text-foreground">
                      {formatCompactKES(totalRequested)} requested
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          <Button size="sm" className="gap-1" onClick={() => setShowForm(true)}>
            <Plus className="size-3.5" /> New request
          </Button>
        </div>

        {requests.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No misc requests this month.
          </div>
        ) : (
          <>
            {/* Column header row */}
            <div
              className={cn(
                ROW_GRID,
                'border-b border-border-subtle bg-[var(--paper-2)]/40 px-5 py-2.5',
                'font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground',
              )}
            >
              <div>Status</div>
              <div>Purpose · CFO notes</div>
              <div className="text-right">Requested</div>
              <div className="text-right">Approved</div>
              <div />
            </div>

            {/* Rows */}
            {requests.map((r) => {
              const pendingDelete = isPendingDeletion(r);
              const tone = pendingDelete
                ? 'bg-danger-soft text-danger-soft-foreground'
                : STATUS_TONE[r.status] || 'bg-[var(--paper-3)] text-foreground';
              const label = pendingDelete ? 'Pending delete' : r.status;
              const note = cleanNotes(r.cfo_notes);
              return (
                <div
                  key={r.id}
                  className={cn(
                    ROW_GRID,
                    'border-b border-border-subtle px-5 py-3.5 last:border-b-0',
                    pendingDelete && 'bg-danger-soft/30',
                  )}
                >
                  {/* Status pill */}
                  <div>
                    <span
                      className={cn(
                        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em]',
                        tone,
                      )}
                    >
                      {label}
                    </span>
                  </div>

                  {/* Purpose + CFO notes sub */}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {r.purpose}
                    </div>
                    {note && (
                      <p className="mt-0.5 line-clamp-2 text-[11.5px] text-muted-foreground">
                        {note}
                      </p>
                    )}
                  </div>

                  {/* Requested */}
                  <div className="text-right font-mono text-[12.5px] tabular-nums text-foreground">
                    {formatCurrency(r.amount_requested, 'KES')}
                  </div>

                  {/* Approved */}
                  <div className="text-right font-mono text-[12.5px] tabular-nums">
                    {r.amount_approved ? (
                      <span className="text-success-soft-foreground">
                        {formatCurrency(r.amount_approved, 'KES')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Action */}
                  <div className="flex justify-end">
                    {pendingDelete ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.10em] text-[var(--danger)]">
                        Awaiting CFO
                      </span>
                    ) : r.status !== 'reported' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setDeleteTarget(r)}
                        title="Request deletion"
                      >
                        <Trash2 className="size-3.5 text-[var(--danger)]" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {/* Footer total strip */}
            {totalApproved > 0 && (
              <div className="flex items-baseline justify-between border-t border-border bg-[var(--paper-2)] px-5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.10em]">
                <span className="text-muted-foreground">Total approved this month</span>
                <span className="text-[12.5px] tabular-nums text-foreground">
                  {formatCurrency(totalApproved, 'KES')}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* New-request dialog — preserved */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Misc Funds</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Purpose *</Label>
              <Textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="What is this money needed for?"
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label>Amount (KES) *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={amount || ''}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="font-mono tabular-nums"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog — preserved */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/80">
            Are you sure you want to request deletion of this misc request?
          </p>
          <div className="space-y-1 rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] p-3 text-sm">
            <p>
              <strong>Purpose:</strong> {deleteTarget?.purpose}
            </p>
            <p>
              <strong>Amount:</strong>{' '}
              {formatCurrency(deleteTarget?.amount_requested || 0, 'KES')}
            </p>
            <p>
              <strong>Status:</strong> {deleteTarget?.status}
            </p>
          </div>
          <p className="text-xs text-warning-soft-foreground">
            This will send a deletion request to the CFO for final confirmation.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRequestDelete} disabled={deleting}>
              {deleting ? 'Requesting...' : 'Request Deletion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
