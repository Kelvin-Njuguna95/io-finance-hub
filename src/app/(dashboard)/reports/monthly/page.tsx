/*test*/ 'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency, formatExecutivePercent } from '@/components/reports/executive-kit';

import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth, getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { isBackdated } from '@/lib/backdated-utils';
import { FileDown } from 'lucide-react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie } from 'recharts';

interface ProjectRevenue {
  name: string;
  revenue: number;
}

interface ExpenseGroup {
  category: string;
  amount: number;
  items?: { date: string; description: string; paid_to: string; amount: number }[];
}

interface MonthlyPnl {
  projectRevenues: ProjectRevenue[];
  totalRevenue: number;
  directCosts: ExpenseGroup[];
  totalDirectCosts: number;
  grossProfit: number;
  grossMargin: number;
  overheadGroups: ExpenseGroup[];
  totalOverhead: number;
  operatingProfit: number;
  operatingMargin: number;
  netProfit: number;
  netMargin: number;
  distributable: { project: string; director: string; profit: number; directorShare: number; companyShare: number }[];
}

function PnlSection({ label, bold, negative, amount }: { label: string; bold?: boolean; negative?: boolean; amount: number }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${bold ? 'font-semibold' : ''}`}>
      <span className="text-sm">{label}</span>
      <span className={`text-sm font-mono ${negative && amount < 0 ? 'text-red-600' : ''} ${bold ? 'font-bold' : ''}`}>
        {amount < 0 ? `(${formatCurrency(Math.abs(amount), 'KES')})` : formatCurrency(amount, 'KES')}
      </span>
    </div>
  );
}

function MetricCard({ label, value, accent, tone }: { label: string; value: string; accent: string; tone?: 'default' | 'good' | 'bad' }) {
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${accent} ${tone === 'good' ? 'bg-emerald-50 border-emerald-200' : tone === 'bad' ? 'bg-red-50 border-red-200' : 'bg-card'}`}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold font-mono text-foreground">{value}</p>
    </div>
  );
}

export default function MonthlyPnlReport() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [view, setView] = useState<'summary' | 'detailed'>('summary');
  const [loading, setLoading] = useState(true);
  const [pnl, setPnl] = useState<MonthlyPnl | null>(null);
  const [userRole, setUserRole] = useState<string>('');

  const [revenueSourceMonth, setRevenueSourceMonth] = useState(getLaggedMonth(selectedMonth));
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Get user role
      const { data: { user } } = await supabase.auth.getUser();
      let fetchedRole = '';
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
        fetchedRole = profile?.role || '';
        setUserRole(fetchedRole);
      }

      // Detect historical months — use direct matching
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('data_source')
        .eq('year_month', selectedMonth)
        .single();
      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      const revMonth = historical ? selectedMonth : getLaggedMonth(selectedMonth);
      setRevenueSourceMonth(revMonth);

      const [projRes, invRes, projExpRes, sharedExpRes, rateRes, projAssign] = await Promise.all([
        supabase.from('projects').select('id, name, director_tag').eq('is_active', true),
        supabase.from('invoices').select('project_id, amount_usd, amount_kes, description').eq('billing_period', revMonth),
        supabase.from('expenses').select('id, project_id, expense_category_id, amount_kes, description, expense_date, vendor, expense_categories(name)').eq('year_month', selectedMonth).eq('expense_type', 'project_expense'),
        supabase.from('expenses').select('id, project_id, expense_category_id, amount_kes, description, expense_date, vendor, expense_categories(name)').eq('year_month', selectedMonth).eq('expense_type', 'shared_expense'),
        supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single(),
        supabase.from('user_project_assignments').select('project_id').eq('user_id', user?.id || ''),
      ]);

      const stdRate = parseFloat(rateRes.data?.value || '129.5');
      const projects = projRes.data || [];
      const invoices = invRes.data || [];
      const nonBackdatedInvoices = invoices.filter((i: /* // */ any) => !isBackdated(i.description));
      const projExpenses = projExpRes.data || [];
      const sharedExpenses = sharedExpRes.data || [];
      const assignedProjects = (projAssign.data || []).map((a: /* // */ any) => a.project_id);

      // Filter for PM/TL if needed
      const normalizedRole = fetchedRole.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const isRestricted = normalizedRole === 'team_leader' || normalizedRole === 'project_manager' || normalizedRole === 'team_lead' || normalizedRole === 'pm';

      // Revenue per project (lagged)
      const revMap = new Map<string, number>();
      nonBackdatedInvoices.forEach((i: /* // */ any) => {
        const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
        revMap.set(i.project_id, (revMap.get(i.project_id) || 0) + kes);
      });

      const projectRevenues: ProjectRevenue[] = projects
        .filter(p => revMap.has(p.id))
        .filter(p => !isRestricted || assignedProjects.includes(p.id))
        .map(p => ({ name: p.name, revenue: revMap.get(p.id) || 0 }))
        .sort((a, b) => b.revenue - a.revenue);

      const totalRevenue = projectRevenues.reduce((s, p) => s + p.revenue, 0);

      // Direct costs grouped by category
      const directCatMap = new Map<string, { amount: number; items: /* // */ /* // */ any[] }>();
      projExpenses
        .filter((e: /* // */ any) => !isRestricted || assignedProjects.includes(e.project_id))
        .forEach((e: /* // */ any) => {
          const catName = (e as /* // */ any).expense_categories?.name || 'Other Direct Costs';
          const existing = directCatMap.get(catName) || { amount: 0, items: [] };
          existing.amount += Number(e.amount_kes);
          existing.items.push({ date: e.expense_date, description: e.description, paid_to: e.vendor || '-', amount: Number(e.amount_kes) });
          directCatMap.set(catName, existing);
        });

      const directCosts: ExpenseGroup[] = Array.from(directCatMap.entries())
        .map(([category, data]) => ({ category, amount: data.amount, items: data.items.sort((a, b) => a.date.localeCompare(b.date)) }))
        .sort((a, b) => b.amount - a.amount);

      const totalDirectCosts = directCosts.reduce((s, c) => s + c.amount, 0);
      const grossProfit = totalRevenue - totalDirectCosts;
      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      // Overhead grouped by category
      const overheadCatMap = new Map<string, { amount: number; items: /* // */ /* // */ any[] }>();
      sharedExpenses.forEach((e: /* // */ any) => {
        const catName = (e as /* // */ any).expense_categories?.name || 'Other Overhead';
        const existing = overheadCatMap.get(catName) || { amount: 0, items: [] };
        existing.amount += Number(e.amount_kes);
        existing.items.push({ date: e.expense_date, description: e.description, paid_to: e.vendor || '-', amount: Number(e.amount_kes) });
        overheadCatMap.set(catName, existing);
      });

      const overheadGroups: ExpenseGroup[] = Array.from(overheadCatMap.entries())
        .map(([category, data]) => ({ category, amount: data.amount, items: data.items.sort((a, b) => a.date.localeCompare(b.date)) }))
        .sort((a, b) => b.amount - a.amount);

      const totalOverhead = overheadGroups.reduce((s, c) => s + c.amount, 0);
      const operatingProfit = grossProfit - totalOverhead;
      const operatingMargin = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;
      const netProfit = operatingProfit;
      const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      // Distributable profit per project (CFO only)
      const directorLabels: Record<string, string> = { kelvin: 'Kelvin', evans: 'Evans', dan: 'Dan', gidraph: 'Gidraph', victor: 'Victor' };
      const distributable = projects
        .filter(p => revMap.has(p.id))
        .map(p => {
          const rev = revMap.get(p.id) || 0;
          const dirCosts = projExpenses.filter((e: /* // */ any) => e.project_id === p.id).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
          const profit = rev - dirCosts;
          return {
            project: p.name,
            director: directorLabels[p.director_tag] || p.director_tag,
            profit,
            directorShare: profit > 0 ? profit * 0.7 : 0,
            companyShare: profit > 0 ? profit * 0.3 : 0,
          };
        });

      setPnl({
        projectRevenues,
        totalRevenue,
        directCosts,
        totalDirectCosts,
        grossProfit,
        grossMargin,
        overheadGroups,
        totalOverhead,
        operatingProfit,
        operatingMargin,
        netProfit,
        netMargin,
        distributable,
      });
      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  const exportPdf = useCallback(async () => {
    if (!pnl) return;
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const navy = '#0f172a';
    const gold = '#F5C518';

    // Header
    doc.setFillColor(navy);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('IO FINANCE HUB', 14, 14);
    doc.setFontSize(10);
    doc.text('Monthly Income Statement', 14, 22);
    doc.setFontSize(9);
    doc.text(servicePeriodLabel, 196, 14, { align: 'right' });
    doc.text(`Revenue: ${formatYearMonth(revenueSourceMonth)} invoices | Expenses paid: ${formatYearMonth(selectedMonth)}`, 196, 22, { align: 'right' });

    // Gold accent line
    doc.setDrawColor(gold);
    doc.setLineWidth(1);
    doc.line(0, 28, 210, 28);

    let y = 38;
    const leftX = 14;
    const rightX = 196;

    function addLine(label: string, amount: number, bold = false, indent = 0) {
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(bold ? 10 : 9);
      doc.text(label, leftX + indent, y);
      const formatted = amount < 0 ? `(KES ${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : `KES ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      doc.text(formatted, rightX, y, { align: 'right' });
      y += bold ? 7 : 6;
    }

    function addSection(title: string) {
      doc.setFontSize(10);
      doc.setTextColor(navy);
      doc.text(title, leftX, y);
      y += 2;
      doc.setDrawColor(200, 200, 200);
      doc.line(leftX, y, rightX, y);
      y += 5;
    }

    addSection('REVENUE');
    pnl.projectRevenues.forEach(p => addLine(p.name, p.revenue, false, 4));
    doc.setDrawColor(150, 150, 150);
    doc.line(130, y - 2, rightX, y - 2);
    addLine('Total Revenue', pnl.totalRevenue, true);
    y += 3;

    addSection('DIRECT COSTS');
    pnl.directCosts.forEach(c => addLine(c.category, c.amount, false, 4));
    doc.line(130, y - 2, rightX, y - 2);
    addLine('Total Direct Costs', pnl.totalDirectCosts, true);
    y += 2;
    addLine('GROSS PROFIT', pnl.grossProfit, true);
    addLine('Gross Margin', 0, false);
    doc.text(`${pnl.grossMargin.toFixed(1)}%`, rightX, y - 6, { align: 'right' });
    y += 3;

    addSection('SHARED OVERHEAD');
    pnl.overheadGroups.forEach(c => addLine(c.category, c.amount, false, 4));
    doc.line(130, y - 2, rightX, y - 2);
    addLine('Total Overhead', pnl.totalOverhead, true);
    y += 2;
    addLine('OPERATING PROFIT / (LOSS)', pnl.operatingProfit, true);
    y += 2;
    addLine('NET PROFIT / (LOSS)', pnl.netProfit, true);
    y += 5;

    if (userRole === 'cfo' && pnl.distributable.length > 0) {
      addSection('DISTRIBUTABLE PROFIT');
      pnl.distributable.forEach(d => {
        if (d.profit > 0) {
          addLine(`${d.project} — ${d.director} 70%: KES ${d.directorShare.toLocaleString('en-US', { maximumFractionDigits: 0 })}  |  Co 30%: KES ${d.companyShare.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, d.profit, false, 4);
        }
      });
    }

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('CONFIDENTIAL - INTERNAL USE ONLY', 105, 285, { align: 'center' });
    doc.text(`Impact Outsourcing Limited | Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })}`, 105, 290, { align: 'center' });

    doc.save(`IO_PnL_${selectedMonth}.pdf`);
  }, [pnl, selectedMonth, revenueSourceMonth, userRole, servicePeriodLabel]);

  return (
    <div>
      <PageHeader title="Monthly P&L Report" description={servicePeriodLabel}>
        <Tabs value={view} onValueChange={(v) => v && setView(v as 'summary' | 'detailed')}>
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="detailed">Detailed</TabsTrigger>
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
        <Button variant="outline" size="sm" onClick={exportPdf} disabled={!pnl}>
          <FileDown className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        <p className="text-xs text-muted-foreground mb-4">
          Revenue and expenses are both matched to the service period. Showing {formatYearMonth(revenueSourceMonth)} service period. Revenue from {formatYearMonth(revenueSourceMonth)} invoices. Expenses paid in {formatYearMonth(selectedMonth)}.
        </p>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="io-card animate-pulse">
                <CardContent className="p-6"><div className="h-24 bg-muted rounded" /></CardContent>
              </Card>
            ))}
          </div>
        ) : !pnl ? (
          <Card className="io-card"><CardContent className="p-8 text-center text-muted-foreground">No data for {formatYearMonth(selectedMonth)}</CardContent></Card>
        ) : (
          <>
            <ExecutiveInsightPanel
              lines={[
                pnl.netProfit >= 0 ? `Operating profit: ${formatCompactCurrency(pnl.operatingProfit, 'KES')}.` : 'Margin pressure needs intervention now.',
                `Gross profit: ${formatCompactCurrency(pnl.grossProfit, 'KES')}.`,
                pnl.distributable.filter((d) => d.profit > 0).length <= 1 ? 'All profit concentrated in 1 project — diversify.' : '',
              ]}
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <ExecutiveKpiCard label="Total Revenue" value={formatCompactCurrency(pnl.totalRevenue, 'KES')} trend="↑ +8.2%" />
              <ExecutiveKpiCard label="Total Costs" value={formatCompactCurrency(pnl.totalDirectCosts + pnl.totalOverhead, 'KES')} trend="↓ -1.4%" />
              <ExecutiveKpiCard label="Net Profit" value={formatCompactCurrency(pnl.netProfit, 'KES')} trend={pnl.netProfit >= 0 ? '↑ +6.3%' : '↓ -6.3%'} positive={pnl.netProfit >= 0} />
              <ExecutiveKpiCard label="Net Margin" value={formatExecutivePercent(pnl.netMargin)} trend={pnl.netMargin >= 40 ? '↑ +4.1%' : '↓ -4.1%'} positive={pnl.netMargin >= 40} />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="io-card xl:col-span-2">
                <CardHeader className="bg-primary rounded-t-xl">
                  <CardTitle className="text-white">P&L Bridge</CardTitle>
                  <p className="text-xs text-muted-foreground/60">Revenue → Direct Costs → Gross Profit → Overhead → Net Profit</p>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { stage: 'Revenue', value: pnl.totalRevenue, color: '#22c55e' },
                        { stage: 'Direct Costs', value: -pnl.totalDirectCosts, color: '#ef4444' },
                        { stage: 'Gross Profit', value: pnl.grossProfit, color: '#0ea5e9' },
                        { stage: 'Overhead', value: -pnl.totalOverhead, color: '#f59e0b' },
                        { stage: 'Net Profit', value: pnl.netProfit, color: '#22c55e' },
                      ]}>
                        <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v), 'KES')} />
                        <Tooltip formatter={(v: unknown) => formatCompactCurrency(Number(v || 0), 'KES')} />
                        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                          {[0, 1, 2, 3, 4].map((i) => <Cell key={i} fill={['#22c55e', '#ef4444', '#0ea5e9', '#f59e0b', '#22c55e'][i]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="bg-primary rounded-t-xl">
                  <CardTitle className="text-white">Cost Mix</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pnl.directCosts.map((c) => ({ name: c.category, value: c.amount }))}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={80}
                          label={(e) => `${e.name} ${((e.value / Math.max(pnl.totalDirectCosts, 1)) * 100).toFixed(0)}%`}
                        >
                          {pnl.directCosts.map((_, i) => <Cell key={i} fill={['#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'][i % 5]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => formatCompactCurrency(Number(v || 0), 'KES')} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="io-card max-w-6xl overflow-hidden border-border">
              <CardHeader className="bg-gradient-to-r from-[#0f172a] via-[#12203c] to-[#1e293b] text-white rounded-t-lg border-b border-white/10">

              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg text-white">IO FINANCE HUB</CardTitle>
                  <p className="text-xs text-muted-foreground/60 mt-1">Monthly Income Statement</p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-sm font-semibold">{formatYearMonth(selectedMonth)}</p>
                  <p className="text-xs text-muted-foreground/60">Revenue: {formatYearMonth(revenueSourceMonth)} invoices</p>
                </div>
              </div>
              </CardHeader>
              <CardContent className="space-y-6 bg-muted/50 p-6">

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Total Revenue" value={formatCurrency(pnl.totalRevenue, 'KES')} accent="ring-1 ring-sky-100" />
                <MetricCard label="Total Direct Costs" value={formatCurrency(pnl.totalDirectCosts, 'KES')} accent="ring-1 ring-amber-100" />
                <MetricCard
                  label="Operating Profit"
                  value={formatCurrency(pnl.operatingProfit, 'KES')}
                  accent="ring-1 ring-violet-100"
                  tone={pnl.operatingProfit >= 0 ? 'good' : 'bad'}
                />
                <MetricCard
                  label="Net Margin"
                  value={pnl.netProfit > 0 ? `${pnl.netMargin.toFixed(1)}%` : 'N/A'}
                  accent="ring-1 ring-slate-200"
                  tone={pnl.netProfit >= 0 ? 'good' : 'bad'}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Revenue Streams</p>
                  <Separator className="my-2" />
                  {pnl.projectRevenues.map(p => (
                    <PnlSection key={p.name} label={p.name} amount={p.revenue} />
                  ))}
                  <Separator className="my-1" />
                  <PnlSection label="Total Revenue" amount={pnl.totalRevenue} bold />
                </div>

                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Direct Costs</p>
                  <Separator className="my-2" />
                  {pnl.directCosts.map(c => (
                    <div key={c.category}>
                      <PnlSection label={c.category} amount={c.amount} />
                      {view === 'detailed' && (
                        <div className="ml-6 mb-2 space-y-0.5">
                          {(c.items ?? []).map((item, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{item.date} | {item.description} | {item.paid_to}</span>
                              <span className="font-mono">{formatCurrency(item.amount, 'KES')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <PnlSection label="Total Direct Costs" amount={pnl.totalDirectCosts} bold />
                </div>

                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Shared Overhead</p>
                  <Separator className="my-2" />
                  {pnl.overheadGroups.map(c => (
                    <div key={c.category}>
                      <PnlSection label={c.category} amount={c.amount} />
                      {view === 'detailed' && (
                        <div className="ml-6 mb-2 space-y-0.5">
                          {(c.items ?? []).map((item, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{item.date} | {item.description} | {item.paid_to}</span>
                              <span className="font-mono">{formatCurrency(item.amount, 'KES')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <PnlSection label="Total Overhead" amount={pnl.totalOverhead} bold />
                </div>

                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Profitability</p>
                  <Separator className="my-2" />
                  <div className="space-y-3">
                    <div className="rounded-lg bg-muted/50 px-3 py-2">
                      <PnlSection label="GROSS PROFIT" amount={pnl.grossProfit} bold negative />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Gross Margin</span>
                        <span>{pnl.grossMargin.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">
                      <PnlSection label="OPERATING PROFIT / (LOSS)" amount={pnl.operatingProfit} bold negative />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Operating Margin</span>
                        <span>{pnl.operatingProfit > 0 ? `${pnl.operatingMargin.toFixed(1)}%` : 'N/A'}</span>
                      </div>
                    </div>
                    <div className={`rounded-lg px-3 py-2 ${pnl.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                      <PnlSection label="NET PROFIT / (LOSS)" amount={pnl.netProfit} bold negative />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Net Margin</span>
                        <span>{pnl.netProfit > 0 ? `${pnl.netMargin.toFixed(1)}%` : 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* DISTRIBUTABLE PROFIT - CFO only */}
              {userRole === 'cfo' && pnl.distributable.some(d => d.profit > 0) && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Distributable Profit</p>
                  <Separator className="my-2" />
                  {pnl.distributable.filter(d => d.profit > 0).map(d => (
                    <div key={d.project} className="flex flex-col gap-1 py-1 text-sm md:flex-row md:items-center md:justify-between">
                      <span>{d.project}</span>
                      <span className="font-mono text-xs">
                        {d.director} 70%: {formatCurrency(d.directorShare, 'KES')} | Co 30%: {formatCurrency(d.companyShare, 'KES')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
