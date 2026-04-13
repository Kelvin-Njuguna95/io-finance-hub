'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { formatYearMonth } from '@/lib/format';
import { formatKES } from '@/lib/utils/currency';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type PayoutRecordOption = {
  id: string;
  director_name: string;
  balance_remaining: number;
};

const ALL_DIRECTORS = ['Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'] as const;

type PayoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedMonth: string;
  records: PayoutRecordOption[];
  onCreated: () => Promise<void> | void;
};

export function PayoutDialog({
  open,
  onOpenChange,
  selectedMonth,
  records,
  onCreated,
}: PayoutDialogProps) {
  const [selectedDirector, setSelectedDirector] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'withdrawal'>('cash');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedDirector('');
    setAmount('');
    setPaymentMethod('cash');
    setNotes('');
    setError(null);
  }, [open]);

  const selectedRecord = useMemo(
    () => records.find((record) => record.director_name === selectedDirector) ?? null,
    [records, selectedDirector],
  );

  const maxAvailable = Number(selectedRecord?.balance_remaining ?? 0);

  async function getAuthHeaders() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  async function handleSubmit() {
    setError(null);

    if (!selectedDirector) {
      setError('Please select a director.');
      return;
    }

    const parsedAmount = Number.parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }

    if (selectedRecord && parsedAmount > maxAvailable) {
      setError(`Amount cannot exceed available balance (${formatKES(maxAvailable)}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/director-payouts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          director_name: selectedDirector,
          profit_share_record_id: selectedRecord?.id ?? null,
          period_month: selectedMonth,
          amount_kes: parsedAmount,
          payment_method: paymentMethod,
          notes: notes.trim() || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || 'Failed to create payout.');
        return;
      }

      toast.success('Payout created successfully.');
      onOpenChange(false);
      await onCreated();
    } catch (submitError) {
      console.error('Failed to create payout:', submitError);
      setError(submitError instanceof Error ? submitError.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Initiate Director Payout</DialogTitle>
          <DialogDescription>
            Create a new payout request for {formatYearMonth(selectedMonth)}. Available balance is validated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="payout-director">Director</Label>
            <Select value={selectedDirector} onValueChange={(value) => setSelectedDirector(value ?? '')}>
              <SelectTrigger id="payout-director">
                <SelectValue placeholder="Select director" />
              </SelectTrigger>
              <SelectContent>
                {ALL_DIRECTORS.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Period</Label>
            <div className="flex h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm">
              {formatYearMonth(selectedMonth)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payout-amount">Amount (KES)</Label>
            <Input
              id="payout-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
            {selectedRecord ? (
              <p className="text-xs text-muted-foreground">Available balance: {formatKES(maxAvailable)}</p>
            ) : selectedDirector ? (
              <p className="text-xs text-muted-foreground">No profit share record linked for this period</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-method">Payment Method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(value) => {
                if (!value) return;
                setPaymentMethod(value);
              }}
            >
              <SelectTrigger id="payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="withdrawal">Withdrawal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payout-notes">Notes (optional)</Label>
            <Textarea
              id="payout-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add context for this payout"
            />
          </div>

          {selectedDirector && !selectedRecord && (
            <p className="text-sm text-warning-soft-foreground">
              No finalized profit share record found for {selectedDirector} in {formatYearMonth(selectedMonth)}.
              {' '}
              The payout will be recorded without a linked profit share period.
            </p>
          )}

          {error && <p className="text-sm text-danger-soft-foreground">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !selectedDirector}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
