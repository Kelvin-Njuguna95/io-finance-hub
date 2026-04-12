'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PayoutDialog, type PayoutRecordOption } from '@/components/common/payout-dialog';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { formatKES } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';

type DirectorPayout = {
  id: string;
  director_name: string;
  period_month: string;
  amount_kes: number;
  status: 'pending' | 'paid';
  payment_method: 'cash' | 'withdrawal';
};

type WithdrawalOption = {
  id: string;
  amount_usd: number;
  amount_kes: number;
  withdrawal_date: string;
  notes: string | null;
};

export default function DirectorPayoutsPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<DirectorPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [payoutRecords, setPayoutRecords] = useState<PayoutRecordOption[]>([]);
  const [linkModal, setLinkModal] = useState<{
    open: boolean;
    payoutId: string;
    directorName: string;
  } | null>(null);
  const [availableWithdrawals, setAvailableWithdrawals] = useState<WithdrawalOption[]>([]);
  const [selectedWithdrawalId, setSelectedWithdrawalId] = useState('');
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const isCfo = user?.role === 'cfo';

  useEffect(() => {
    void load();
  }, []);

  async function getAuthHeaders() {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('director_payouts')
      .select('id, director_name, period_month, amount_kes, status, payment_method')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      toast.error(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as DirectorPayout[]);
    setLoading(false);
  }

  async function openLinkModal(payoutId: string, directorName: string) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('withdrawals')
      .select('id, amount_usd, amount_kes, withdrawal_date, notes')
      .eq('director_name', directorName)
      .order('withdrawal_date', { ascending: false })
      .limit(20);

    if (error) {
      toast.error(error.message);
      return;
    }

    setAvailableWithdrawals((data ?? []) as WithdrawalOption[]);
    setSelectedWithdrawalId('');
    setLinkModal({ open: true, payoutId, directorName });
  }

  async function openPayoutDialog() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('profit_share_records')
      .select('id, director_name, director_tag, balance_remaining, director_share_kes')
      .eq('year_month', selectedMonth)
      .order('director_tag');

    if (error) {
      toast.error(error.message);
      return;
    }

    const records = (data ?? [])
      .map((record: {
        id: string;
        director_name: string | null;
        director_tag: string | null;
        balance_remaining: number | null;
        director_share_kes: number | null;
      }) => ({
        id: record.id,
        director_name: record.director_name || (record.director_tag ? `${record.director_tag.charAt(0).toUpperCase()}${record.director_tag.slice(1)}` : 'Director'),
        balance_remaining: Number(record.balance_remaining ?? record.director_share_kes ?? 0),
      }))
      .filter((record) => record.balance_remaining > 0);

    setPayoutRecords(records);
    setPayoutDialogOpen(true);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Director Payouts</h1>
        <div className="flex items-center gap-2">
          <Select value={selectedMonth} onValueChange={(value) => value && setSelectedMonth(value)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, index) => {
                const date = new Date();
                date.setMonth(date.getMonth() - index);
                const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                return (
                  <SelectItem key={month} value={month}>
                    {formatYearMonth(month)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {isCfo && (
            <Button onClick={openPayoutDialog}>+ New Payout</Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Director</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5}>Loading...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5}>No payouts yet.</TableCell></TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.director_name}</TableCell>
                    <TableCell>{new Intl.DateTimeFormat('en-KE', { timeZone: 'Africa/Nairobi', month: 'short', year: 'numeric' }).format(new Date(row.period_month))}</TableCell>
                    <TableCell className="text-right">{formatKES(Number(row.amount_kes || 0))}</TableCell>
                    <TableCell className="capitalize">{row.status}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {row.status === 'pending' && row.payment_method === 'withdrawal' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openLinkModal(row.id, row.director_name)}
                        >
                          Link Withdrawal
                        </Button>
                      )}
                      {row.status === 'pending' && row.payment_method === 'cash' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setMarkPaidId(row.id)}
                        >
                          ✓ Mark Paid
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={!!linkModal?.open}
        onOpenChange={() => setLinkModal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link to Withdrawal</DialogTitle>
            <DialogDescription>
              Select the withdrawal that settles this payout
              for {linkModal?.directorName}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {availableWithdrawals.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">
                No withdrawal records found for this director.
              </p>
            ) : (
              availableWithdrawals.map((w) => (
                <label
                  key={w.id}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg',
                    'border cursor-pointer transition-colors',
                    selectedWithdrawalId === w.id
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <input
                    type="radio"
                    value={w.id}
                    checked={selectedWithdrawalId === w.id}
                    onChange={() => setSelectedWithdrawalId(w.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {new Intl.DateTimeFormat('en-KE', {
                        timeZone: 'Africa/Nairobi',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      }).format(new Date(w.withdrawal_date))}
                      {' — '}
                      {formatKES(Number(w.amount_kes || 0))}
                    </p>
                    {w.notes && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {w.notes}
                      </p>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLinkModal(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={!selectedWithdrawalId || isMutating}
              onClick={async () => {
                if (!linkModal || !selectedWithdrawalId) return;
                setIsMutating(true);
                try {
                  const headers = await getAuthHeaders();
                  const res = await fetch(`/api/director-payouts/${linkModal.payoutId}/link-withdrawal`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                      withdrawal_id: selectedWithdrawalId,
                    }),
                  });
                  const payload = (await res.json()) as { error?: string };
                  if (!res.ok) {
                    toast.error(payload?.error || 'Failed to link');
                    return;
                  }
                  toast.success('Withdrawal linked — payout marked as paid');
                  setLinkModal(null);
                  await load();
                } catch (error) {
                  console.error('Failed to link withdrawal to payout:', error);
                  toast.error(error instanceof Error ? error.message : 'An unexpected error occurred.');
                } finally {
                  setIsMutating(false);
                }
              }}
            >
              Link & Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!markPaidId}
        onOpenChange={() => setMarkPaidId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Cash Payment</DialogTitle>
            <DialogDescription>
              Confirm that this cash payout has been physically
              received by the director. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMarkPaidId(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={isMutating}
              onClick={async () => {
                if (!markPaidId) return;
                setIsMutating(true);
                try {
                  const headers = await getAuthHeaders();
                  const res = await fetch(`/api/director-payouts/${markPaidId}/mark-paid`, {
                    method: 'PATCH',
                    headers,
                  });
                  const payload = (await res.json()) as { error?: string };
                  if (!res.ok) {
                    toast.error(payload?.error || 'Failed to mark paid');
                    return;
                  }
                  toast.success('Payout marked as paid');
                  setMarkPaidId(null);
                  await load();
                } catch (error) {
                  console.error('Failed to mark payout paid:', error);
                  toast.error(error instanceof Error ? error.message : 'An unexpected error occurred.');
                } finally {
                  setIsMutating(false);
                }
              }}
            >
              Confirm Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayoutDialog
        open={payoutDialogOpen}
        onOpenChange={setPayoutDialogOpen}
        selectedMonth={selectedMonth}
        records={payoutRecords}
        onCreated={load}
      />
    </div>
  );
}
