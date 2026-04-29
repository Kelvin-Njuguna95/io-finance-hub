'use client';

import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { SectionCard } from '@/components/layout/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompactKES } from '@/lib/format';
import { getOutstandingInvoices } from '@/lib/queries/invoices';
import type { InvoiceWithPayments } from '@/types/query-results';

type RailInvoice = {
  id: string;
  invoiceNumber: string;
  client: string;
  context: string;
  amountKes: number;
  dueDate: string | null;
};

const NAIROBI_TIMEZONE = 'Africa/Nairobi';

function todayInNairobi(): Date {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${iso}T00:00:00`);
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / 86_400_000);
}

function formatDueShort(dueDate: string): string {
  // "26 APR" — short, uppercase, en-KE month abbreviation.
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TIMEZONE,
    day: '2-digit',
    month: 'short',
  }).formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${day} ${month}`.toUpperCase();
}

function formatKesInteger(amount: number): string {
  return (
    'KES ' +
    new Intl.NumberFormat('en-KE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  );
}

function periodLabel(): string {
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TIMEZONE,
    month: 'long',
  })
    .format(new Date())
    .toUpperCase();
}

export function PendingInvoicesRail() {
  const [rows, setRows] = useState<RailInvoice[]>([]);
  const [totalKes, setTotalKes] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: invoices } = await getOutstandingInvoices(supabase);

      if (!invoices) {
        setLoading(false);
        return;
      }

      const enriched = (invoices as unknown as InvoiceWithPayments[])
        .map((inv) => {
          const amountKes = Number(inv.amount_kes ?? 0);
          return {
            id: inv.id,
            invoiceNumber: inv.invoice_number,
            client: inv.projects?.name || '—',
            context: inv.description?.trim() || 'Outstanding invoice',
            amountKes,
            dueDate: inv.due_date,
          };
        })
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return 0;
        });

      const sum = enriched.reduce((acc, r) => acc + r.amountKes, 0);

      setRows(enriched.slice(0, 5));
      setTotalCount(enriched.length);
      setTotalKes(sum);
      setLoading(false);
    }

    load();
  }, []);

  const period = periodLabel();
  const today = todayInNairobi();

  return (
    <SectionCard
      title="Pending invoices"
      description={
        loading
          ? 'Loading…'
          : `${totalCount} awaiting · ${formatCompactKES(totalKes)}`
      }
      tone="brand"
      action={
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <Calendar className="size-3" strokeWidth={1.75} aria-hidden />
          {period}
        </span>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="space-y-1.5 text-right">
                <Skeleton className="ml-auto h-4 w-24" />
                <Skeleton className="ml-auto h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No outstanding invoices
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
            {rows.map((row) => {
              let dueText = '';
              let dueClass = 'text-muted-foreground';
              if (row.dueDate) {
                const due = new Date(row.dueDate);
                if (!Number.isNaN(due.getTime())) {
                  const overdueDays = daysBetween(today, due);
                  if (overdueDays > 0) {
                    dueText = `OVERDUE ${overdueDays}D`;
                    dueClass = 'text-danger-soft-foreground';
                  } else {
                    dueText = `DUE ${formatDueShort(row.dueDate)}`;
                  }
                }
              }

              return (
                <li
                  key={row.id}
                  className="flex items-start gap-3 px-3 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                      {row.invoiceNumber}
                    </p>
                    <p className="truncate text-sm font-medium text-foreground">
                      {row.client}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.context}
                    </p>
                  </div>
                  <div className="shrink-0 space-y-1 text-right">
                    <p className="font-mono text-[13px] font-medium tabular-nums text-foreground">
                      {formatCompactKES(row.amountKes)}
                    </p>
                    {dueText && (
                      <p
                        className={`font-mono text-[10px] uppercase tracking-[0.12em] ${dueClass}`}
                      >
                        {dueText}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex items-baseline justify-between px-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Outstanding · {period}
            </span>
            <span className="font-mono text-[15px] font-medium tabular-nums text-foreground">
              {formatKesInteger(totalKes)}
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}
