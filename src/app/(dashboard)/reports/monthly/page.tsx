'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth } from '@/lib/report-utils';
import { isBackdated } from '@/lib/backdated-utils';
import { FileDown } from 'lucide-react';

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

export default function MonthlyPnlReport() {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [view, setView] = useState<'summary' | 'detailed'>('summary');
  const [loading, setLoading] = useState(true);
  const [pnl, setPnl] = useState<MonthlyPnl | null>(null);
  const [userRole, setUserRole] = useState<string>('');

  const [revenueSourceMonth, setRevenueSourceMonth] = useState(getLaggedMonth(selectedMonth));
  const [isHistorical, setIsHistorical] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      // Get user role
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
        setUserRole(profile?.role || '');
      }

      // Detect historical months — use direct matching
      const { data: snapshot } = await supabase
        .from('monthly_financial_snapshots')
        .select('data_source')
        .eq('year_month', selectedMonth)
        .single();
      const historical = !!(snapshot?.data_source && snapshot.data_source.startsWith('historical_seed'));
      setIsHistorical(historical);
      const revMonth = historical ? selectedMonth : getLaggedMonth(selectedMonth);
      setRevenueSourceMonth(revMonth);

      const [projRes, invRes, projExpRes, sharedExpRes, rateRes, catRes, projAssign] = await Promise.all([
        supabase.from('projects').select('id, name, director_tag').eq('is_active', true),
        supabase.from('invoices').select('project_id, amount_usd, amount_kes, description').eq('billing_period', revMonth),
        supabase.from('expenses').select('id, project_id, expense_category_id, amount_kes, description, expense_date, vendor, expense_categories(name)').eq('year_month', selectedMonth).eq('expense_type', 'project_expense'),
        supabase.from('expenses').select('id, project_id, expense_category_id, amount_kes, description, expense_date, vendor, expense_categories(name)').eq('year_month', selectedMonth).eq('expense_type', 'shared_expense'),
        supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single(),
        supabase.from('expense_categories').select('id, name'),
        supabase.from('user_project_assignments').select('project_id').eq('user_id', user?.id || ''),
      ]);

      const stdRate = parseFloat(rateRes.data?.value || '129.5');
      const projects = projRes.data || [];
      const invoices = invRes.data || [];
      const nonBackdatedInvoices = invoices.filter((i: any) => !isBackdated(i.description));
      const projExpenses = projExpRes.data || [];
      const sharedExpenses = sharedExpRes.data || [];
      const assignedProjects = (projAssign.data || []).map((a: any) => a.project_id);

      // Filter for PM/TL if needed
      const profile = userRole;
      const isRestricted = profile === 'team_leader' || profile === 'project_manager';

      // Revenue per project (lagged)
      const revMap = new Map<string, number>();
      nonBackdatedInvoices.forEach((i: any) => {
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
      const directCatMap = new Map<string, { amount: number; items: any[] }>();
      projExpenses
        .filter((e: any) => !isRestricted || assignedProjects.includes(e.project_id))
        .forEach((e: any) => {
          const catName = (e as any).expense_categories?.name || 'Other Direct Costs';
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
      const overheadCatMap = new Map<string, { amount: number; items: any[] }>();
      sharedExpenses.forEach((e: any) => {
        const catName = (e as any).expense_categories?.name || 'Other Overhead';
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
          const dirCosts = projExpenses.filter((e: any) => e.project_id === p.id).reduce((s: number, e: any) => s + Number(e.amount_kes), 0);
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
  }, [selectedMonth, userRole]);

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
    doc.text(formatYearMonth(selectedMonth), 196, 14, { align: 'right' });
    doc.text(`Revenue recognition: ${formatYearMonth(revenueSourceMonth)} invoices`, 196, 22, { align: 'right' });

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
  }, [pnl, selectedMonth, revenueSourceMonth, userRole]);

  return (
    <div>
      <PageHeader title="Monthly P&L Report" description="Structured income statement">
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

      <div className="p-6">
        <p className="text-xs text-slate-400 mb-4">
          Revenue shown is from {formatYearMonth(revenueSourceMonth)} invoices. Expenses shown are {formatYearMonth(selectedMonth)} actuals.
        </p>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="io-card animate-pulse">
                <CardContent className="p-6"><div className="h-24 bg-slate-100 rounded" /></CardContent>
              </Card>
            ))}
          </div>
        ) : !pnl ? (
          <Card className="io-card"><CardContent className="p-8 text-center text-slate-400">No data for {formatYearMonth(selectedMonth)}</CardContent></Card>
        ) : (
          <Card className="io-card max-w-3xl">
            <CardHeader className="bg-[#0f172a] text-white rounded-t-lg">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg text-white">IO FINANCE HUB</CardTitle>
                  <p className="text-xs text-slate-300 mt-1">Monthly Income Statement</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{formatYearMonth(selectedMonth)}</p>
                  <p className="text-xs text-slate-300">Revenue: {formatYearMonth(revenueSourceMonth)} invoices</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-1">
              {/* REVENUE */}
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-2">Revenue</p>
              <Separator className="mb-1" />
              {pnl.projectRevenues.map(p => (
                <PnlSection key={p.name} label={p.name} amount={p.revenue} />
              ))}
              <Separator className="my-1" />
              <PnlSection label="Total Revenue" amount={pnl.totalRevenue} bold />

              {/* DIRECT COSTS */}
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-4">Direct Costs</p>
              <Separator className="mb-1" />
              {pnl.directCosts.map(c => (
                <div key={c.category}>
                  <PnlSection label={c.category} amount={c.amount} />
                  {view === 'detailed' && c.items && (
                    <div className="ml-6 mb-2 space-y-0.5">
                      {c.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-400">
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

              {/* GROSS PROFIT */}
              <div className="bg-slate-50 rounded px-3 py-2 mt-2">
                <PnlSection label="GROSS PROFIT" amount={pnl.grossProfit} bold negative />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Gross Margin</span>
                  <span>{pnl.grossMargin.toFixed(1)}%</span>
                </div>
              </div>

              {/* SHARED OVERHEAD */}
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-4">Shared Overhead</p>
              <Separator className="mb-1" />
              {pnl.overheadGroups.map(c => (
                <div key={c.category}>
                  <PnlSection label={c.category} amount={c.amount} />
                  {view === 'detailed' && c.items && (
                    <div className="ml-6 mb-2 space-y-0.5">
                      {c.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-xs text-slate-400">
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

              {/* OPERATING PROFIT */}
              <div className="bg-slate-50 rounded px-3 py-2 mt-2">
                <PnlSection label="OPERATING PROFIT / (LOSS)" amount={pnl.operatingProfit} bold negative />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Operating Margin</span>
                  <span>{pnl.operatingProfit > 0 ? pnl.operatingMargin.toFixed(1) + '%' : 'N/A'}</span>
                </div>
              </div>

              {/* NET PROFIT */}
              <div className={`rounded px-3 py-2 mt-2 ${pnl.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <PnlSection label="NET PROFIT / (LOSS)" amount={pnl.netProfit} bold negative />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Net Margin</span>
                  <span>{pnl.netProfit > 0 ? pnl.netMargin.toFixed(1) + '%' : 'N/A'}</span>
                </div>
              </div>

              {/* DISTRIBUTABLE PROFIT - CFO only */}
              {userRole === 'cfo' && pnl.distributable.some(d => d.profit > 0) && (
                <>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-4">Distributable Profit</p>
                  <Separator className="mb-1" />
                  {pnl.distributable.filter(d => d.profit > 0).map(d => (
                    <div key={d.project} className="flex items-center justify-between py-1 text-sm">
                      <span>{d.project}</span>
                      <span className="font-mono text-xs">
                        {d.director} 70%: {formatCurrency(d.directorShare, 'KES')} | Co 30%: {formatCurrency(d.companyShare, 'KES')}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
