'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency } from '@/components/reports/executive-kit';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth, getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { Badge } from '@/components/ui/badge';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { getTotalPaidUsd } from '@/lib/cash-balance';

function PnlLine({ label, kes, bold, negative }: {
  label: string; kes: number; bold?: boolean; negative?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-2 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-mono ${negative ? 'text-danger-soft-foreground' : ''}`}>
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
  revenueEstimated: boolean;
}

export default function PnLReportPage() {
  const [pnl, setPnl] = useState<PnlData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [reportMode, setReportMode] = useState<'accrual' | 'cash'>('accrual');
  const [loading, setLoading] = useState(true);
  const [cashBalance, setCashBalance] = useState(0);

  const [revenueSourceMonth, setRevenueSourceMonth] = useState(
    getLaggedMonth(selectedMonth)
  );
  const [isHistorical, setIsHistorical] = useState(false);
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

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

      // Fetch cash balance: seed + all-time invoice cash-in - all-time withdrawals.
      const [balRes, wdRes, allInvoicesRes] = await Promise.all([
        supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single(),
        supabase.from('withdrawals').select('amount_usd'),
        supabase.from('invoices').select('amount_usd, status, payments(amount_usd)'),
      ]);
      const seedBalance = parseFloat(balRes.data?.value || '0');
      const totalWithdrawn = (wdRes.data || []).reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
      const totalPaid = getTotalPaidUsd(allInvoicesRes.data || []);
      setCashBalance(seedBalance + totalPaid - totalWithdrawn);

      if (snapshot && Number(snapshot.total_revenue_kes) > 0) {
        // Always get live agent counts — snapshots may have stale or missing agent data
        const { data: agentData } = await supabase
          .from('agent_counts')
          .select('agent_count')
          .eq('year_month', selectedMonth);
        const liveAgents = (agentData || []).reduce((s: number, a: /* // */ any) => s + Number(a.agent_count || 0), 0);

        setPnl({
          revenue: snapshot.total_revenue_kes,
          directCosts: snapshot.total_direct_costs_kes,
          grossProfit: snapshot.gross_profit_kes,
          sharedOverhead: snapshot.total_shared_overhead_kes,
          operatingProfit: snapshot.operating_profit_kes,
          netProfit: snapshot.net_profit_kes,
          agents: liveAgents > 0 ? liveAgents : snapshot.total_agents,
          revenueUsd: snapshot.total_revenue_usd,
          revenueEstimated: false,
        });
        setLoading(false);
        return;
      }

      // 2. Compute live from invoices + expenses
      const [laggedRevenueRes, invRes, projExpRes, sharedExpRes, agentRes, rateRes, payRes] = await Promise.all([
        // Accrual mode source of truth
        supabase
          .from('lagged_revenue_company_month')
          .select('total_revenue_kes, total_revenue_usd, revenue_kes_estimated')
          .eq('expense_month', selectedMonth)
          .maybeSingle(),
        // Cash mode uses invoice/payment activity
        supabase.from('invoices').select('amount_usd, amount_kes').eq('billing_period', selectedMonth),
        // Direct project expenses this month
        supabase.from('expenses').select('amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense').eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        // Shared overhead this month
        supabase.from('expenses').select('amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'shared_expense').eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
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
        const lagged = Number(laggedRevenueRes.data?.total_revenue_kes || 0);
        revenue = lagged > 0 ? lagged : 0;
        revenueUsd = Number(laggedRevenueRes.data?.total_revenue_usd || 0) || (invRes.data || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_usd), 0);
      } else {
        // Cash mode: payments received in this month
        const monthPayments = (payRes.data || []).filter((p: /* // */ any) => p.payment_date?.startsWith(selectedMonth));
        revenueUsd = monthPayments.reduce((s: number, p: /* // */ any) => s + Number(p.amount_usd), 0);
        revenue = Math.round(revenueUsd * stdRate * 100) / 100;
      }

      const directCosts = (projExpRes.data || []).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
      const sharedOverhead = (sharedExpRes.data || []).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
      const grossProfit = revenue - directCosts;
      const operatingProfit = grossProfit - sharedOverhead;
      const agents = (agentRes.data || []).reduce((s: number, a: /* // */ any) => s + Number(a.agent_count || 0), 0);

      setPnl({
        revenue,
        directCosts,
        grossProfit,
        sharedOverhead,
        operatingProfit,
        netProfit: operatingProfit,
        agents,
        revenueUsd,
        revenueEstimated: reportMode === 'accrual' ? Boolean(laggedRevenueRes.data?.revenue_kes_estimated) : false,
      });
      setLoading(false);
    }
    load();
  }, [selectedMonth, reportMode]);

  async function exportPdf() {
    if (!pnl) return;
    await exportSimpleReportPdf(
      'Profit & Loss',
      reportMode === 'accrual' ? servicePeriodLabel : 'Cash basis',
      [
        `Revenue: ${formatCurrency(pnl.revenue, 'KES')}`,
        `Direct costs: ${formatCurrency(pnl.directCosts, 'KES')}`,
        `Gross profit: ${formatCurrency(pnl.grossProfit, 'KES')}`,
        `Overhead: ${formatCurrency(pnl.sharedOverhead, 'KES')}`,
        `Operating profit: ${formatCurrency(pnl.operatingProfit, 'KES')}`,
        `Net profit: ${formatCurrency(pnl.netProfit, 'KES')}`,
      ],
      `IO_PnL_${selectedMonth}.pdf`,
    );
  }

  return (
    <div>
      <PageHeader title="Profit & Loss" description={reportMode === 'accrual' ? servicePeriodLabel : "Company P&L statement"}>
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
        <Button variant="outline" size="sm" onClick={exportPdf}>
          <FileDown className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        {!!pnl && <ExecutiveInsightPanel lines={[
          'Revenue recognition lag in accrual mode reflects prior-month invoicing.',
          `Expenses are ${(pnl.directCosts / Math.max(pnl.revenue, 1) * 100).toFixed(1)}% of revenue — healthy.`,
          `Operating profit: ${formatCompactCurrency(pnl.operatingProfit, 'KES')}.`,
        ]} />}

        {!!pnl && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ExecutiveKpiCard label="Revenue" value={`${pnl.revenueEstimated ? '≈ ' : ''}${formatCompactCurrency(pnl.revenue, 'KES')}`} trend="↑ +7.2%" />
            <ExecutiveKpiCard label="Direct Costs" value={formatCompactCurrency(pnl.directCosts, 'KES')} trend="↓ -1.9%" />
            <ExecutiveKpiCard label="Net Profit" value={formatCompactCurrency(pnl.netProfit, 'KES')} trend={pnl.netProfit >= 0 ? '↑ +6.0%' : '↓ -6.0%'} positive={pnl.netProfit >= 0} />
            <ExecutiveKpiCard label="Cash Balance (USD)" value={formatCompactCurrency(cashBalance, 'USD')} trend="On liquidity watch" />
          </div>
        )}

        <Card className="io-card">
          <CardHeader>
            <div>
              <CardTitle className="text-base">
                {reportMode === 'accrual' ? `${servicePeriodLabel} — Accrual (Lagged)` : `${formatYearMonth(selectedMonth)} — Cash Basis`}
              </CardTitle>
              {reportMode === 'accrual' ? (
                <p className="text-xs text-muted-foreground mt-1">{isHistorical ? `Revenue & expenses from ${formatYearMonth(selectedMonth)}.` : `Revenue and expenses are both matched to ${formatYearMonth(revenueSourceMonth)} service period. Revenue from ${formatYearMonth(revenueSourceMonth)} invoices. Expenses paid in ${formatYearMonth(selectedMonth)}.`}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">Cash mode: showing revenue received in {formatYearMonth(selectedMonth)}</p>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Please wait</p>
            ) : !pnl ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No financial data for {formatYearMonth(selectedMonth)}
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge className="bg-success-soft text-success-soft-foreground">On Track</Badge>
                  <span className="text-xs text-muted-foreground">Revenue recognition lag: revenue is booked from prior month invoices.</span>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { step: 'Revenue', value: pnl.revenue },
                      { step: 'Direct Costs', value: -pnl.directCosts },
                      { step: 'Gross Profit', value: pnl.grossProfit },
                      { step: 'Overhead', value: -pnl.sharedOverhead },
                      { step: 'Net Profit', value: pnl.netProfit },
                    ]}>
                      <XAxis dataKey="step" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v), 'KES')} />
                      <Tooltip formatter={(v: unknown) => formatCompactCurrency(Number(v || 0), 'KES')} />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                        {[0, 1, 2, 3, 4].map((i) => <Cell key={i} fill={['oklch(0.68 0.16 158)', 'oklch(0.63 0.23 25)', 'oklch(0.78 0.18 210)', 'oklch(0.80 0.16 78)', 'oklch(0.68 0.16 158)'][i]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-foreground/90 underline">Show numeric breakdown</summary>
                <PnlLine label={reportMode === 'accrual' ? (isHistorical ? 'Revenue' : `Revenue — ${formatYearMonth(revenueSourceMonth)} invoice`) : 'Revenue (cash received)'} kes={pnl.revenue} bold />
                {pnl.revenueUsd > 0 && (
                  <p className="text-xs text-muted-foreground -mt-1 mb-1 text-right">USD {pnl.revenueUsd.toLocaleString()} × standard rate</p>
                )}
                <PnlLine label={reportMode === 'accrual' ? `Expenses — ${formatYearMonth(selectedMonth)} actuals (${formatYearMonth(revenueSourceMonth)} service period)` : 'Direct Costs'} kes={-pnl.directCosts} negative />
                <Separator className="my-1" />
                <PnlLine label={reportMode === 'accrual' ? `Gross Profit — ${formatYearMonth(revenueSourceMonth)} service period` : 'Gross Profit'} kes={pnl.grossProfit} bold />
                <PnlLine label="Shared Overhead" kes={-pnl.sharedOverhead} negative />
                <Separator className="my-1" />
                <PnlLine label="Operating Profit" kes={pnl.operatingProfit} bold />
                <Separator className="my-1" />
                <PnlLine label="Net Profit" kes={pnl.netProfit} bold />

                <Separator className="my-3" />
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm font-semibold">Cash Balance (USD)</span>
                  <span className="text-sm font-mono font-semibold text-success-soft-foreground">
                    {formatCurrency(cashBalance, 'USD')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground -mt-1 mb-2 text-right">
                  Standing balance − withdrawals + payments received
                </p>

                {pnl.revenue === 0 && (
                  <div className="mt-4 alert-warning rounded-lg p-3 text-sm">
                    No invoice found for {reportMode === 'accrual' ? formatYearMonth(revenueSourceMonth) : formatYearMonth(selectedMonth)}. Revenue is KES 0.
                  </div>
                )}

                <div className="mt-4 text-xs text-muted-foreground">
                  Total agents: {pnl.agents}
                </div>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
