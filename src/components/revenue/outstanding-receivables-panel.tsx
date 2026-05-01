'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';
import { getAgingBucket } from '@/lib/backdated-utils';
import {
  getOutstandingInvoices,
  getInvoiceOutstandingTotal,
} from '@/lib/queries/invoices';
import type { InvoiceWithPayments } from '@/types/query-results';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface BucketSummary {
  label: string;
  amount: number;
  count: number;
  color: string;
}

const BUCKET_ORDER = ['0-30 days', '31-60 days', '61-90 days', '90+ days'];

type BucketTone = 'fresh' | 'due' | 'warn' | 'danger';

const TONE_CLASSES: Record<BucketTone, { wrap: string; label: string; value: string }> = {
  fresh: {
    wrap: 'bg-card',
    label: 'text-foreground',
    value: 'text-foreground',
  },
  due: {
    wrap: 'bg-card',
    label: 'text-muted-foreground',
    value: 'text-foreground',
  },
  warn: {
    wrap: 'bg-[var(--gold-soft)]',
    label: 'text-[oklch(0.40_0.15_75)]',
    value: 'text-[oklch(0.40_0.15_75)]',
  },
  danger: {
    wrap: 'bg-danger-soft',
    label: 'text-[var(--danger)]',
    value: 'text-[var(--danger)]',
  },
};

function toneFor(label: string): BucketTone {
  if (label.startsWith('0-30')) return 'fresh';
  if (label.startsWith('31-60')) return 'due';
  if (label.startsWith('61-90')) return 'warn';
  return 'danger';
}

export function OutstandingReceivablesPanel() {
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [buckets, setBuckets] = useState<BucketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReceivables() {
      const supabase = createClient();

      const { data: invoices } = await getOutstandingInvoices(supabase);

      if (!invoices) {
        setLoading(false);
        return;
      }

      const bucketMap: Record<string, { amount: number; count: number; color: string }> = {};

      for (const b of BUCKET_ORDER) {
        bucketMap[b] = { amount: 0, count: 0, color: '' };
      }

      let total = 0;
      let count = 0;

      for (const inv of invoices) {
        const outstanding = getInvoiceOutstandingTotal(
          inv as unknown as InvoiceWithPayments,
        );
        if (outstanding <= 0) continue;

        const aging = getAgingBucket(inv.invoice_date);
        total += outstanding;
        count += 1;

        if (!bucketMap[aging.bucket]) {
          bucketMap[aging.bucket] = { amount: 0, count: 0, color: aging.color };
        }
        bucketMap[aging.bucket].amount += outstanding;
        bucketMap[aging.bucket].count += 1;
        bucketMap[aging.bucket].color = aging.color;
      }

      const colorOrder = ['emerald', 'blue', 'amber', 'red'];
      BUCKET_ORDER.forEach((b, i) => {
        if (!bucketMap[b].color) bucketMap[b].color = colorOrder[i];
      });

      setTotalOutstanding(total);
      setTotalCount(count);
      setBuckets(
        BUCKET_ORDER.map((label) => ({
          label,
          amount: bucketMap[label].amount,
          count: bucketMap[label].count,
          color: bucketMap[label].color,
        })),
      );
      setLoading(false);
    }

    loadReceivables();
  }, []);

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
      {/* List-frame header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Outstanding receivables{' '}
          {!loading && totalCount > 0 && (
            <>
              <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
              <span className="text-foreground">
                {totalCount} invoice{totalCount === 1 ? '' : 's'}
              </span>
              <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
              <span className="text-foreground">
                {formatCompactCurrency(totalOutstanding, 'USD')}
              </span>
            </>
          )}
        </span>
        <Link
          href="/reports/outstanding"
          className="inline-flex items-center gap-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.10em] text-muted-foreground transition-colors hover:text-foreground"
        >
          View all <ArrowRight className="size-3" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      {/* Body */}
      {loading ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : totalCount === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No outstanding receivables.
        </div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          {/* Headline total */}
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Total outstanding
            </p>
            <p className="mt-1 font-mono text-[26px] font-medium leading-none tracking-tight text-foreground tabular-nums">
              <span className="mr-2 text-[11px] tracking-[0.04em] text-muted-foreground">USD</span>
              {totalOutstanding.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
          </div>

          {/* 4-bucket grid — same .aging-bar grain as /revenue's AgingBucketsPanel,
              but with USD totals + invoice counts (panel-specific data) */}
          <div className="mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-sm)] bg-[var(--border-subtle)]">
            {buckets.map((bucket) => {
              const tone = TONE_CLASSES[toneFor(bucket.label)];
              return (
                <div
                  key={bucket.label}
                  className={cn('flex flex-col gap-1 px-3 py-3', tone.wrap)}
                >
                  <span
                    className={cn(
                      'font-mono text-[9.5px] uppercase tracking-[0.12em]',
                      tone.label,
                    )}
                  >
                    {bucket.label}
                  </span>
                  <span className={cn('font-mono text-[13px] font-medium tabular-nums', tone.value)}>
                    {bucket.amount > 0
                      ? formatCompactCurrency(bucket.amount, 'USD').replace('USD ', '')
                      : '—'}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {bucket.count} invoice{bucket.count === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Full precision footnote */}
          <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
            Total ·{' '}
            <span className="text-foreground">{formatCurrency(totalOutstanding, 'USD')}</span>
          </p>
        </div>
      )}
    </section>
  );
}
