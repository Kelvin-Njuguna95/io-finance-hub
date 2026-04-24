'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentYearMonth } from '@/lib/format';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Total USD withdrawn in the current calendar month (Africa/Nairobi).
 *
 * The `withdrawals` table has no status column (see database.ts:189-214):
 * a row IS the record of a completed withdrawal. So summing all rows
 * filtered by `year_month` is the "confirmed" total. This mirrors the
 * existing accountant-dashboard.tsx query, just in a shared location.
 *
 * Withdrawal-window logic (days 1–3 and 10–12) is enforced when a
 * withdrawal is created, not when we report totals — the card just
 * sums whatever landed this month.
 */
export function useMonthlyWithdrawn() {
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const currentMonth = getCurrentYearMonth();

      const { data, error: queryError } = await supabase
        .from('withdrawals')
        .select('amount_usd')
        .eq('year_month', currentMonth);

      if (queryError) {
        toast.error(
          getUserErrorMessage(
            queryError,
            'Failed to load withdrawals for this month.',
          ),
        );
        setError(queryError instanceof Error ? queryError : new Error(String(queryError)));
        setLoading(false);
        return;
      }

      const sum = (data || []).reduce(
        (acc: number, w: { amount_usd: number }) => acc + Number(w.amount_usd),
        0,
      );

      setTotal(sum);
      setLoading(false);
    }

    load();
  }, []);

  return { total, loading, error };
}
