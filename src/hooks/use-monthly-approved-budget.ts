'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentYearMonth } from '@/lib/format';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Total KES across all budget versions with status = 'approved' (strict
 * CFO approval, not 'pm_approved') whose parent budget is scoped to the
 * current calendar month (Africa/Nairobi, via getCurrentYearMonth()).
 *
 * Uses the canonical Postgrest inner-join filter so the month constraint
 * applies on the parent `budgets.year_month` while we select the child
 * `budget_versions.total_amount_kes`. One join, no RPC, no new view.
 */
export function useMonthlyApprovedBudget() {
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const currentMonth = getCurrentYearMonth();

      const { data, error: queryError } = await supabase
        .from('budget_versions')
        .select('total_amount_kes, budgets!inner(year_month)')
        .eq('status', 'approved')
        .eq('budgets.year_month', currentMonth);

      if (queryError) {
        toast.error(
          getUserErrorMessage(queryError, 'Failed to load approved budget.'),
        );
        setError(queryError instanceof Error ? queryError : new Error(String(queryError)));
        setLoading(false);
        return;
      }

      const sum = (data || []).reduce(
        (acc: number, row: { total_amount_kes: number | null }) =>
          acc + Number(row.total_amount_kes || 0),
        0,
      );

      setTotal(sum);
      setLoading(false);
    }

    load();
  }, []);

  return { total, loading, error };
}
