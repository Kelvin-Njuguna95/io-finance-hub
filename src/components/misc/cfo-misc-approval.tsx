'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatDate } from '@/lib/format';
import { Check, X, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

const DELETION_MARKER = '[PENDING_DELETE]';

interface MiscRequest {
  id: string;
  purpose: string;
  amount_requested: number;
  amount_approved: number | null;
  status: string;
  cfo_notes: string | null;
  created_at: string;
  requested_by: string;
  sender_name?: string;
}

interface MiscReport {
  id: string;
  period_month: string;
  status: string;
  total_approved: number;
  total_claimed: number;
  variance: number;
  sender_name?: string;
}

function isPendingDeletion(r: MiscRequest): boolean {
  return (r.cfo_notes || '').includes(DELETION_MARKER);
}

function cleanNotes(notes: string | null): string {
  if (!notes) return '';
  return notes.replace(/\[PENDING_DELETE\]/g, '').replace(/\[prev:\w+\]/g, '').trim();
}

function getPreviousStatus(notes: string | null): string {
  const match = (notes || '').match(/\[prev:(\w+)\]/);
  return match ? match[1] : 'pending';
}

export function CfoMiscApproval() {
  const { user } = useUser();
  const [pendingRequests, setPendingRequests] = useState<MiscRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<MiscRequest[]>([]);
  const [reports, setReports] = useState<MiscReport[]>([]);
  const [approveReq, setApproveReq] = useState<MiscRequest | null>(null);
  const [declineReq, setDeclineReq] = useState<MiscRequest | null>(null);
  const [approveAmount, setApproveAmount] = useState(0);
  const [approveNotes, setApproveNotes] = useState('');
  const [declineNotes, setDeclineNotes] = useState('');
  const [reviewReport, setReviewReport] = useState<MiscReport | null>(null);
  const [reviewItems, setReviewItems] = useState</* // */ any[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<MiscRequest | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const supabase = createClient();

    // All non-reported requests (we'll separate pending vs deletion-pending in JS)
    const { data: allReqs } = await supabase
      .from('accountant_misc_requests')
      .select('*, users!accountant_misc_requests_requested_by_fkey(full_name)')
      .order('created_at', { ascending: false });

    const all = (allReqs || []).map((r: /* // */ any) => ({
      ...r, sender_name: r.users?.full_name || '—',
    })) as MiscRequest[];

    // Separate: pending approval requests vs deletion requests
    setPendingRequests(all.filter(r => r.status === 'pending' && !isPendingDeletion(r)));
    setDeletionRequests(all.filter(r => isPendingDeletion(r)));

    // Reports
    const { data: reps } = await supabase
      .from('accountant_misc_report')
      .select('*, users!accountant_misc_report_submitted_by_fkey(full_name)')
      .in('status', ['submitted', 'cfo_reviewed'])
      .order('period_month', { ascending: false })
      .limit(12);

    setReports((reps || []).map((r: /* // */ any) => ({
      ...r, sender_name: r.users?.full_name || '—',
    })));
  }

  async function handleApprove() {
    if (!approveReq || approveAmount <= 0) return;
    const supabase = createClient();
    await supabase.from('accountant_misc_requests').update({
      status: 'approved',
      amount_approved: approveAmount,
      cfo_decision_by: user!.id,
      cfo_decision_at: new Date().toISOString(),
      cfo_notes: approveNotes || null,
    }).eq('id', approveReq.id);
    toast.success('Request approved');
    setApproveReq(null);
    setApproveNotes('');
    load();
  }

  async function handleDecline() {
    if (!declineReq || !declineNotes.trim()) return;
    const supabase = createClient();
    await supabase.from('accountant_misc_requests').update({
      status: 'declined',
      cfo_decision_by: user!.id,
      cfo_decision_at: new Date().toISOString(),
      cfo_notes: declineNotes,
    }).eq('id', declineReq.id);
    toast.success('Request declined');
    setDeclineReq(null);
    setDeclineNotes('');
    load();
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    const supabase = createClient();
    const { error } = await supabase.from('accountant_misc_requests').delete().eq('id', confirmDelete.id);
    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Misc request permanently deleted');
      setConfirmDelete(null);
      load();
    }
  }

  async function handleRejectDelete(reqId: string) {
    const supabase = createClient();
    const req = deletionRequests.find(r => r.id === reqId);
    // Restore to the previous status
    const restoreStatus = getPreviousStatus(req?.cfo_notes || null);
    const restoredNotes = cleanNotes(req?.cfo_notes || null);

    await supabase.from('accountant_misc_requests').update({
      status: restoreStatus,
      cfo_notes: restoredNotes || null,
    }).eq('id', reqId);
    toast.success('Deletion rejected — request restored');
    load();
  }

  async function openReview(report: MiscReport) {
    setReviewReport(report);
    const supabase = createClient();
    const { data } = await supabase
      .from('accountant_misc_report_items')
      .select('*')
      .eq('accountant_misc_report_id', report.id)
      .order('expense_date');
    setReviewItems(data || []);
  }

  async function markReviewed() {
    if (!reviewReport) return;
    const supabase = createClient();
    await supabase.from('accountant_misc_report').update({
      status: 'cfo_reviewed',
      cfo_reviewed_by: user!.id,
      cfo_reviewed_at: new Date().toISOString(),
    }).eq('id', reviewReport.id);
    toast.success('Report marked as reviewed');
    setReviewReport(null);
    load();
  }

  async function toggleFlag(itemId: string, flagged: boolean, reason?: string) {
    const supabase = createClient();
    await supabase.from('accountant_misc_report_items').update({
      flagged, flag_reason: reason || null,
    }).eq('id', itemId);
    if (reviewReport) openReview(reviewReport);
  }

  return (
    <>
      {/* Pending Deletion Requests — shown prominently */}
      {deletionRequests.length > 0 && (
        <Card className="border-danger/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-danger-soft-foreground">
              Misc Requests — Pending Deletion ({deletionRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Previous Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deletionRequests.map((r) => (
                  <TableRow key={r.id} className="bg-danger-soft/50">
                    <TableCell className="font-medium">{r.purpose}</TableCell>
                    <TableCell className="text-sm">{r.sender_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-muted text-foreground/80">
                        was: {getPreviousStatus(r.cfo_notes)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.amount_requested, 'KES')}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.amount_approved ? formatCurrency(r.amount_approved, 'KES') : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => setConfirmDelete(r)}
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => handleRejectDelete(r.id)}
                        >
                          <Undo2 className="h-3 w-3" /> Restore
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pending Misc Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Misc Fund Requests (Pending)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.purpose}</TableCell>
                    <TableCell className="text-sm">{r.sender_name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.amount_requested, 'KES')}</TableCell>
                    <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setApproveReq(r); setApproveAmount(r.amount_requested); }} title="Approve">
                          <Check className="h-4 w-4 text-success-soft-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeclineReq(r)} title="Decline">
                          <X className="h-4 w-4 text-danger-soft-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Accountant Misc Reports */}
      {reports.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Accountant Misc Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Claimed</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.period_month}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.total_approved, 'KES')}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.total_claimed, 'KES')}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${Number(r.variance) < 0 ? 'text-danger-soft-foreground' : ''}`}>
                      {formatCurrency(Number(r.variance), 'KES')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={
                        r.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-success-soft text-success-soft-foreground'
                      }>{r.status === 'cfo_reviewed' ? 'Reviewed' : r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openReview(r)}>Review</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Confirm Deletion Dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Permanent Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/80">
            The accountant has requested deletion of this misc request. This action is permanent and cannot be undone.
          </p>
          <div className="bg-danger-soft/50 border border-danger/30 rounded-lg p-3 text-sm space-y-1">
            <p><strong>Purpose:</strong> {confirmDelete?.purpose}</p>
            <p><strong>Requested:</strong> {formatCurrency(confirmDelete?.amount_requested || 0, 'KES')}</p>
            {confirmDelete?.amount_approved && (
              <p><strong>Approved:</strong> {formatCurrency(confirmDelete.amount_approved, 'KES')}</p>
            )}
            <p><strong>Requested by:</strong> {confirmDelete?.sender_name}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={!!approveReq} onOpenChange={() => setApproveReq(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Misc Request</DialogTitle></DialogHeader>
          <p className="text-sm text-foreground/80 mb-2">{approveReq?.purpose}</p>
          <p className="text-sm mb-4">Requested: <strong>{formatCurrency(approveReq?.amount_requested || 0, 'KES')}</strong></p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Approved Amount (KES)</Label>
              <Input type="number" step="0.01" value={approveAmount || ''} onChange={(e) => setApproveAmount(parseFloat(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea value={approveNotes} onChange={(e) => setApproveNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveReq(null)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={approveAmount <= 0}>Approve</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decline Dialog */}
      <Dialog open={!!declineReq} onOpenChange={() => setDeclineReq(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decline Misc Request</DialogTitle></DialogHeader>
          <p className="text-sm text-foreground/80 mb-2">{declineReq?.purpose}</p>
          <div className="space-y-1">
            <Label>Reason for decline *</Label>
            <Textarea value={declineNotes} onChange={(e) => setDeclineNotes(e.target.value)} rows={3} placeholder="Required..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineReq(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDecline} disabled={!declineNotes.trim()}>Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Report Dialog */}
      <Dialog open={!!reviewReport} onOpenChange={() => setReviewReport(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review Misc Report — {reviewReport?.period_month}</DialogTitle></DialogHeader>
          <div className="flex gap-4 text-sm mb-3">
            <span>Approved: <strong>{formatCurrency(reviewReport?.total_approved || 0, 'KES')}</strong></span>
            <span>Claimed: <strong>{formatCurrency(reviewReport?.total_claimed || 0, 'KES')}</strong></span>
            <span className={Number(reviewReport?.variance) < 0 ? 'text-danger-soft-foreground' : ''}>
              Variance: <strong>{formatCurrency(Number(reviewReport?.variance || 0), 'KES')}</strong>
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Flag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewItems.map((item: /* // */ any) => (
                <TableRow key={item.id} className={item.flagged ? 'bg-danger-soft/50' : ''}>
                  <TableCell className="text-sm">{formatDate(item.expense_date)}</TableCell>
                  <TableCell className="font-medium text-sm">{item.description}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(item.amount, 'KES')}</TableCell>
                  <TableCell>
                    <Button
                      variant={item.flagged ? 'destructive' : 'ghost'}
                      size="sm"
                      onClick={() => toggleFlag(item.id, !item.flagged, item.flagged ? undefined : 'Flagged by CFO')}
                    >
                      {item.flagged ? 'Unflag' : 'Flag'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewReport(null)}>Close</Button>
            {reviewReport?.status === 'submitted' && (
              <Button onClick={markReviewed}>Mark as CFO Reviewed</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
