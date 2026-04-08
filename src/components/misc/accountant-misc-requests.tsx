'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

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

function isPendingDeletion(r: MiscRequest): boolean {
  return (r.cfo_notes || '').includes(DELETION_MARKER);
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

  useEffect(() => { load(); }, []);

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
      toast.error(error.message);
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
    // Add deletion marker to cfo_notes — preserve previous status info for restore
    const prevNotes = deleteTarget.cfo_notes || '';
    const meta = `${DELETION_MARKER}[prev:${deleteTarget.status}]`;
    const newNotes = prevNotes ? `${meta} ${prevNotes}` : meta;

    const { error } = await supabase.from('accountant_misc_requests').update({
      cfo_notes: newNotes,
    }).eq('id', deleteTarget.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Deletion requested — awaiting CFO confirmation');
      setDeleteTarget(null);
      load();
    }
    setDeleting(false);
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-green-100 text-green-700',
    declined: 'bg-red-100 text-red-700',
    reported: 'bg-blue-100 text-blue-700',
  };

  const totalApproved = requests
    .filter(r => (r.status === 'approved' || r.status === 'reported') && !isPendingDeletion(r))
    .reduce((s, r) => s + Number(r.amount_approved || 0), 0);

  // Clean display of cfo_notes (strip deletion metadata)
  function cleanNotes(notes: string | null): string {
    if (!notes) return '—';
    return notes.replace(/\[PENDING_DELETE\]/g, '').replace(/\[prev:\w+\]/g, '').trim() || '—';
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Misc Fund Requests</CardTitle>
          <Button size="sm" className="gap-1" onClick={() => setShowForm(true)}>
            <Plus className="h-3 w-3" /> New Request
          </Button>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-neutral-500 py-4 text-center">No misc requests this month</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead>CFO Notes</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => {
                    const pendingDelete = isPendingDeletion(r);
                    return (
                      <TableRow key={r.id} className={pendingDelete ? 'bg-rose-50/50' : ''}>
                        <TableCell>
                          {pendingDelete ? (
                            <Badge variant="secondary" className="bg-rose-100 text-rose-700">
                              Pending Delete
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className={statusColors[r.status]}>
                              {r.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{r.purpose}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.amount_requested, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.amount_approved ? formatCurrency(r.amount_approved, 'KES') : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-neutral-500">{cleanNotes(r.cfo_notes)}</TableCell>
                        <TableCell>
                          {pendingDelete ? (
                            <span className="text-xs text-rose-500">Awaiting CFO</span>
                          ) : r.status !== 'reported' ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setDeleteTarget(r)}
                              title="Request deletion"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {totalApproved > 0 && (
                <div className="mt-2 text-sm text-right">
                  Total approved this month: <strong>{formatCurrency(totalApproved, 'KES')}</strong>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600">
            Are you sure you want to request deletion of this misc request?
          </p>
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <p><strong>Purpose:</strong> {deleteTarget?.purpose}</p>
            <p><strong>Amount:</strong> {formatCurrency(deleteTarget?.amount_requested || 0, 'KES')}</p>
            <p><strong>Status:</strong> {deleteTarget?.status}</p>
          </div>
          <p className="text-xs text-amber-600">
            This will send a deletion request to the CFO for final confirmation.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRequestDelete} disabled={deleting}>
              {deleting ? 'Requesting...' : 'Request Deletion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Misc Funds</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Purpose *</Label>
              <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What is this money needed for?" rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Amount (KES) *</Label>
              <Input type="number" step="0.01" min={0} value={amount || ''} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Submitting...' : 'Submit Request'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
