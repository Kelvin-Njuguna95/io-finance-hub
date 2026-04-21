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
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

interface ProjectRow {
  project_name: string;
  revenue: number;
  direct_costs: number;
  gross_profit: number;
  margin: number;
  revenueEstimated: boolean;
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

      // Get lagged revenue by project for the expense month
      const { data: laggedRows } = await supabase
        .from('lagged_revenue_by_project_month')
        .select('project_id, lagged_revenue_kes, revenue_kes_estimated')
        .eq('expense_month', selectedMonth);

      // Get direct expenses (current month) for all projects
      const { data: expenses } = await supabase.from('expenses').select('project_id, amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense').eq('lifecycle_status', 'confirmed');

      // Build per-project map
      const invMap = new Map<string, { amount: number; estimated: boolean }>();
      (laggedRows || []).forEach((row: { project_id: string; lagged_revenue_kes: number | null; revenue_kes_estimated: boolean | null }) => {
        const existing = invMap.get(row.project_id) || { amount: 0, estimated: false };
        invMap.set(row.project_id, {
          amount: existing.amount + Number(row.lagged_revenue_kes || 0),
          estimated: existing.estimated || Boolean(row.revenue_kes_estimated),
        });
      });

      const expMap = new Map<string, number>();
      (expenses || []).forEach((e: /* // */ any) => {
        expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
      });

      // Build rows — only include projects that have revenue or expenses
      const rows: ProjectRow[] = (projects || [])
        .map((p: /* // */ any) => {
          const revenue = invMap.get(p.id)?.amount || 0;
          const directCosts = expMap.get(p.id) || 0;
          const grossProfit = revenue - directCosts;
          const margin = revenue > 0 ? (grossProfit / revenue * 100) : 0;
          return { project_name: p.name, revenue, direct_costs: directCosts, gross_profit: grossProfit, margin, revenueEstimated: invMap.get(p.id)?.estimated || false };
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
  const MIN_REVENUE_FOR_BEST_MARGIN_KES = 50_000;
  const bestMarginProject = [...data]
    .filter((r) => r.revenue >= MIN_REVENUE_FOR_BEST_MARGIN_KES)
    .sort((a, b) => b.margin - a.margin)[0]
    ?? [...data].sort((a, b) => b.margin - a.margin)[0];

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
          <ExecutiveKpiCard label="Gross Profit" value={formatCompactCurrency(totalProfit, 'KES')} />
          <ExecutiveKpiCard label="Gross Margin" value={formatExecutivePercent(totalMargin)} trend={totalMargin >= 40 ? '↑ Above target' : '↓ Below target'} positive={totalMargin >= 40} />
          <ExecutiveKpiCard label="Active Projects" value={String(data.length)} />
          <ExecutiveKpiCard label="Best Margin Project" value={bestMarginProject ? `${bestMarginProject.project_name} ${formatExecutivePercent(bestMarginProject.margin)}` : 'N/A'} trend="Highest margin %" />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(loading ? [] : data).map((r) => (
            <Card key={r.project_name} className="border-border">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold">{r.revenueEstimated ? `≈ ${r.project_name}` : r.project_name}</p>
                  <Badge className={r.margin >= 40 ? 'bg-success-soft text-success-soft-foreground' : r.margin >= 25 ? 'bg-warning-soft text-warning-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}>
                    {r.margin >= 40 ? 'On Track' : r.margin >= 25 ? 'Watch' : 'Action Needed'}
                  </Badge>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, (r.revenue <= 0 ? 0 : (r.gross_profit / r.revenue) * 100))}%` }} />
                </div>
                <div className="flex items-center justify-between text-sm text-foreground/80">
                  <span>Revenue <span className="font-mono tabular-nums">{formatCompactCurrency(r.revenue, 'KES')}</span></span>
                  <span>Costs <span className="font-mono tabular-nums">{formatCompactCurrency(r.direct_costs, 'KES')}</span></span>
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
