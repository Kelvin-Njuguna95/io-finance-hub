'use client';

import { useState } from 'react';
import { History, Loader2, Receipt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { PredatedPayoutRow } from '@/hooks/use-predated-payouts';
import { useUser } from '@/hooks/use-user';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatYearMonth } from '@/lib/format';
import { formatKES } from '@/lib/utils/currency';

// Stage 4 of 5 (PRED-4). Renders the unioned predated-payouts list
// returned by usePredatedPayouts. Read-only — edit/delete are out of
// scope for this stage.

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  mobile_money: 'Mobile money',
  cheque: 'Cheque',
  other: 'Other',
};

function paymentMethodLabel(value: string): string {
  return PAYMENT_METHOD_LABELS[value] ?? value;
}

const NAIROBI_TZ = 'Africa/Nairobi';

function formatRecordedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

type Props = {
  rows: PredatedPayoutRow[];
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  /** Called after a successful soft-delete so the parent can refresh
   *  the hook and any dependent KPIs. */
  onChange?: () => void | Promise<void>;
};

export function PredatedPayoutsList({
  rows,
  loading,
  error,
  onRetry,
  onChange,
}: Props) {
  const { user } = useUser();
  const canDelete = user?.role === 'cfo';
  const [pendingDelete, setPendingDelete] = useState<PredatedPayoutRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Your session has expired. Please sign in again.');
        return;
      }
      const path =
        pendingDelete.type === 'project_share'
          ? `/api/predated-payouts/${pendingDelete.id}`
          : `/api/predated-company-shares/${pendingDelete.id}`;
      const res = await fetch(path, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete predated record.');
        return;
      }
      toast.success('Predated record deleted.');
      setPendingDelete(null);
      await onChange?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete predated record.',
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4 text-sm text-danger-soft-foreground">
        <p>Failed to load predated payouts: {error}</p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onRetry}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-card/50 px-6 py-12 text-center text-sm text-muted-foreground">
        <Receipt className="mx-auto mb-2 size-6 opacity-40" />
        <p>
          No predated payouts recorded yet. Use{' '}
          <span className="font-medium text-foreground">Record predated</span>{' '}
          above to add one.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((r) => (
          <PredatedRow
            key={`${r.type}-${r.id}`}
            row={r}
            canDelete={canDelete}
            onRequestDelete={() => setPendingDelete(r)}
          />
        ))}
      </ul>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this predated record?</DialogTitle>
            <DialogDescription>
              This soft-deletes the record — it stops appearing in the list,
              the header KPI, and EOD reports, but the row stays in the
              database for forensic recovery. Restoration requires engineer
              SQL access.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-[12.5px]">
              <p className="font-medium text-foreground">
                {pendingDelete.director_name}
              </p>
              <p className="mt-1 text-muted-foreground">
                {pendingDelete.type === 'project_share'
                  ? `Project share · ${pendingDelete.project_name ?? '—'} · ${formatYearMonth(pendingDelete.year_month)}`
                  : `Company pool · ${formatYearMonth(pendingDelete.year_month)}`}
              </p>
              <p className="mt-1 font-mono tabular-nums text-foreground">
                {formatKES(pendingDelete.amount_kes)}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              Delete record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PredatedRow({
  row,
  canDelete,
  onRequestDelete,
}: {
  row: PredatedPayoutRow;
  canDelete: boolean;
  onRequestDelete: () => void;
}) {
  const subline =
    row.type === 'project_share'
      ? `Project share · ${row.project_name ?? '—'}${row.project_is_active === false ? ' (deactivated)' : ''} · ${formatYearMonth(row.year_month)}`
      : `Company pool · ${formatYearMonth(row.year_month)}`;
  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-warning/30 bg-warning-soft text-warning-soft-foreground"
            >
              <History className="size-3" /> Predated
            </Badge>
            <p className="truncate text-[14px] font-medium text-foreground">
              {row.director_name}
            </p>
          </div>
          <p className="mt-1 truncate text-[12.5px] text-muted-foreground">
            {subline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <p className="font-mono text-[14px] font-medium tabular-nums text-foreground">
            {formatKES(row.amount_kes)}
          </p>
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-danger-soft-foreground"
              onClick={onRequestDelete}
              aria-label="Delete predated record"
              title="Delete predated record"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
        Recorded {formatRecordedAt(row.recorded_at)} by {row.recorded_by_name}{' '}
        · {paymentMethodLabel(row.payment_method)}
      </p>
      {row.notes && (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{row.notes}</p>
      )}
    </li>
  );
}
