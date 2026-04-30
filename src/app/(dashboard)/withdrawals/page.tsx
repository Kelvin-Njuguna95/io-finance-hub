'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { WithdrawalFormDialog } from '@/components/withdrawals/withdrawal-form-dialog';
import { formatCompactKES, formatCurrency, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { getTotalPaidUsd } from '@/lib/cash-balance';
import { Plus, Wallet, FileText, ArrowDownToLine, TrendingUp, Pencil } from 'lucide-react';
import type { Withdrawal } from '@/types/database';

import { FilterPillBar } from '@/app/(dashboard)/misc/_components/FilterPillBar';
import { WithdrawalRow, WithdrawalRowHead } from './_components/WithdrawalRow';
import { OverBudgetBanner } from './_components/OverBudgetBanner';

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

type WithdrawalRowData = Withdrawal & { projects?: { name: string } | null };

type TypeFilter = 'all' | 'director_payout' | 'operations';

function startOfTodayNairobi(): Date {
  const isoDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${isoDate}T00:00:00+03:00`);
}

type DayGroup = { key: string; label: string; rows: WithdrawalRowData[] };

function groupWithdrawalsByDay(rows: WithdrawalRowData[]): DayGroup[] {
  const today = startOfTodayNairobi();
  const ms = 24 * 60 * 60 * 1000;
  const todayMs = today.getTime();
  const startOfWeekMs = todayMs - 6 * ms; // last 7 days, ending today
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();

  const buckets: Record<string, DayGroup> = {
    today: { key: 'today', label: 'Today', rows: [] },
    week: { key: 'week', label: 'Earlier this week', rows: [] },
    month: { key: 'month', label: 'Earlier this month', rows: [] },
    earlier: { key: 'earlier', label: 'Earlier', rows: [] },
  };

  const sorted = [...rows].sort((a, b) =>
    (b.withdrawal_date || '').localeCompare(a.withdrawal_date || ''),
  );

  for (const row of sorted) {
    const ts = new Date(row.withdrawal_date).getTime();
    if (Number.isNaN(ts)) {
      buckets.earlier!.rows.push(row);
      continue;
    }
    if (ts >= todayMs) buckets.today!.rows.push(row);
    else if (ts >= startOfWeekMs) buckets.week!.rows.push(row);
    else if (ts >= startOfMonth) buckets.month!.rows.push(row);
    else buckets.earlier!.rows.push(row);
  }

  return [buckets.today!, buckets.week!, buckets.month!, buckets.earlier!].filter(
    (g) => g.rows.length > 0,
  );
}

export default function WithdrawalsPage() {
  const { user } = useUser();
  const [withdrawals, setWithdrawals] = useState<WithdrawalRowData[]>([]);
  const [budgetSummaries, setBudgetSummaries] = useState<BudgetSummaryRow[]>([]);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary>({ total_invoiced_usd: 0, total_paid_usd: 0, total_pending_usd: 0 });
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showDialog, setShowDialog] = useState(false);
  const [editingWithdrawal, setEditingWithdrawal] = useState<WithdrawalRowData | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const { data: wData } = await supabase
        .from('withdrawals')
        .select('*, projects(name)')
        .eq('year_month', selectedMonth)
        .order('withdrawal_date', { ascending: false });
      setWithdrawals((wData || []) as WithdrawalRowData[]);

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

      const { data: allInvoices } = await supabase
        .from('invoices')
        .select('id, amount_usd, status, billing_period, payments(amount_usd)')
        .lte('billing_period', selectedMonth);

      const totalInvoiced = (allInvoices || []).reduce((s: number, i: /* // */ any) => s + Number(i.amount_usd), 0);
      const totalPaid = getTotalPaidUsd(allInvoices || []);

      setInvoiceSummary({
        total_invoiced_usd: totalInvoiced,
        total_paid_usd: totalPaid,
        total_pending_usd: totalInvoiced - totalPaid,
      });

      // Bank balance: seed + all-time payments received - all-time withdrawals.
      const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
      const seedBalance = parseFloat(balSetting?.value || '0');
      const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
      const totalAllTimeWd = (allWd || []).reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
      const { data: allInvoicesEver } = await supabase
        .from('invoices')
        .select('amount_usd, status, payments(amount_usd)');
      const totalPaymentsReceived = getTotalPaidUsd(allInvoicesEver || []);
      setBankBalance(seedBalance + totalPaymentsReceived - totalAllTimeWd);
    }
    load();
  }, [selectedMonth]);

  const totalWithdrawnUsd = withdrawals.reduce((s, w) => s + Number(w.amount_usd), 0);
  const totalReceivedKes = withdrawals.reduce((s, w) => s + Number(w.amount_kes), 0);
  const totalVariance = withdrawals.reduce((s, w) => s + Number(w.variance_kes || 0), 0);

  const approvedBudgets = budgetSummaries.filter((b) => b.status === 'approved');
  const totalApprovedKes = approvedBudgets.reduce((s, b) => s + b.total_kes, 0);
  const pendingWithdrawalKes = totalApprovedKes - totalReceivedKes;

  const avgRate = withdrawals.length > 0
    ? withdrawals.reduce((s, w) => s + Number(w.exchange_rate), 0) / withdrawals.length
    : 0;

  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';
  const isCfo = user?.role === 'cfo';

  const directorPayoutCount = withdrawals.filter((w) => w.withdrawal_type === 'director_payout').length;
  const operationsCount = withdrawals.filter((w) => w.withdrawal_type === 'operations').length;

  const typeFilterPills = [
    { key: 'all' as const, label: 'All', count: withdrawals.length },
    { key: 'director_payout' as const, label: 'Director Payout', count: directorPayoutCount },
    { key: 'operations' as const, label: 'Operations', count: operationsCount },
  ];

  const filteredWithdrawals = useMemo(
    () =>
      typeFilter === 'all'
        ? withdrawals
        : withdrawals.filter((w) => w.withdrawal_type === typeFilter),
    [withdrawals, typeFilter],
  );

  const grouped = useMemo(
    () => groupWithdrawalsByDay(filteredWithdrawals),
    [filteredWithdrawals],
  );

  const statusColors: Record<string, string> = {
    draft: 'bg-muted text-foreground/90',
    submitted: 'bg-blue-100 text-blue-700',
    under_review: 'bg-warning-soft text-warning-soft-foreground',
    approved: 'bg-success-soft text-success-soft-foreground',
    rejected: 'bg-danger-soft text-danger-soft-foreground',
  };

  const monthSelect = (
    <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
      <SelectTrigger className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 12 }, (_, i) => {
          const d = new Date();
          d.setMonth(d.getMonth() - i);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      {canCreate && (
        <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
          <Plus className="h-4 w-4" /> Request withdrawal
        </Button>
      )}
    </div>
  );

  const subtitle = `${formatYearMonth(selectedMonth)} · ${withdrawals.length} recorded · ${formatCompactKES(totalReceivedKes)} drawn`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Withdrawals &"
        accent="director draws"
        subtitle={subtitle}
        action={headerActions}
      />

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

      <div className="mt-6 space-y-6">
        {/* 4-card KPI strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={`Drawn · ${formatYearMonth(selectedMonth)}`}
            value={formatCompactKES(totalReceivedKes)}
            subtitle={`${withdrawals.length} withdrawal${withdrawals.length === 1 ? '' : 's'} · ${formatCurrency(totalWithdrawnUsd, 'USD')}${avgRate > 0 ? ` · avg ${avgRate.toFixed(2)}` : ''}`}
            icon={ArrowDownToLine}
            tone="brand"
          />
          <StatCard
            title="Approved budget"
            value={formatCompactKES(totalApprovedKes)}
            subtitle={`${approvedBudgets.length} approved · ${budgetSummaries.length} total`}
            icon={FileText}
            tone="brand"
          />
          <StatCard
            title="Pending withdrawal"
            value={
              pendingWithdrawalKes < 0
                ? formatCompactKES(Math.abs(pendingWithdrawalKes))
                : formatCompactKES(Math.max(0, pendingWithdrawalKes))
            }
            subtitle={pendingWithdrawalKes < 0 ? 'Over budget' : 'Remaining headroom'}
            icon={TrendingUp}
            tone={pendingWithdrawalKes < 0 ? 'danger' : 'warning'}
          />
          <StatCard
            title="Bank balance"
            value={formatCurrency(bankBalance, 'USD')}
            subtitle={avgRate > 0 ? `≈ ${formatCompactKES(bankBalance * avgRate)}` : 'After withdrawals'}
            icon={Wallet}
            tone="brand"
          />
        </div>

        {pendingWithdrawalKes < 0 && (
          <OverBudgetBanner
            overByKes={Math.abs(pendingWithdrawalKes)}
            approvedBudgetKes={totalApprovedKes}
            drawnKes={totalReceivedKes}
          />
        )}

        {/* Type filter pills */}
        <FilterPillBar
          pills={typeFilterPills}
          activeKey={typeFilter}
          onChange={(k) => setTypeFilter(k)}
        />

        {/* Withdrawal list */}
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <WithdrawalRowHead />
          {filteredWithdrawals.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {typeFilter === 'all'
                ? `No withdrawals for ${formatYearMonth(selectedMonth)}.`
                : `No ${typeFilterPills.find((p) => p.key === typeFilter)?.label.toLowerCase() || ''} withdrawals for this month.`}
            </div>
          ) : (
            grouped.map((group) => {
              const groupTotalKes = group.rows.reduce((s, r) => s + Number(r.amount_kes || 0), 0);
              return (
                <Fragment key={group.key}>
                  <div className="flex items-baseline gap-3 border-y border-border-subtle bg-[var(--paper-2)] px-5 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    <span className="text-foreground">{group.label}</span>
                    <span aria-hidden>—</span>
                    <span className="tabular-nums text-foreground">{formatCompactKES(groupTotalKes)}</span>
                    <span className="ml-auto">
                      {group.rows.length} withdrawal{group.rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {group.rows.map((w) => (
                    <WithdrawalRow
                      key={w.id}
                      withdrawal={w}
                      actions={
                        isCfo ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              setEditingWithdrawal(w);
                              setShowEditDialog(true);
                            }}
                          >
                            <Pencil className="mr-1 size-3" />
                            Edit
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </Fragment>
              );
            })
          )}
        </div>

        {/* List footer total — variance roll-up */}
        {filteredWithdrawals.length > 0 && (
          <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
            <span>
              Showing {filteredWithdrawals.length} of {withdrawals.length} · variance{' '}
              <span className={totalVariance !== 0 ? 'text-[var(--danger)]' : 'text-foreground'}>
                {formatCompactKES(totalVariance)}
              </span>
            </span>
            <span className="tabular-nums text-foreground">{formatCompactKES(totalReceivedKes)}</span>
          </div>
        )}

        {/* Budget Summary — kept; lightly rethemed */}
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="border-b border-border bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Budget Summary · {formatYearMonth(selectedMonth)}
          </div>
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
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3} className="text-right">Total (All Budgets)</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(budgetSummaries.reduce((s, b) => s + b.total_kes, 0), 'KES')}
                    </TableCell>
                  </TableRow>
                  <TableRow className="bg-success-soft/50 font-semibold text-success-soft-foreground">
                    <TableCell colSpan={3} className="text-right">Approved Only</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(totalApprovedKes, 'KES')}</TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </section>

        {/* Invoice summary footnote — kept compact, since the invoice cumulative
            fetch still informs Bank Balance. Detailed breakdown lives on /revenue. */}
        {invoiceSummary.total_invoiced_usd > 0 && (
          <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] px-5 py-3 text-[12px] text-muted-foreground sm:grid-cols-3">
            <div>
              <span className="font-mono uppercase tracking-[0.10em]">Invoiced (cum.) </span>
              <span className="font-mono tabular-nums text-foreground">{formatCurrency(invoiceSummary.total_invoiced_usd, 'USD')}</span>
            </div>
            <div>
              <span className="font-mono uppercase tracking-[0.10em]">Paid </span>
              <span className="font-mono tabular-nums text-foreground">{formatCurrency(invoiceSummary.total_paid_usd, 'USD')}</span>
            </div>
            <div>
              <span className="font-mono uppercase tracking-[0.10em]">Open </span>
              <span className="font-mono tabular-nums text-foreground">{formatCurrency(invoiceSummary.total_pending_usd, 'USD')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
