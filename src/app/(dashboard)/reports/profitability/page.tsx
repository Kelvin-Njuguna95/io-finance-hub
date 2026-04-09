'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RoleInsightBoard } from '@/components/reports/role-insight-board';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { isBackdated } from '@/lib/backdated-utils';

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
      (invoices || []).filter((i: any) => !isBackdated(i.description)).forEach((i: any) => {
        const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
        invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
      });

      const expMap = new Map<string, number>();
      (expenses || []).forEach((e: any) => {
        expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
      });

      // Build rows — only include projects that have revenue or expenses
      const rows: ProjectRow[] = (projects || [])
        .map((p: any) => {
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

  return (
    <div>
      <PageHeader title="Project Profitability" description={isHistorical ? 'Revenue & Expenses from ' + formatYearMonth(selectedMonth) + ' (historical data)' : 'Revenue from ' + formatYearMonth(revenueSourceMonth) + ' invoice | Expenses from ' + formatYearMonth(selectedMonth)}>
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

      <div className="p-6 space-y-6">
        <RoleInsightBoard
          insights={[
            {
              role: 'PM',
              headline: totalMargin >= 30 ? 'Project margins are holding well.' : 'Project margins are below preferred band.',
              items: [
                `Portfolio gross margin: ${formatPercent(totalMargin)}.`,
                `Highest gross profit project: ${data[0]?.project_name || 'N/A'}.`,
                `Loss-making projects: ${data.filter((r) => r.gross_profit < 0).length}.`,
              ],
            },
            {
              role: 'Team Lead',
              headline: 'Use project margin ranking to prioritize action plans.',
              items: [
                `Projects in active set: ${data.length}.`,
                `Total direct costs: ${formatCurrency(totalCosts, 'KES')}.`,
                `Revenue source period: ${isHistorical ? formatYearMonth(selectedMonth) : formatYearMonth(revenueSourceMonth)}.`,
              ],
            },
            {
              role: 'Accountant',
              headline: 'Revenue-to-cost bridge is visible by project in one ledger.',
              items: [
                `Total revenue: ${formatCurrency(totalRevenue, 'KES')}.`,
                `Total gross profit: ${formatCurrency(totalProfit, 'KES')}.`,
                `Current month actual cost booking: ${formatYearMonth(selectedMonth)}.`,
              ],
            },
            {
              role: 'CFO',
              headline: totalProfit >= 0 ? 'Portfolio gross profitability is positive.' : 'Portfolio gross profitability is negative.',
              items: [
                `Gross profit pool: ${formatCurrency(totalProfit, 'KES')}.`,
                `Profit concentration in top 3 projects: ${formatCurrency(data.slice(0, 3).reduce((s, r) => s + r.gross_profit, 0), 'KES')}.`,
                `Strategic focus: improve negative-margin projects first.`,
              ],
            },
          ]}
        />

        <Card className="io-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Revenue (KES)</TableHead>
                  <TableHead className="text-right">Direct Costs (KES)</TableHead>
                  <TableHead className="text-right">Gross Profit (KES)</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-neutral-400">Loading...</TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-neutral-500">
                      No project data for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {data.map((r) => (
                      <TableRow key={r.project_name}>
                        <TableCell className="font-medium">{r.project_name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(r.revenue, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-600">
                          {formatCurrency(r.direct_costs, 'KES')}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm font-semibold ${r.gross_profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatCurrency(r.gross_profit, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatPercent(r.margin)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-slate-50">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalRevenue, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono text-red-600">{formatCurrency(totalCosts, 'KES')}</TableCell>
                      <TableCell className={`text-right font-mono ${totalProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(totalProfit, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono">{formatPercent(totalMargin)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
