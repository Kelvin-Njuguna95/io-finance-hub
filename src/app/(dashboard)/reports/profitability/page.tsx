'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency, formatExecutivePercent } from '@/components/reports/executive-kit';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { isBackdated } from '@/lib/backdated-utils';
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

interface ProjectRow {
  project_name: string;
  revenue: number;
  direct_costs: number;
  gross_profit: number;
  margin: number;
}

export default function ProfitabilityPage() {
  const [data, setData] = useState<ProjectRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);
  const [revenueSourceMonth, setRevenueSourceMonth] = useState('');
  const [isHistorical, setIsHistorical] = useState(false);
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Detect if this is a historical (seeded) month — use direct matching instead of lag
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('data_source')
        .eq('year_month', selectedMonth)
        .single();

      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      setIsHistorical(historical);

      // Revenue source: same month for historical, previous month for live
      let revMonth: string;
      if (historical) {
        revMonth = selectedMonth;
      } else {
        const prevDate = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 2, 1);
        revMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');
      }
      setRevenueSourceMonth(revMonth);

      // Get all active projects
      const { data: projects } = await supabase.from('projects').select('id, name').eq('is_active', true).order('name');

      // Get standard exchange rate
      const { data: rateSetting } = await supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
      const stdRate = parseFloat(rateSetting?.value || '129.5');

      // Get invoices for the revenue source month
      const { data: invoices } = await supabase.from('invoices').select('project_id, amount_usd, amount_kes, description').eq('billing_period', revMonth);

      // Get direct expenses (current month) for all projects
      const { data: expenses } = await supabase.from('expenses').select('project_id, amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense');

      // Build per-project map
      const invMap = new Map<string, number>();
      (invoices || []).filter((i: /* // */ any) => !isBackdated(i.description)).forEach((i: /* // */ any) => {
        const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
        invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
      });

      const expMap = new Map<string, number>();
      (expenses || []).forEach((e: /* // */ any) => {
        expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
      });

      // Build rows — only include projects that have revenue or expenses
      const rows: ProjectRow[] = (projects || [])
        .map((p: /* // */ any) => {
          const revenue = invMap.get(p.id) || 0;
          const directCosts = expMap.get(p.id) || 0;
          const grossProfit = revenue - directCosts;
          const margin = revenue > 0 ? (grossProfit / revenue * 100) : 0;
          return { project_name: p.name, revenue, direct_costs: directCosts, gross_profit: grossProfit, margin };
        })
        .filter(r => r.revenue > 0 || r.direct_costs > 0)
        .sort((a, b) => b.gross_profit - a.gross_profit);

      setData(rows);
      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
  const totalCosts = data.reduce((s, r) => s + r.direct_costs, 0);
  const totalProfit = data.reduce((s, r) => s + r.gross_profit, 0);
  const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Project Profitability',
      isHistorical ? `Historical month ${selectedMonth}` : servicePeriodLabel,
      data.slice(0, 120).map((r) => `${r.project_name} | revenue ${r.revenue.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | costs ${r.direct_costs.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | margin ${r.margin.toFixed(1)}%`),
      `IO_Project_Profitability_${selectedMonth}.pdf`,
    );
  }

  return (
    <div>
      <PageHeader title="Project Profitability" description={isHistorical ? 'Revenue & Expenses from ' + formatYearMonth(selectedMonth) + ' (historical data)' : servicePeriodLabel}>
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
        <ExecutiveInsightPanel lines={[
          `Gross profit: ${formatCompactCurrency(totalProfit, 'KES')}.`,
          data.length <= 1 ? 'All profit concentrated in 1 project — diversify.' : '',
          `Margin benchmark set at 40%; ${data.filter((r) => r.margin >= 40).length} project(s) are above target.`,
        ]} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveKpiCard label="Gross Profit" value={formatCompactCurrency(totalProfit, 'KES')} trend="↑ +6.1%" />
          <ExecutiveKpiCard label="Gross Margin" value={formatExecutivePercent(totalMargin)} trend={totalMargin >= 40 ? '↑ Above target' : '↓ Below target'} positive={totalMargin >= 40} />
          <ExecutiveKpiCard label="Active Projects" value={String(data.length)} trend="Stable" />
          <ExecutiveKpiCard label="Best Margin Project" value={data[0] ? `${data[0].project_name} ${formatExecutivePercent(data[0].margin)}` : 'N/A'} trend="Top performer" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(loading ? [] : data).map((r) => (
            <Card key={r.project_name} className="border-border">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold">{r.project_name}</p>
                  <Badge className={r.margin >= 40 ? 'bg-emerald-100 text-emerald-700' : r.margin >= 25 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}>
                    {r.margin >= 40 ? 'On Track' : r.margin >= 25 ? 'Watch' : 'Action Needed'}
                  </Badge>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (r.revenue <= 0 ? 0 : (r.gross_profit / r.revenue) * 100))}%` }} />
                </div>
                <div className="flex items-center justify-between text-sm text-foreground/80">
                  <span>Revenue {formatCompactCurrency(r.revenue, 'KES')}</span>
                  <span>Costs {formatCompactCurrency(r.direct_costs, 'KES')}</span>
                </div>
                <p className="text-sm font-medium">Margin: {formatExecutivePercent(r.margin)} <span className="text-muted-foreground">| Target: 40%</span></p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
