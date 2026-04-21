'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckSquare,
  FileText,
  Receipt,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { SectionCard } from '@/components/layout/section-card';
import {
  formatCurrency,
  getCurrentYearMonth,
  formatYearMonth,
} from '@/lib/format';
import { EodPanel } from '@/components/eod/eod-panel';
import { AccountantMiscRequests } from '@/components/misc/accountant-misc-requests';
import { AccountantMiscReport } from '@/components/misc/accountant-misc-report';
import { OutstandingReceivablesPanel } from '@/components/revenue/outstanding-receivables-panel';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';

const CHECKLIST = [
  'Review and validate all submitted budgets',
  'Verify all expenses are linked to approved budgets',
  'Enter missing agent counts for all projects',
  'Reconcile withdrawals with forex logs',
  'Check for unclassified expenses',
  'Verify invoice statuses and payment records',
];

export function AccountantDashboard() {
  const [stats, setStats] = useState({
    pendingReviewCount: 0,
    expenseCount: 0,
    withdrawalTotal: 0,
    unreconciledCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const [reviewRes, expenseRes, withdrawalRes] = await Promise.all([
        supabase
          .from('budget_versions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted'),
        supabase
          .from('expenses')
          .select('id', { count: 'exact', head: true })
          .eq('year_month', currentMonth),
        supabase
          .from('withdrawals')
          .select('amount_usd')
          .eq('year_month', currentMonth),
      ]);

      const totalWithdrawals = (withdrawalRes.data || []).reduce(
        (sum: number, w: { amount_usd: number }) => sum + Number(w.amount_usd),
        0,
      );

      setStats({
        pendingReviewCount: reviewRes.count || 0,
        expenseCount: expenseRes.count || 0,
        withdrawalTotal: totalWithdrawals,
        unreconciledCount: 0,
      });
      setLoading(false);
    }

    loadData();
  }, [currentMonth]);

  return (
    <div>
      <PageHeader
        title="Accountant Dashboard"
        eyebrow="Finance Operations"
        description={formatYearMonth(currentMonth)}
        icon={Receipt}
        tone="brand"
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Budgets Pending Review"
            value={String(stats.pendingReviewCount)}
            icon={FileText}
            tone="brand"
            loading={loading}
          />
          <StatCard
            title="Expenses This Month"
            value={String(stats.expenseCount)}
            icon={Receipt}
            tone="brand"
            loading={loading}
          />
          <StatCard
            title="Withdrawals (USD)"
            value={formatCurrency(stats.withdrawalTotal, 'USD')}
            icon={ArrowDownToLine}
            tone="brand"
            loading={loading}
          />
          <StatCard
            title="Unreconciled Items"
            value={String(stats.unreconciledCount)}
            icon={AlertTriangle}
            tone={stats.unreconciledCount > 0 ? 'warning' : 'success'}
            loading={loading}
          />
        </div>

        {/* Expense Queue */}
        <ExpenseQueuePanel />

        {/* Outstanding Receivables */}
        <OutstandingReceivablesPanel />

        {/* Misc Fund Requests */}
        <AccountantMiscRequests />

        {/* Misc Accountability Report */}
        <AccountantMiscReport />

        {/* EOD Report Panel */}
        <EodPanel />

        <SectionCard
          title="Month-End Checklist"
          description="Complete each item before closing the period"
          icon={CheckSquare}
          tone="success"
        >
          <ul className="space-y-2 text-sm">
            {CHECKLIST.map((item) => (
              <li
                key={item}
                className="flex items-center gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 transition-colors duration-[var(--dur-fast)] hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="size-4 shrink-0 rounded border border-border bg-background"
                />
                <span className="text-muted-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
