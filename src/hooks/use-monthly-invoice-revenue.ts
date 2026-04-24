'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentYearMonth } from '@/lib/format';
import { getNextMonth } from '@/lib/report-utils';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Sum of KES payments received in the current calendar month
 * (Africa/Nairobi). Queries the payments table directly by
 * payment_date; includes partial payments; does not filter by
 * invoice status. This is a cash-flow metric — "money that
 * arrived this month" — not accrual revenue.
 */
export function useMonthlyInvoiceRevenue() {
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const ym = getCurrentYearMonth();
      const start = `${ym}-01`;
      const end = `${getNextMonth(ym)}-01`;

      const { data, error: queryError } = await supabase
        .from('payments')
        .select('amount_kes')
        .gte('payment_date', start)
        .lt('payment_date', end);

      if (queryError) {
        toast.error(
          getUserErrorMessage(queryError, 'Failed to load invoice revenue.'),
        );
        setError(queryError instanceof Error ? queryError : new Error(String(queryError)));
        setLoading(false);
        return;
      }

      const sum = (data || []).reduce(
        (acc: number, row: { amount_kes: number | null }) =>
          acc + Number(row.amount_kes || 0),
        0,
      );

      setTotal(sum);
      setLoading(false);
    }

    load();
  }, []);

  return { total, loading, error };
}
