'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, formatDate, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getLaggedMonth, getUnifiedServicePeriodLabel } from '@/lib/report-utils';
import { TrendingUp, DollarSign, Receipt, Users, AlertTriangle, CheckCircle, Target } from 'lucide-react';

interface FinancialData {
  project_name: string;
  year_month: string;
  health: { score: number; score_band: string; biggest_drag: string | null; budget_score: number; margin_score: number; };
  revenue: { invoice_amount: number; invoice_status: string; total_paid: number; outstanding: number; invoice_date: string; billing_period: string; revenue_source_month?: string; };
  expenses: { total: number; by_category: { name: string; amount: number; pct: number }[]; items: /* // */ /* // */ any[]; };
  budget: { total: number; utilisation: number; variance: number; items: /* // */ /* // */ any[]; has_approved: boolean; };
  agents: { count: number; revenue_per_agent: number; cost_per_agent: number; contribution_per_agent: number; };
  trends: { year_month: string; revenue: number; expenses: number; contribution: number; agents: number; margin: number; }[];
  hints: { icon: string; text: string; severity: string; }[];
}

export default function FinancialsPage() {
  const { user } = useUser();
  const [data, setData] = useState<FinancialData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const serviceMonth = getLaggedMonth(selectedMonth);
  const servicePeriodLabel = getUnifiedServicePeriodLabel(selectedMonth);

  useEffect(() => {
    if (!user) return;
    async function getProject() {
      const supabase = createClient();
      if (user!.role === 'team_leader') {
        const { data: assignments } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', user!.id);
        if (assignments?.[0]) setProjectId(assignments[0].project_id);
      }
    }
    getProject();
  }, [user]);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId, selectedMonth]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch(`/api/project-financials?project_id=${projectId}&year_month=${selectedMonth}`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const result = await res.json();
    if (!res.ok) { setLoading(false); return; }
    setData(result);
    setLoading(false);
  }

  if (!data && !loading) {
    return (
      <div>
        <PageHeader title="Project Financials" description="No project assigned" />
        <div className="p-6 text-center text-muted-foreground">No project assigned to your account.</div>
      </div>
    );
  }

  const d = data;
  const healthColor = d?.health.score_band === 'healthy' ? 'text-green-600 bg-green-50 border-green-200' : d?.health.score_band === 'watch' ? 'text-amber-600 bg-amber-50 border-amber-200' : 'text-red-600 bg-red-50 border-red-200';
  const healthEmoji = d?.health.score_band === 'healthy' ? '🟢' : d?.health.score_band === 'watch' ? '🟡' : '🔴';

  return (
    <div>
      <PageHeader title={d ? `${d.project_name} — Financial Overview` : 'Please wait'} description={servicePeriodLabel}>
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const dt = new Date(); dt.setMonth(dt.getMonth() - i);
              const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      {loading ? (
        <div className="p-6 text-center text-muted-foreground">Loading financial data...</div>
      ) : d && (
        <div className="p-6 space-y-6">
          {/* SECTION 1: Health Score */}
          <Card className={`border ${healthColor}`}>
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                <span className="text-3xl">{healthEmoji}</span>
                <div>
                  <p className="text-2xl font-bold">{d.health.score} <span className="text-sm font-normal text-muted-foreground">/ 100</span></p>
                  <p className="text-sm font-medium capitalize">{d.health.score_band.replace('_', ' ')}</p>
                </div>
              </div>
              <p className="text-sm text-foreground/80 max-w-md text-right">
                {d.health.biggest_drag ? `${d.health.biggest_drag} is the main area to improve.` : 'Project is tracking well across all indicators.'}
              </p>
            </CardContent>
          </Card>

          {/* SECTION 2: Revenue (Lagged) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Revenue — {formatYearMonth(serviceMonth)} invoice</CardTitle>
              <p className="text-xs text-muted-foreground">Service period: {formatYearMonth(serviceMonth)}. Paid in: {formatYearMonth(selectedMonth)}.</p>
            </CardHeader>
            <CardContent>
              {d.revenue.invoice_amount === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No invoice for {formatYearMonth(d.revenue.revenue_source_month || '')} — revenue is KES 0 for this period.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Invoice Raised</p><p className="text-lg font-semibold">{formatCurrency(d.revenue.invoice_amount, 'KES')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status</p><Badge variant="secondary" className={d.revenue.invoice_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>{d.revenue.invoice_status}</Badge></div>
                  <div><p className="text-xs text-muted-foreground">Payment Received</p><p className="text-lg font-semibold">{formatCurrency(d.revenue.total_paid, 'KES')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Outstanding (USD)</p><p className={`text-lg font-semibold ${d.revenue.outstanding > 0 ? 'text-red-600' : ''}`}>{formatCurrency(d.revenue.outstanding, 'USD')}</p></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION 3: Expenses */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Expenses — {formatYearMonth(selectedMonth)} actuals ({formatYearMonth(serviceMonth)} service period)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Total Expenses</p><p className="text-lg font-semibold">{formatCurrency(d.expenses.total, 'KES')}</p></div>
                <div><p className="text-xs text-muted-foreground">Approved Budget</p><p className="text-lg font-semibold">{formatCurrency(d.budget.total, 'KES')}</p></div>
                <div><p className="text-xs text-muted-foreground">Variance</p><p className={`text-lg font-semibold ${d.budget.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(d.budget.variance, 'KES')}</p></div>
                <div><p className="text-xs text-muted-foreground">Utilisation</p><Badge variant="secondary" className={d.budget.utilisation > 100 ? 'bg-red-100 text-red-700' : d.budget.utilisation > 90 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>{formatPercent(d.budget.utilisation)}</Badge></div>
              </div>
              {d.expenses.by_category.length > 0 && (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount (KES)</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.expenses.by_category.slice(0, 5).map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(c.amount, 'KES')}</TableCell>
                        <TableCell className="text-right text-sm">{formatPercent(c.pct)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* SECTION 4: Budget Performance */}
          {d.budget.has_approved && d.budget.items.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Budget Performance — Line Items</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Line Item</TableHead>
                    <TableHead className="text-right">Budgeted</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.budget.items.map((item: /* // */ any) => {
                      const budgeted = Number(item.amount_kes);
                      const spent = 0; // Would need per-line-item expense matching
                      const remaining = budgeted - spent;
                      const pct = budgeted > 0 ? (spent / budgeted * 100) : 0;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.description}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(budgeted, 'KES')}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(spent, 'KES')}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatCurrency(remaining, 'KES')}</TableCell>
                          <TableCell>{pct > 100 ? '🔴 Over' : pct > 85 ? '🟡 Watch' : '🟢 OK'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* SECTION 6: Agent Productivity */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Agent Productivity</CardTitle></CardHeader>
            <CardContent>
              {d.agents.count === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Agent count not entered for {formatYearMonth(selectedMonth)}. Enter agent count to see productivity metrics.</p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Agents</p><p className="text-lg font-semibold">{d.agents.count}</p></div>
                  <div><p className="text-xs text-muted-foreground">Revenue per Agent</p><p className="text-lg font-semibold">{formatCurrency(d.agents.revenue_per_agent, 'KES')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Cost per Agent</p><p className="text-lg font-semibold">{formatCurrency(d.agents.cost_per_agent, 'KES')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Contribution per Agent</p><p className={`text-lg font-semibold ${d.agents.contribution_per_agent < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(d.agents.contribution_per_agent, 'KES')}</p></div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION 7: Month-on-Month Trend */}
          {d.trends.length >= 2 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Month-on-Month Trend (Last 6 Months)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Contribution</TableHead>
                    <TableHead className="text-right">Agents</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {d.trends.map((t) => (
                      <TableRow key={t.year_month}>
                        <TableCell className="font-medium">{formatYearMonth(t.year_month)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(t.revenue, 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(t.expenses, 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${t.contribution < 0 ? 'text-red-600' : ''}`}>{formatCurrency(t.contribution, 'KES')}</TableCell>
                        <TableCell className="text-right">{t.agents || '—'}</TableCell>
                        <TableCell className="text-right">{formatPercent(t.margin)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* SECTION 8: Financial Hints */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Financial Hints</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {d.hints.map((h, i) => (
                  <div key={i} className={`flex items-start gap-3 rounded-md p-3 ${h.severity === 'critical' ? 'bg-red-50 border border-red-200' : h.severity === 'warning' ? 'bg-amber-50 border border-amber-200' : h.severity === 'positive' ? 'bg-green-50 border border-green-200' : 'bg-muted/50 border'}`}>
                    <span className="text-lg shrink-0">{h.icon}</span>
                    <p className="text-sm">{h.text}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
