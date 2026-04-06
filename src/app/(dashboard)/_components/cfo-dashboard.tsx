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
} from 'lucide-react';
import Link from 'next/link';
import type { RedFlag, BudgetVersion, MonthlyFinancialSnapshot } from '@/types/database';

export function CfoDashboard() {
  const [snapshot, setSnapshot] = useState<MonthlyFinancialSnapshot | null>(null);
  const [redFlags, setRedFlags] = useState<RedFlag[]>([]);
  const [pendingBudgets, setPendingBudgets] = useState<(BudgetVersion & { budget_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const [snapshotRes, flagsRes, budgetsRes] = await Promise.all([
        supabase
          .from('monthly_financial_snapshots')
          .select('*')
          .eq('year_month', currentMonth)
          .single(),
        supabase
          .from('red_flags')
          .select('*')
          .eq('is_resolved', false)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('budget_versions')
          .select('*, budgets(project_id, department_id, year_month)')
          .in('status', ['submitted', 'under_review'])
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      setSnapshot(snapshotRes.data);
      setRedFlags(flagsRes.data || []);
      setPendingBudgets(budgetsRes.data || []);
      setLoading(false);
    }

    loadData();
  }, [currentMonth]);

  const severityColor = {
    low: 'bg-blue-100 text-blue-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-orange-100 text-orange-700',
    critical: 'bg-red-100 text-red-700',
  };

  return (
    <div>
      <PageHeader
        title="CFO Dashboard"
        description={formatYearMonth(currentMonth)}
      />

      <div className="p-6 space-y-6">
        {/* Key metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Revenue (USD)"
            value={snapshot ? formatCurrency(snapshot.total_revenue_usd, 'USD') : '--'}
            icon={DollarSign}
          />
          <StatCard
            title="Operating Profit (USD)"
            value={snapshot ? formatCurrency(snapshot.operating_profit_usd, 'USD') : '--'}
            icon={TrendingUp}
          />
          <StatCard
            title="Active Red Flags"
            value={String(redFlags.length)}
            icon={AlertTriangle}
          />
          <StatCard
            title="Pending Approvals"
            value={String(pendingBudgets.length)}
            icon={FileText}
          />
        </div>

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
                          {formatCurrency(bv.total_amount_usd, 'USD')}
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
      </div>
    </div>
  );
}
