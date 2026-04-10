'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  FileText,
  ArrowRight,
  Eye,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { HeroCard } from '@/components/layout/hero-card';
import { CfoMiscApproval } from '@/components/misc/cfo-misc-approval';
import { OutstandingReceivablesPanel } from '@/components/revenue/outstanding-receivables-panel';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';
import type { RedFlag, BudgetVersion, MonthlyFinancialSnapshot } from '@/types/database';
import { getActiveRedFlags } from '@/lib/queries/red-flags';

export function CfoDashboard() {
  const [snapshot, setSnapshot] = useState<MonthlyFinancialSnapshot | null>(null);
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [pendingBudgets, setPendingBudgets] = useState<(BudgetVersion & { budget_name?: string })[]>([]);
  const [eodLogs, setEodLogs] = useState</* // */ any[]>([]);
  const [healthScores, setHealthScores] = useState</* // */ any[]>([]);
  const [bankBalance, setBankBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const periodMonth = currentMonth + '-01';
      // Calculate previous month for lagged revenue
      const prevDate = new Date(parseInt(currentMonth.split('-')[0]), parseInt(currentMonth.split('-')[1]) - 2, 1);
      const prevMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

      const [snapshotRes, flagsRes, budgetsRes, eodRes, healthRes, laggedInvRes, expenseRes, rateRes, agentCountRes] = await Promise.all([
        supabase
          .from('monthly_financial_snapshots')
          .select('*')
          .eq('year_month', currentMonth)
          .single(),
        getActiveRedFlags(supabase, 10),
        supabase
          .from('budget_versions')
          .select('*, budgets(project_id, department_id, year_month)')
          .in('status', ['submitted', 'under_review'])
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('eod_reports')
          .select('*, users(full_name)')
          .order('report_date', { ascending: false })
          .limit(30),
        supabase
          .from('project_health_scores')
          .select('*, projects(name)')
          .eq('period_month', periodMonth)
          .order('score', { ascending: true }),
        // Lagged revenue: previous month's invoices
        supabase
          .from('invoices')
          .select('amount_usd, amount_kes')
          .eq('billing_period', prevMonth),
        // Current month expenses
        supabase
          .from('expenses')
          .select('amount_kes')
          .eq('year_month', currentMonth),
        // Standard exchange rate
        supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'standard_exchange_rate')
          .single(),
        // Agent counts for current month
        supabase
          .from('agent_counts')
          .select('agent_count')
          .eq('year_month', currentMonth),
      ]);

      // Build live snapshot if DB snapshot is empty
      const stdRate = parseFloat(rateRes.data?.value || '129.5');
      const laggedRevUsd = (laggedInvRes.data || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_usd), 0);
      const laggedRevKes = (laggedInvRes.data || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_kes), 0);
      // Convert USD to KES using standard exchange rate
      const revenueKes = laggedRevKes > 0 ? laggedRevKes : Math.round(laggedRevUsd * stdRate * 100) / 100;
      const totalExpKes = (expenseRes.data || []).reduce((s: number, e: /* // */ any) => s + Number(e.amount_kes), 0);
      const totalAgents = (agentCountRes.data || []).reduce((s: number, a: /* // */ any) => s + Number(a.agent_count || 0), 0);

      // Use live data if no snapshot, or if snapshot revenue is 0
      const liveSnapshot = snapshotRes.data && Number(snapshotRes.data.total_revenue_kes) > 0
        ? { ...snapshotRes.data, total_agents: snapshotRes.data.total_agents || totalAgents }
        : {
            ...snapshotRes.data,
            total_revenue_kes: revenueKes,
            total_revenue_usd: laggedRevUsd,
            total_direct_costs_kes: totalExpKes,
            gross_profit_kes: revenueKes - totalExpKes,
            operating_profit_kes: revenueKes - totalExpKes,
            net_profit_kes: revenueKes - totalExpKes,
            total_agents: totalAgents,
          };

      setSnapshot(liveSnapshot);

      // Get bank balance (standing balance minus all withdrawals)
      const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
      const standingBalance = parseFloat(balSetting?.value || '0');
      const { data: allWithdrawals } = await supabase.from('withdrawals').select('amount_usd');
      const totalWithdrawn = (allWithdrawals || []).reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
      setBankBalance(standingBalance - totalWithdrawn);

      setRedFlags(flagsRes.data || []);
      setPendingBudgets(budgetsRes.data || []);
      setEodLogs((eodRes.data || []).map((r: /* // */ any) => ({
        ...r,
        sender_name: r.users?.full_name || (r.trigger_type === 'auto' ? 'System' : '—'),
      })));
      setHealthScores((healthRes.data || []).map((h: /* // */ any) => ({
        ...h,
        project_name: h.projects?.name || '—',
      })));

      setLoading(false);
    }

    loadData();
  }, [currentMonth]);

  const [viewingEod, setViewingEod] = useState<any | null>(null);

  const severityColor = {
    low: 'bg-blue-100 text-blue-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-orange-100 text-orange-700',
    critical: 'bg-red-100 text-red-700',
  };

  // Lagged revenue source month
  const prevDate = new Date(parseInt(currentMonth.split('-')[0]), parseInt(currentMonth.split('-')[1]) - 2, 1);
  const revenueSourceMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div>
      <div className="p-6 space-y-6">
        {/* Hero Card */}
        <HeroCard stats={[
          { label: 'Bank Balance', value: formatCurrency(bankBalance, 'USD'), subtitle: 'Available after withdrawals' },
          { label: 'Revenue (Lagged)', value: snapshot ? formatCurrency(snapshot.total_revenue_kes, 'KES') : '--', subtitle: 'From ' + formatYearMonth(revenueSourceMonth) + ' invoice' },
          { label: 'Operating Profit', value: snapshot ? formatCurrency(snapshot.operating_profit_kes, 'KES') : '--', subtitle: formatYearMonth(currentMonth) },
          { label: 'Total Agents', value: snapshot ? String(snapshot.total_agents || 0) : '--', subtitle: formatYearMonth(currentMonth) },
          { label: 'Red Flags', value: String(redFlags.length), subtitle: redFlags.length > 0 ? 'Requires attention' : 'All clear' },
        ]} />


        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Red Flags */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Red Flags</CardTitle>
              <Link href="/red-flags">
                <Button variant="ghost" size="sm" className="gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {redFlags.length === 0 ? (
                <p className="text-sm text-neutral-500 py-4 text-center">No active red flags</p>
              ) : (
                <div className="space-y-2">
                  {redFlags.map((flag) => (
                    <div
                      key={flag.id}
                      className="flex items-start gap-3 rounded-md border p-3"
                    >
                      <Badge variant="secondary" className={severityColor[flag.severity]}>
                        {flag.severity}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{flag.title}</p>
                        {flag.description && (
                          <p className="text-xs text-neutral-500 truncate">{flag.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Budget Approval Queue */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Budget Approval Queue</CardTitle>
              <Link href="/budgets">
                <Button variant="ghost" size="sm" className="gap-1">
                  View all <ArrowRight className="h-3 w-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {pendingBudgets.length === 0 ? (
                <p className="text-sm text-neutral-500 py-4 text-center">No pending budgets</p>
              ) : (
                <div className="space-y-2">
                  {pendingBudgets.map((bv) => (
                    <div
                      key={bv.id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          v{bv.version_number}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {formatCurrency(bv.total_amount_kes, 'KES')}
                        </p>
                      </div>
                      <Badge variant={bv.status === 'submitted' ? 'default' : 'secondary'}>
                        {bv.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Project Health Summary */}
        {healthScores.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Project Health Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {healthScores.map((h: /* // */ any) => (
                  <div key={h.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{h.score_band === 'healthy' ? '🟢' : h.score_band === 'watch' ? '🟡' : '🔴'}</span>
                      <div>
                        <p className="text-sm font-medium">{h.project_name}</p>
                        <p className="text-xs text-neutral-500">{h.biggest_drag || 'On track'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{Math.round(h.score)}</p>
                      <p className="text-xs text-neutral-400">/ 100</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Outstanding Receivables */}
        <OutstandingReceivablesPanel />

        {/* Expense Queue Summary */}
        <ExpenseQueuePanel />

        {/* Accountant Misc Requests & Reports */}
        <CfoMiscApproval />

        {/* EOD Report Log */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">EOD Report Log (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {eodLogs.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">No EOD reports sent yet</p>
            ) : (
              <div className="space-y-1.5">
                {eodLogs.map((log: /* // */ any) => (
                  <div key={log.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-medium w-24">{log.report_date}</span>
                      <span className="text-neutral-500">{log.sender_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-neutral-400">
                        {log.created_at ? new Date(log.created_at).toLocaleTimeString('en-US', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'} EAT
                      </span>
                      <Badge variant="secondary" className={
                        log.trigger_type === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-700'
                      }>
                        {log.trigger_type}
                      </Badge>
                      {log.slack_status === 'failed' ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-700">Sent</Badge>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewingEod(log)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* EOD Report Viewer Modal */}
        {viewingEod && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setViewingEod(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between bg-[#0f172a] text-white px-6 py-4 rounded-t-xl">
                <div>
                  <h3 className="font-semibold">EOD Report — {viewingEod.report_date}</h3>
                  <p className="text-xs text-slate-300 mt-0.5">Sent by {viewingEod.sender_name} | {viewingEod.trigger_type}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/20" onClick={() => setViewingEod(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {viewingEod.payload?.message ? (
                  <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-slate-700">{viewingEod.payload.message}</pre>
                ) : (
                  <div className="space-y-4">
                    {/* Fallback: render from payload data */}
                    {viewingEod.payload?.expenses?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">Expenses Logged ({viewingEod.expense_count})</h4>
                        {viewingEod.payload.expenses.map((e: /* // */ any, i: number) => (
                          <p key={i} className="text-sm text-slate-600 ml-3">
                            • {(e as /* // */ any).projects?.name || 'Shared'} — {(e as /* // */ any).expense_categories?.name || '—'} — KES {Number(e.amount_kes).toLocaleString()} — {e.description}
                          </p>
                        ))}
                      </div>
                    )}
                    {viewingEod.payload?.withdrawals?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">Withdrawals ({viewingEod.withdrawal_count})</h4>
                        {viewingEod.payload.withdrawals.map((w: /* // */ any, i: number) => (
                          <p key={i} className="text-sm text-slate-600 ml-3">
                            • {w.director_tag} — USD {Number(w.amount_usd).toLocaleString()} @ {Number(w.exchange_rate).toFixed(2)} = KES {Number(w.amount_kes).toLocaleString()} — {w.forex_bureau || '—'}
                          </p>
                        ))}
                      </div>
                    )}
                    {viewingEod.payload?.budget_actions?.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">Budget Actions ({viewingEod.budget_action_count})</h4>
                        {viewingEod.payload.budget_actions.map((b: /* // */ any, i: number) => (
                          <p key={i} className="text-sm text-slate-600 ml-3">
                            • {(b as /* // */ any).budgets?.projects?.name || (b as /* // */ any).budgets?.departments?.name || '—'} — {b.status}
                          </p>
                        ))}
                      </div>
                    )}
                    {!viewingEod.payload && (
                      <p className="text-sm text-slate-400 text-center py-4">No report data available</p>
                    )}
                  </div>
                )}
              </div>
              <div className="border-t px-6 py-3 flex justify-between items-center bg-slate-50 rounded-b-xl">
                <span className="text-xs text-slate-400">
                  {viewingEod.expense_count || 0} expenses | {viewingEod.withdrawal_count || 0} withdrawals | {viewingEod.budget_action_count || 0} budget actions
                </span>
                <Badge className={viewingEod.slack_status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}>
                  Slack: {viewingEod.slack_status}
                </Badge>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
