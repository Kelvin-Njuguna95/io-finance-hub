'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentYearMonth } from '@/lib/format';
import { getLaggedMonth } from '@/lib/report-utils';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Total KES across invoices with status = 'paid' (strictly fully-paid,
 * not 'partially_paid') whose billing_period is the lagged month — i.e.
 * current calendar month minus one (Africa/Nairobi). This is the P&L
 * revenue convention: April reports March revenue.
 *
 * Direct query against the invoices table because the existing
 * lagged_revenue_by_project_month view does not filter by status and
 * therefore includes draft / sent / partially_paid / overdue rows.
 */
export function useMonthlyInvoiceRevenue() {
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const laggedMonth = getLaggedMonth(getCurrentYearMonth());

      const { data, error: queryError } = await supabase
        .from('invoices')
        .select('amount_kes')
        .eq('status', 'paid')
        .eq('billing_period', laggedMonth);

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
