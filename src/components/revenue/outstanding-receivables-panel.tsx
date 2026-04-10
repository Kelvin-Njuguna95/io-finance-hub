'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import { getAgingBucket } from '@/lib/backdated-utils';
import { DollarSign, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { getOutstandingInvoices, getInvoiceOutstandingTotal } from '@/lib/queries/invoices';

interface BucketSummary {
  label: string;
  amount: number;
  count: number;
  color: string;
}

const BUCKET_ORDER = ['0-30 days', '31-60 days', '61-90 days', '90+ days'];

const bucketStyles: Record<string, { bg: string; text: string; badge: string }> = {
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-700' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  red: { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
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
        const outstanding = getInvoiceOutstandingTotal(inv as /* // */ any);
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Outstanding Receivables</CardTitle>
        <Link href="/reports/outstanding">
          <Button variant="ghost" size="sm" className="gap-1">
            View All <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-neutral-500 py-4 text-center">Please wait</p>
        ) : (
          <div className="space-y-4">
            {/* Total Outstanding */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                <DollarSign className="h-5 w-5 text-neutral-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(totalOutstanding, 'USD')}</p>
                <p className="text-xs text-neutral-500">Total Outstanding</p>
              </div>
            </div>

            {/* Aging Breakdown */}
            <div className="space-y-1.5">
              {buckets.map((bucket) => {
                const styles = bucketStyles[bucket.color] || bucketStyles.emerald;
                return (
                  <div
                    key={bucket.label}
                    className={`flex items-center justify-between rounded-md px-3 py-2 ${styles.bg}`}
                  >
                    <span className={`text-sm font-medium ${styles.text}`}>
                      {bucket.label}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold ${styles.text}`}>
                        {formatCurrency(bucket.amount, 'USD')}
                      </span>
                      <Badge variant="secondary" className={styles.badge}>
                        {bucket.count} {bucket.count === 1 ? 'invoice' : 'invoices'}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
