'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCurrentYearMonth } from '@/lib/format';
import { getLaggedMonth } from '@/lib/report-utils';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Company-wide P&L scalars for the current calendar month's service
 * period (Africa/Nairobi): total revenue (lagged from the service
 * month), total costs (direct + overhead, confirmed only), and net
 * profit (revenue − costs). No project scoping — the Home performance
 * row shows the same company totals to CFO, PM, and Accountant.
 *
 * Extracted from the monolithic useEffect on /reports/monthly (it
 * computes the same scalars plus per-project rows, category
 * breakdowns, and historical-seed fallbacks that Home does not need).
 * Keep this hook slim — only the three scalars plus the service-month
 * label. Detailed P&L logic stays on the P&L page.
 */
export function useMonthlyPlSummary() {
  const [totalRevenueKes, setTotalRevenueKes] = useState(0);
  const [totalCostsKes, setTotalCostsKes] = useState(0);
  const [netProfitKes, setNetProfitKes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const currentMonth = getCurrentYearMonth();
  const laggedServiceMonth = getLaggedMonth(currentMonth);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [revenueRes, projectExpensesRes, sharedExpensesRes] = await Promise.all([
        supabase
          .from('lagged_revenue_by_project_month')
          .select('lagged_revenue_kes')
          .eq('expense_month', currentMonth),
        supabase
          .from('expenses')
          .select('amount_kes')
          .eq('year_month', currentMonth)
          .eq('expense_type', 'project_expense')
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('expenses')
          .select('amount_kes')
          .eq('year_month', currentMonth)
          .eq('expense_type', 'shared_expense')
          .eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
      ]);

      const queryError = revenueRes.error || projectExpensesRes.error || sharedExpensesRes.error;
      if (queryError) {
        toast.error(
          getUserErrorMessage(queryError, 'Failed to load P&L summary.'),
        );
        setError(queryError instanceof Error ? queryError : new Error(String(queryError)));
        setLoading(false);
        return;
      }

      const revenue = (revenueRes.data || []).reduce(
        (acc: number, row: { lagged_revenue_kes: number | null }) =>
          acc + Number(row.lagged_revenue_kes || 0),
        0,
      );

      const directCosts = (projectExpensesRes.data || []).reduce(
        (acc: number, row: { amount_kes: number | null }) =>
          acc + Number(row.amount_kes || 0),
        0,
      );

      const overhead = (sharedExpensesRes.data || []).reduce(
        (acc: number, row: { amount_kes: number | null }) =>
          acc + Number(row.amount_kes || 0),
        0,
      );

      const costs = directCosts + overhead;

      setTotalRevenueKes(revenue);
      setTotalCostsKes(costs);
      setNetProfitKes(revenue - costs);
      setLoading(false);
    }

    load();
  }, [currentMonth]);

  return {
    totalRevenueKes,
    totalCostsKes,
    netProfitKes,
    laggedServiceMonth,
    loading,
    error,
  };
}
