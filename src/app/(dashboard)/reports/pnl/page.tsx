'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import type { MonthlyFinancialSnapshot } from '@/types/database';

function PnlLine({ label, usd, kes, bold, negative }: {
  label: string; usd: number; kes: number; bold?: boolean; negative?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-sm">{label}</span>
      <div className="flex gap-8">
        <span className={`text-sm font-mono ${negative ? 'text-red-600' : ''}`}>
          {formatCurrency(usd, 'USD')}
        </span>
        <span className={`text-sm font-mono w-36 text-right ${negative ? 'text-red-600' : ''}`}>
          {formatCurrency(kes, 'KES')}
        </span>
      </div>
    </div>
  );
}

export default function PnLReportPage() {
  const [snapshot, setSnapshot] = useState<MonthlyFinancialSnapshot | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [reportMode, setReportMode] = useState<'accrual' | 'cash'>('accrual');

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('monthly_financial_snapshots')
        .select('*')
        .eq('year_month', selectedMonth)
        .single();
      setSnapshot(data);
    }
    load();
  }, [selectedMonth]);

  const s = snapshot;

  return (
    <div>
      <PageHeader title="Profit & Loss" description="Company P&L statement">
        <Tabs value={reportMode} onValueChange={(v) => setReportMode(v as 'accrual' | 'cash')}>
          <TabsList>
            <TabsTrigger value="accrual">Accrual</TabsTrigger>
            <TabsTrigger value="cash">Cash</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">
              {formatYearMonth(selectedMonth)} — {reportMode === 'accrual' ? 'Accrual' : 'Cash'} Basis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!s ? (
              <p className="text-sm text-neutral-500 py-8 text-center">
                No financial data for {formatYearMonth(selectedMonth)}
              </p>
            ) : (
              <div>
                <PnlLine label="Revenue" usd={s.total_revenue_usd} kes={s.total_revenue_kes} bold />
                <PnlLine label="Direct Costs" usd={-s.total_direct_costs_usd} kes={-s.total_direct_costs_kes} negative />
                <Separator className="my-1" />
                <PnlLine label="Gross Profit" usd={s.gross_profit_usd} kes={s.gross_profit_kes} bold />
                <PnlLine label="Shared Overhead" usd={-s.total_shared_overhead_usd} kes={-s.total_shared_overhead_kes} negative />
                <Separator className="my-1" />
                <PnlLine label="Operating Profit" usd={s.operating_profit_usd} kes={s.operating_profit_kes} bold />
                <PnlLine label="Forex Gain/Loss" usd={0} kes={s.forex_gain_loss_kes} />
                <Separator className="my-1" />
                <PnlLine label="Net Profit" usd={s.net_profit_usd} kes={s.net_profit_kes} bold />

                <div className="mt-4 text-xs text-neutral-400">
                  Total agents: {s.total_agents}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
