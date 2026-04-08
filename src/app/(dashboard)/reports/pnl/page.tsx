'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';

function PnlLine({ label, kes, bold, negative }: {
  label: string; kes: number; bold?: boolean; negative?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-mono ${negative ? 'text-red-600' : ''}`}>
        {formatCurrency(kes, 'KES')}
      </span>
    </div>
  );
}

interface PnlData {
  revenue: number;
  directCosts: number;
  grossProfit: number;
  sharedOverhead: number;
  operatingProfit: number;
  netProfit: number;
  agents: number;
  revenueUsd: number;
}

export default function PnLReportPage() {
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [reportMode, setReportMode] = useState<'accrual' | 'cash'>('accrual');
  const [loading, setLoading] = useState(true);
  const [cashBalance, setCashBalance] = useState(0);

  const [revenueSourceMonth, setRevenueSourceMonth] = useState('');
  const [isHistorical, setIsHistorical] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // 1. Try snapshot first
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('*')
        .eq('year_month', selectedMonth)
        .single();

      // Detect historical months — use direct matching instead of lag
      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      setIsHistorical(historical);
      let revMonth: string;
      if (historical) {
        revMonth = selectedMonth;
      } else {
        const prevDate = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 2, 1);
        revMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
      }
      setRevenueSourceMonth(revMonth);

      // Fetch cash balance: standing balance - withdrawals + payments received
      const [balRes, wdRes, payRes2] = await Promise.all([
        supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single(),
        supabase.from('withdrawals').select('amount_usd'),
        supabase.from('payments').select('amount_usd'),
      ]);
      const standingBal = parseFloat(balRes.data?.value || '0');
      const totalWithdrawn = (wdRes.data || []).reduce((s: number, w: any) => s + Number(w.amount_usd), 0);
      const totalPaid = (payRes2.data || []).reduce((s: number, p: any) => s + Number(p.amount_usd), 0);
      setCashBalance(standingBal - totalWithdrawn + totalPaid);

      if (snapshot && Number(snapshot.total_revenue_kes) > 0) {
        // Always get live agent counts — snapshots may have stale or missing agent data
        const { data: agentData } = await supabase
          .from('agent_counts')
          .select('agent_count')
          .eq('year_month', selectedMonth);
        const liveAgents = (agentData || []).reduce((s: number, a: any) => s + Number(a.agent_count || 0), 0);

        setPnl({
          revenue: snapshot.total_revenue_kes,
          directCosts: snapshot.total_direct_costs_kes,
          grossProfit: snapshot.gross_profit_kes,
          sharedOverhead: snapshot.total_shared_overhead_kes,
          operatingProfit: snapshot.operating_profit_kes,
          netProfit: snapshot.net_profit_kes,
          agents: liveAgents > 0 ? liveAgents : snapshot.total_agents,
          revenueUsd: snapshot.total_revenue_usd,
        });
        setLoading(false);
        return;
      }

      // 2. Compute live from invoices + expenses
      const [invRes, projExpRes, sharedExpRes, agentRes, rateRes, payRes] = await Promise.all([
        // Lagged revenue: previous month's invoices
        supabase.from('invoices').select('amount_usd, amount_kes').eq('billing_period', reportMode === 'accrual' ? revMonth : selectedMonth),
        // Direct project expenses this month
        supabase.from('expenses').select('amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense'),
        // Shared overhead this month
        supabase.from('expenses').select('amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'shared_expense'),
        // Agent count
        supabase.from('agent_counts').select('agent_count').eq('year_month', selectedMonth),
        // Exchange rate
        supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single(),
        // Cash mode: payments received this month
        supabase.from('payments').select('amount_usd, payment_date'),
      ]);

      const stdRate = parseFloat(rateRes.data?.value || '129.5');

      let revenue = 0;
      let revenueUsd = 0;

      if (reportMode === 'accrual') {
        // Lagged: previous month invoice converted to KES
        revenueUsd = (invRes.data || []).reduce((s: number, i: any) => s + Number(i.amount_usd), 0);
        const revKes = (invRes.data || []).reduce((s: number, i: any) => s + Number(i.amount_kes), 0);
        revenue = revKes > 0 ? revKes : Math.round(revenueUsd * stdRate * 100) / 100;
      } else {
        // Cash mode: payments received in this month
        const monthPayments = (payRes.data || []).filter((p: any) => p.payment_date?.startsWith(selectedMonth));
        revenueUsd = monthPayments.reduce((s: number, p: any) => s + Number(p.amount_usd), 0);
        revenue = Math.round(revenueUsd * stdRate * 100) / 100;
      }

      const directCosts = (projExpRes.data || []).reduce((s: number, e: any) => s + Number(e.amount_kes), 0);
      const sharedOverhead = (sharedExpRes.data || []).reduce((s: number, e: any) => s + Number(e.amount_kes), 0);
      const grossProfit = revenue - directCosts;
      const operatingProfit = grossProfit - sharedOverhead;
      const agents = (agentRes.data || []).reduce((s: number, a: any) => s + Number(a.agent_count || 0), 0);

      setPnl({
        revenue,
        directCosts,
        grossProfit,
        sharedOverhead,
        operatingProfit,
        netProfit: operatingProfit,
        agents,
        revenueUsd,
      });
      setLoading(false);
    }
    load();
  }, [selectedMonth, reportMode]);

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
              const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6">
        <Card className="max-w-2xl io-card">
          <CardHeader>
            <div>
              <CardTitle className="text-base">
                {formatYearMonth(selectedMonth)} — {reportMode === 'accrual' ? 'Accrual (Lagged)' : 'Cash'} Basis
              </CardTitle>
              {reportMode === 'accrual' ? (
                <p className="text-xs text-slate-400 mt-1">{isHistorical ? `Revenue & Expenses from ${formatYearMonth(selectedMonth)} (historical)` : `Revenue from ${formatYearMonth(revenueSourceMonth)} invoice | Expenses from ${formatYearMonth(selectedMonth)}`}</p>
              ) : (
                <p className="text-xs text-slate-400 mt-1">Cash mode: showing revenue received in {formatYearMonth(selectedMonth)}</p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-neutral-400 py-8 text-center">Loading...</p>
            ) : !pnl ? (
              <p className="text-sm text-neutral-500 py-8 text-center">
                No financial data for {formatYearMonth(selectedMonth)}
              </p>
            ) : (
              <div>
                <PnlLine label={reportMode === 'accrual' ? (isHistorical ? 'Revenue' : `Revenue (from ${formatYearMonth(revenueSourceMonth)} invoice)`) : 'Revenue (cash received)'} kes={pnl.revenue} bold />
                {pnl.revenueUsd > 0 && (
                  <p className="text-xs text-slate-400 -mt-1 mb-1 text-right">USD {pnl.revenueUsd.toLocaleString()} × standard rate</p>
                )}
                <PnlLine label="Direct Costs" kes={-pnl.directCosts} negative />
                <Separator className="my-1" />
                <PnlLine label="Gross Profit" kes={pnl.grossProfit} bold />
                <PnlLine label="Shared Overhead" kes={-pnl.sharedOverhead} negative />
                <Separator className="my-1" />
                <PnlLine label="Operating Profit" kes={pnl.operatingProfit} bold />
                <Separator className="my-1" />
                <PnlLine label="Net Profit" kes={pnl.netProfit} bold />

                <Separator className="my-3" />
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-semibold">Cash Balance (USD)</span>
                  <span className="text-sm font-mono font-semibold text-emerald-600">
                    {formatCurrency(cashBalance, 'USD')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 -mt-1 mb-2 text-right">
                  Standing balance − withdrawals + payments received
                </p>

                {pnl.revenue === 0 && (
                  <div className="mt-4 alert-warning rounded-lg p-3 text-sm">
                    No invoice found for {reportMode === 'accrual' ? formatYearMonth(revenueSourceMonth) : formatYearMonth(selectedMonth)}. Revenue is KES 0.
                  </div>
                )}

                <div className="mt-4 text-xs text-neutral-400">
                  Total agents: {pnl.agents}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
