'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { WithdrawalFormDialog } from '@/components/withdrawals/withdrawal-form-dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, ArrowDownToLine, TrendingUp } from 'lucide-react';
import type { Withdrawal } from '@/types/database';

export default function WithdrawalsPage() {
  const { user } = useUser();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('withdrawals')
        .select('*')
        .eq('year_month', selectedMonth)
        .order('withdrawal_date', { ascending: false });

      setWithdrawals((data || []) as Withdrawal[]);
    }
    load();
  }, [selectedMonth]);

  const totalUsd = withdrawals.reduce((s, w) => s + Number(w.amount_usd), 0);
  const totalKes = withdrawals.reduce((s, w) => s + Number(w.amount_kes), 0);
  const totalVariance = withdrawals.reduce((s, w) => s + Number(w.variance_kes || 0), 0);
  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

  return (
    <div>
      <PageHeader title="Withdrawals" description="USD withdrawals and forex tracking">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        {canCreate && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> New Withdrawal
          </Button>
        )}
      </PageHeader>

      <WithdrawalFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard title="Total Withdrawn (USD)" value={formatCurrency(totalUsd, 'USD')} icon={ArrowDownToLine} />
          <StatCard title="Total Received (KES)" value={formatCurrency(totalKes, 'KES')} icon={ArrowDownToLine} />
          <StatCard
            title="Forex Variance (KES)"
            value={formatCurrency(totalVariance, 'KES')}
            icon={TrendingUp}
            trend={totalVariance !== 0 ? { value: formatCurrency(totalVariance, 'KES'), positive: totalVariance > 0 } : undefined}
          />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Director</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">KES</TableHead>
                  <TableHead>Bureau</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-neutral-500">
                      No withdrawals for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  withdrawals.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>{formatDate(w.withdrawal_date)}</TableCell>
                      <TableCell className="font-medium">{capitalize(w.director_tag)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(w.amount_usd), 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {Number(w.exchange_rate).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(w.amount_kes), 'KES')}
                      </TableCell>
                      <TableCell className="text-sm">{w.forex_bureau || '—'}</TableCell>
                      <TableCell className="text-sm">{w.reference_id || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {w.variance_kes ? formatCurrency(Number(w.variance_kes), 'KES') : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
