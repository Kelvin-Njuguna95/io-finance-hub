'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { FileText, Receipt, ArrowDownToLine, AlertTriangle } from 'lucide-react';

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
        (sum, w) => sum + Number(w.amount_usd),
        0
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
        description={formatYearMonth(currentMonth)}
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Budgets Pending Review"
            value={String(stats.pendingReviewCount)}
            icon={FileText}
          />
          <StatCard
            title="Expenses This Month"
            value={String(stats.expenseCount)}
            icon={Receipt}
          />
          <StatCard
            title="Withdrawals (USD)"
            value={formatCurrency(stats.withdrawalTotal, 'USD')}
            icon={ArrowDownToLine}
          />
          <StatCard
            title="Unreconciled Items"
            value={String(stats.unreconciledCount)}
            icon={AlertTriangle}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Month-End Checklist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {[
                'Review and validate all submitted budgets',
                'Verify all expenses are linked to approved budgets',
                'Enter missing agent counts for all projects',
                'Reconcile withdrawals with forex logs',
                'Check for unclassified expenses',
                'Verify invoice statuses and payment records',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="h-4 w-4 rounded border border-neutral-300" />
                  <span className="text-neutral-600">{item}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
