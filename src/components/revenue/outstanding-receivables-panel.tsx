'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import { getAgingBucket } from '@/lib/backdated-utils';
import {
  getOutstandingInvoices,
  getInvoiceOutstandingTotal,
} from '@/lib/queries/invoices';
import type { InvoiceWithPayments } from '@/types/query-results';
import { DollarSign, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface BucketSummary {
  label: string;
  amount: number;
  count: number;
  color: string;
}

const BUCKET_ORDER = ['0-30 days', '31-60 days', '61-90 days', '90+ days'];

const bucketStyles: Record<string, { bg: string; text: string; badge: string }> = {
  emerald: {
    bg: 'bg-success-soft',
    text: 'text-success-soft-foreground',
    badge: 'bg-success/15 text-success-soft-foreground',
  },
  blue: {
    bg: 'bg-info-soft',
    text: 'text-info-soft-foreground',
    badge: 'bg-info/15 text-info-soft-foreground',
  },
  amber: {
    bg: 'bg-warning-soft',
    text: 'text-warning-soft-foreground',
    badge: 'bg-warning/20 text-warning-soft-foreground',
  },
  red: {
    bg: 'bg-danger-soft',
    text: 'text-danger-soft-foreground',
    badge: 'bg-danger/15 text-danger-soft-foreground',
  },
};

export function OutstandingReceivablesPanel() {
  const [totalOutstanding, setTotalOutstanding] = useState(0);
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

      // Initialize all buckets
      for (const b of BUCKET_ORDER) {
        bucketMap[b] = { amount: 0, count: 0, color: '' };
      }

      let total = 0;

      for (const inv of invoices) {
        const outstanding = getInvoiceOutstandingTotal(
          inv as unknown as InvoiceWithPayments
        );
        if (outstanding <= 0) continue;

        const aging = getAgingBucket(inv.invoice_date);
        total += outstanding;

        if (!bucketMap[aging.bucket]) {
          bucketMap[aging.bucket] = { amount: 0, count: 0, color: aging.color };
        }
        bucketMap[aging.bucket].amount += outstanding;
        bucketMap[aging.bucket].count += 1;
        bucketMap[aging.bucket].color = aging.color;
      }

      // Assign colors for initialized-but-empty buckets
      const colorOrder = ['emerald', 'blue', 'amber', 'red'];
      BUCKET_ORDER.forEach((b, i) => {
        if (!bucketMap[b].color) bucketMap[b].color = colorOrder[i];
      });

      setTotalOutstanding(total);
      setBuckets(
        BUCKET_ORDER.map((label) => ({
          label,
          amount: bucketMap[label].amount,
          count: bucketMap[label].count,
          color: bucketMap[label].color,
        }))
      );
      setLoading(false);
    }

    loadReceivables();
  }, []);

  return (
    <SectionCard
      title="Outstanding Receivables"
      description="Aged invoice exposure across sent, partially paid, and overdue"
      icon={DollarSign}
      tone="teal"
      action={
        <Link href="/reports/outstanding">
          <Button variant="ghost" size="sm" className="gap-1">
            View all <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </Link>
      }
    >
      {loading ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-teal-soft ring-1 ring-inset ring-teal/25">
              <DollarSign
                className="size-5 text-teal-soft-foreground"
                strokeWidth={1.75}
              />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {formatCurrency(totalOutstanding, 'USD')}
              </p>
              <p className="text-xs text-muted-foreground">Total outstanding</p>
            </div>
          </div>

          <ul className="space-y-1.5">
            {buckets.map((bucket) => {
              const styles = bucketStyles[bucket.color] || bucketStyles.emerald;
              return (
                <li
                  key={bucket.label}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 ${styles.bg}`}
                >
                  <span className={`text-sm font-medium ${styles.text}`}>
                    {bucket.label}
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold tabular-nums ${styles.text}`}
                    >
                      {formatCurrency(bucket.amount, 'USD')}
                    </span>
                    <Badge variant="secondary" className={styles.badge}>
                      {bucket.count}{' '}
                      {bucket.count === 1 ? 'invoice' : 'invoices'}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
