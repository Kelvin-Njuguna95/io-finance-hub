'use client';

import { History, Receipt } from 'lucide-react';

import type { PredatedPayoutRow } from '@/hooks/use-predated-payouts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
};

export function PredatedPayoutsList({ rows, loading, error, onRetry }: Props) {
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
    <ul className="space-y-2">
      {rows.map((r) => (
        <PredatedRow key={`${r.type}-${r.id}`} row={r} />
      ))}
    </ul>
  );
}

function PredatedRow({ row }: { row: PredatedPayoutRow }) {
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
        <p className="shrink-0 font-mono text-[14px] font-medium tabular-nums text-foreground">
          {formatKES(row.amount_kes)}
        </p>
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
