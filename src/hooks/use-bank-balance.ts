'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getTotalPaidUsd } from '@/lib/cash-balance';
import { getUserErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';

/**
 * Consolidated bank balance in USD, computed the same way as the inline
 * logic previously duplicated in cfo-dashboard.tsx, pm-dashboard.tsx,
 * and the Withdrawals page:
 *
 *   balance = system_settings.bank_balance_usd (seed)
 *           + sum(payments.amount_usd) across all invoices (all-time)
 *           − sum(withdrawals.amount_usd) (all-time)
 *
 * Existing formula is USD-only; the hook preserves that shape rather
 * than inventing a KES total.
 */
export function useBankBalance() {
  const [totalUSD, setTotalUSD] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [balSettingRes, withdrawalsRes, invoicesRes] = await Promise.all([
        supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'bank_balance_usd')
          .single(),
        supabase.from('withdrawals').select('amount_usd'),
        supabase
          .from('invoices')
          .select('amount_usd, status, payments(amount_usd)'),
      ]);

      const firstError =
        balSettingRes.error || withdrawalsRes.error || invoicesRes.error;
      if (firstError) {
        toast.error(
          getUserErrorMessage(firstError, 'Failed to load bank balance.'),
        );
        setError(firstError instanceof Error ? firstError : new Error(String(firstError)));
        setLoading(false);
        return;
      }

      const seedBalance = parseFloat(balSettingRes.data?.value || '0');
      const totalWithdrawn = (withdrawalsRes.data || []).reduce(
        (sum: number, w: { amount_usd: number }) => sum + Number(w.amount_usd),
        0,
      );
      const totalPaid = getTotalPaidUsd(invoicesRes.data || []);

      setTotalUSD(seedBalance + totalPaid - totalWithdrawn);
      setLoading(false);
    }

    load();
  }, []);

  return { totalUSD, loading, error };
}
