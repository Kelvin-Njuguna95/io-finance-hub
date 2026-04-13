'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { WithdrawalFormDialog } from '@/components/withdrawals/withdrawal-form-dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, ArrowDownToLine, TrendingUp, AlertTriangle, Wallet, FileText, DollarSign, Receipt, Pencil } from 'lucide-react';
import type { Withdrawal } from '@/types/database';

interface BudgetSummaryRow {
  scope: string;
  scope_type: 'project' | 'department';
  status: string;
  total_usd: number;
  total_kes: number;
}

interface InvoiceSummary {
  total_invoiced_usd: number;
  total_paid_usd: number;
  total_pending_usd: number;
}

export default function WithdrawalsPage() {
  const { user } = useUser();
  const [withdrawals, setWithdrawals] = useState<(Withdrawal & { projects?: { name: string } | null })[]>([]);
  const [budgetSummaries, setBudgetSummaries] = useState<BudgetSummaryRow[]>([]);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary>({ total_invoiced_usd: 0, total_paid_usd: 0, total_pending_usd: 0 });
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showDialog, setShowDialog] = useState(false);
  const [editingWithdrawal, setEditingWithdrawal] = useState<(Withdrawal & { projects?: { name: string } | null }) | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [legacyRecordCount, setLegacyRecordCount] = useState(0);
  const [fixingLegacy, setFixingLegacy] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Load withdrawals (join projects for company_operations rows)
      const { data: wData } = await supabase
        .from('withdrawals')
        .select('*, projects(name)')
        .eq('year_month', selectedMonth)
        .order('withdrawal_date', { ascending: false });
      setWithdrawals((wData || []) as (Withdrawal & { projects?: { name: string } | null })[]);
      const legacyCount = (wData || []).filter((w: any) => !w.withdrawal_type).length;
      setLegacyRecordCount(legacyCount);

      // Load budgets
      const { data: bData } = await supabase
        .from('budgets')
        .select(`
          id, project_id, department_id,
          projects(name), departments(name),
          budget_versions(status, total_amount_usd, total_amount_kes, version_number)
        `)
        .eq('year_month', selectedMonth);

      const summaries: BudgetSummaryRow[] = (bData || []).map((b: /* // */ any) => {
        const versions = b.budget_versions || [];
        const approved = versions.find((v: /* // */ any) => v.status === 'approved');
        const latest = approved || versions.sort((a: /* // */ any, b: /* // */ any) => b.version_number - a.version_number)[0];
        return {
          scope: b.projects?.name || b.departments?.name || '—',
          scope_type: b.project_id ? 'project' : 'department',
          status: latest?.status || 'draft',
          total_usd: Number(latest?.total_amount_usd || 0),
          total_kes: Number(latest?.total_amount_kes || 0),
        };
      });
      setBudgetSummaries(summaries);

      // Load ALL invoices up to and including selected month (cumulative view)
      const { data: allInvoices } = await supabase
        .from('invoices')
        .select('id, amount_usd, status, billing_period, payments(amount_usd)')
        .lte('billing_period', selectedMonth);

      const totalInvoiced = (allInvoices || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_usd), 0);
      const totalPaid = (allInvoices || []).reduce((s: number, i: /* // */ any) => {
        const paymentTotal = (i.payments || []).reduce((ps: number, p: /* // */ any) => ps + Number(p.amount_usd), 0);
        const paid = i.status === 'paid' ? Math.max(Number(i.amount_usd), paymentTotal) : paymentTotal;
        return s + paid;
      }, 0);

      setInvoiceSummary({
        total_invoiced_usd: totalInvoiced,
        total_paid_usd: totalPaid,
        total_pending_usd: totalInvoiced - totalPaid,
      });

      // Bank balance (standing minus ALL withdrawals, not just this month)
      const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
      const standingBal = parseFloat(balSetting?.value || '0');
      const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
      const totalAllTimeWd = (allWd || []).reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
      setBankBalance(standingBal - totalAllTimeWd);
    }
    load();
  }, [selectedMonth]);

  const totalWithdrawnUsd = withdrawals.reduce((s, w) => s + Number(w.amount_usd), 0);
  const totalReceivedKes = withdrawals.reduce((s, w) => s + Number(w.amount_kes), 0);
  const totalVariance = withdrawals.reduce((s, w) => s + Number(w.variance_kes || 0), 0);

  // Approved budget totals (KES)
  const approvedBudgets = budgetSummaries.filter(b => b.status === 'approved');
  const totalApprovedKes = approvedBudgets.reduce((s, b) => s + b.total_kes, 0);

  // Pending withdrawal in KES = approved budget KES - already received KES
  const pendingWithdrawalKes = totalApprovedKes - totalReceivedKes;

  // Average exchange rate
  const avgRate = withdrawals.length > 0
    ? withdrawals.reduce((s, w) => s + Number(w.exchange_rate), 0) / withdrawals.length
    : 0;

  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

  async function handleFixLegacy() {
    setFixingLegacy(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/withdrawals/fix-legacy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        },
      });
      const result = await res.json();
      if (result.success) {
        window.location.reload();
      } else if (result.manual_required) {
        alert('The withdrawal_type column needs to be added manually in the Supabase dashboard. Run this SQL:\n\nALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_type text;\n\nThen click Fix Now again to backfill the data.');
      } else {
        alert(`Failed to fix legacy records: ${result.error || 'Unknown error'}`);
      }
    } catch {
      alert('Error fixing legacy records');
    } finally {
      setFixingLegacy(false);
    }
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-foreground/90',
    submitted: 'bg-blue-100 text-blue-700',
    under_review: 'bg-warning-soft text-warning-soft-foreground',
    approved: 'bg-success-soft text-success-soft-foreground',
    rejected: 'bg-danger-soft text-danger-soft-foreground',
  };

  return (
    <div>
      <PageHeader title="Withdrawals" description="USD withdrawals and forex tracking">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        {canCreate && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> New Withdrawal
          </Button>
        )}
      </PageHeader>

      <WithdrawalFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => { setShowDialog(false); window.location.reload(); }}
      />
      <WithdrawalFormDialog
        open={showEditDialog}
        onClose={() => {
          setShowEditDialog(false);
          setEditingWithdrawal(null);
        }}
        onSaved={() => {
          setShowEditDialog(false);
          setEditingWithdrawal(null);
          window.location.reload();
        }}
        editData={editingWithdrawal}
      />

      <div className="p-6 space-y-6">
        {/* Bank balance + Budget & Withdrawal stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="Bank Balance"
            value={formatCurrency(bankBalance, 'USD')}
            subtitle={'This month withdrawn: ' + formatCurrency(totalWithdrawnUsd, 'USD')}
            icon={Wallet}
          />
          <StatCard
            title="Approved Budget"
            value={formatCurrency(totalApprovedKes, 'KES')}
            subtitle="Total approved for this month"
            icon={FileText}
          />
          <StatCard
            title="Pending Withdrawal"
            value={formatCurrency(Math.max(pendingWithdrawalKes, 0), 'KES')}
            subtitle={pendingWithdrawalKes < 0 ? 'Over-withdrawn!' : 'Remaining to withdraw'}
            icon={Wallet}
          />
          <StatCard
            title="Withdrawn (USD)"
            value={formatCurrency(totalWithdrawnUsd, 'USD')}
            subtitle={`Received: ${formatCurrency(totalReceivedKes, 'KES')}`}
            icon={ArrowDownToLine}
          />
          <StatCard
            title="Avg Exchange Rate"
            value={avgRate > 0 ? new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(avgRate) : '—'}
            subtitle={avgRate > 0 ? 'USD 1 = KES ' + new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(avgRate) : 'No withdrawals yet'}
            icon={TrendingUp}
          />
        </div>

        {/* Invoice summary row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Total Invoiced (USD)"
            value={formatCurrency(invoiceSummary.total_invoiced_usd, 'USD')}
            icon={Receipt}
          />
          <StatCard
            title="Invoices Paid (USD)"
            value={formatCurrency(invoiceSummary.total_paid_usd, 'USD')}
            icon={DollarSign}
          />
          <StatCard
            title="Invoices Pending (USD)"
            value={formatCurrency(invoiceSummary.total_pending_usd, 'USD')}
            subtitle={invoiceSummary.total_pending_usd > 0 ? 'Awaiting payment' : ''}
            icon={AlertTriangle}
          />
        </div>

        {/* Over budget warning */}
        {pendingWithdrawalKes < 0 && (
          <Card className="border-danger/30 bg-danger-soft/50">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-danger-soft-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-danger-soft-foreground">Over Budget Warning</p>
                <p className="text-sm text-danger-soft-foreground">
                  Withdrawals exceed approved budgets by {formatCurrency(Math.abs(pendingWithdrawalKes), 'KES')}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Budget Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Budget Summary — {formatYearMonth(selectedMonth)}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount (KES)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgetSummaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                      No budgets submitted for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {budgetSummaries.map((b, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{b.scope}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{capitalize(b.scope_type)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColors[b.status] || ''}>
                            {capitalize(b.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(b.total_kes, 'KES')}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/50">
                      <TableCell colSpan={3} className="text-right">Total (All Budgets)</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(budgetSummaries.reduce((s, b) => s + b.total_kes, 0), 'KES')}
                      </TableCell>
                    </TableRow>
                    <TableRow className="font-semibold text-success-soft-foreground bg-success-soft/50">
                      <TableCell colSpan={3} className="text-right">Approved Only</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalApprovedKes, 'KES')}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {legacyRecordCount > 0 && user?.role === 'cfo' && (
          <Card className="border-warning/30 bg-warning-soft/50">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-warning-soft-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium text-warning-soft-foreground">Legacy Data Detected</p>
                  <p className="text-sm text-warning-soft-foreground">
                    {legacyRecordCount} withdrawal record{legacyRecordCount > 1 ? 's' : ''} missing type classification. Fix to enable accurate editing.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-warning/50 text-warning-soft-foreground hover:bg-warning-soft"
                onClick={handleFixLegacy}
                disabled={fixingLegacy}
              >
                {fixingLegacy ? 'Fixing...' : 'Fix Now'}
              </Button>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Withdrawal History */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Withdrawal History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">KES Received</TableHead>
                  <TableHead>Bureau</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Variance (KES)</TableHead>
                  {user?.role === 'cfo' && <TableHead className="w-[80px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {withdrawals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={user?.role === 'cfo' ? 11 : 10} className="text-center py-8 text-muted-foreground">
                      No withdrawals for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {withdrawals.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>{formatDate(w.withdrawal_date)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      w.withdrawal_type === 'operations' || w.purpose === 'company_operations'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-violet-soft/50 text-violet-soft-foreground'
                    }`}>
                      {w.withdrawal_type === 'operations' || w.purpose === 'company_operations'
                        ? (w.projects?.name || 'Company Ops')
                        : (w.director_name || w.director_tag || 'Director')}
                    </span>
                  </TableCell>
                        <TableCell>
                          {w.withdrawal_type === 'director_payout' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-soft text-warning-soft-foreground border border-warning/30">
                              Director Payout
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                              Operations
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {w.withdrawal_type === 'director_payout' ? (
                            <div>
                              <p className="font-medium text-sm">{w.director_name || 'Director'} — Profit Share Payout</p>
                              <p className="text-xs text-muted-foreground">
                                {w.payout_type === 'full' ? 'Full payout' : 'Partial payout'} · {formatYearMonth(w.withdrawal_date.slice(0, 7))}
                              </p>
                            </div>
                          ) : (
                            w.purpose === 'company_operations'
                              ? w.projects?.name || 'Company Ops'
                              : capitalize(w.director_tag || '')
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(Number(w.amount_usd), 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(w.exchange_rate))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(Number(w.amount_kes), 'KES')}
                        </TableCell>
                        <TableCell className="text-sm">{w.forex_bureau || '—'}</TableCell>
                        <TableCell className="text-sm">{w.reference_id || '—'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {w.variance_kes ? formatCurrency(Number(w.variance_kes), 'KES') : '—'}
                        </TableCell>
                        {user?.role === 'cfo' && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditingWithdrawal(w);
                                setShowEditDialog(true);
                              }}
                            >
                              <Pencil className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold bg-muted/50">
                      <TableCell colSpan={3} className="text-right">Totals</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalWithdrawnUsd, 'USD')}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{avgRate > 0 ? `Avg: ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(avgRate)}` : ''}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalReceivedKes, 'KES')}</TableCell>
                      <TableCell colSpan={2}></TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalVariance, 'KES')}</TableCell>
                      {user?.role === 'cfo' && <TableCell />}
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
