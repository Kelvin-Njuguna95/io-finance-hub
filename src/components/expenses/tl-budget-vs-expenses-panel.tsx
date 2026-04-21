'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { CheckCircle, Clock, XCircle, ArrowRightLeft } from 'lucide-react';

interface PendingExpenseRow {
  id: string;
  description: string;
  category: string | null;
  project_id: string | null;
  budgeted_amount_kes: number;
  actual_amount_kes: number | null;
  variance_kes: number | null;
  variance_pct: number | null;
  status: string;
  projects?: { name: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending_auth: 'bg-warning-soft text-warning-soft-foreground',
  confirmed: 'bg-success-soft text-success-soft-foreground',
  under_review: 'bg-blue-100 text-blue-700',
  modified: 'bg-violet-soft text-violet-soft-foreground',
  voided: 'bg-danger-soft text-danger-soft-foreground',
  carried_forward: 'bg-muted text-foreground/80',
};

const STATUS_LABEL: Record<string, string> = {
  pending_auth: 'Pending',
  confirmed: 'Confirmed',
  under_review: 'Review',
  modified: 'Modified',
  voided: 'Voided',
  carried_forward: 'Carried Fwd',
};

interface Props {
  projectIds: string[];
}

export function TlBudgetVsExpensesPanel({ projectIds }: Props) {
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function load() {
      if (projectIds.length === 0) { setLoading(false); return; }
      const supabase = createClient();
      const { data } = await supabase
        .from('pending_expenses')
        .select('id, description, category, project_id, budgeted_amount_kes, actual_amount_kes, variance_kes, variance_pct, status, projects(name)')
        .eq('year_month', currentMonth)
        .in('project_id', projectIds)
        .order('created_at');
      setItems((data as PendingExpenseRow[] | null) || []);
      setLoading(false);
    }
    load();
  }, [currentMonth, projectIds]);

  if (loading || items.length === 0) return null;

  // Group by project
  const projectMap = new Map<string, { name: string; items: PendingExpenseRow[] }>();
  for (const item of items) {
    const pid = item.project_id || 'shared';
    if (!projectMap.has(pid)) {
      projectMap.set(pid, { name: item.projects?.name || 'Shared', items: [] });
    }
    projectMap.get(pid)!.items.push(item);
  }

  // Totals
  const totalBudgeted = items.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
  const confirmed = items.filter(i => ['confirmed', 'modified'].includes(i.status));
  const totalActual = confirmed.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const pendingCount = items.filter(i => i.status === 'pending_auth').length;
  const confirmedCount = confirmed.length;
  const variance = totalActual - totalBudgeted;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4" />
          Budget vs Confirmed Expenses — {formatYearMonth(currentMonth)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-indigo-50 p-2.5 text-center">
            <p className="text-lg font-semibold text-indigo-700">{formatCurrency(totalBudgeted, 'KES')}</p>
            <p className="text-[11px] text-indigo-600">Your Budget</p>
          </div>
          <div className="rounded-md bg-success-soft/50 p-2.5 text-center">
            <p className="text-lg font-semibold text-success-soft-foreground">{formatCurrency(totalActual, 'KES')}</p>
            <p className="text-[11px] text-success-soft-foreground">Confirmed Spend</p>
          </div>
          <div className="rounded-md bg-warning-soft/50 p-2.5 text-center">
            <p className="text-lg font-semibold text-warning-soft-foreground">{pendingCount}</p>
            <p className="text-[11px] text-warning-soft-foreground">Awaiting Confirmation</p>
          </div>
          <div className={`rounded-md p-2.5 text-center ${confirmedCount > 0 ? (variance > 0 ? 'bg-danger-soft/50' : 'bg-success-soft/50') : 'bg-muted/50'}`}>
            <p className={`text-lg font-semibold ${confirmedCount > 0 ? (variance > 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground') : 'text-muted-foreground'}`}>
              {confirmedCount > 0 ? `${variance >= 0 ? '+' : ''}${formatCurrency(variance, 'KES')}` : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground">Variance</p>
          </div>
        </div>

        {/* Per-project tables */}
        {Array.from(projectMap.entries()).map(([pid, group]) => {
          const groupBudgeted = group.items.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
          const groupConfirmed = group.items.filter(i => ['confirmed', 'modified'].includes(i.status));
          const groupActual = groupConfirmed.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);

          return (
            <div key={pid}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-foreground/90">{group.name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Budget: <strong className="text-indigo-600">{formatCurrency(groupBudgeted, 'KES')}</strong></span>
                  <span>Spent: <strong className={groupActual > groupBudgeted ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}>{formatCurrency(groupActual, 'KES')}</strong></span>
                </div>
              </div>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Line Item</TableHead>
                      <TableHead className="text-xs">Category</TableHead>
                      <TableHead className="text-xs text-right">Budgeted</TableHead>
                      <TableHead className="text-xs text-right">Actual</TableHead>
                      <TableHead className="text-xs text-right">Variance</TableHead>
                      <TableHead className="text-xs text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item) => {
                      const hasActual = item.actual_amount_kes != null;
                      const itemVariance = hasActual ? Number(item.actual_amount_kes) - Number(item.budgeted_amount_kes) : null;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-sm font-medium">{item.description}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{item.category || '—'}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(Number(item.budgeted_amount_kes), 'KES')}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {hasActual ? formatCurrency(Number(item.actual_amount_kes), 'KES') : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${itemVariance != null ? (itemVariance > 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground') : ''}`}>
                            {itemVariance != null ? (
                              <>
                                {itemVariance >= 0 ? '+' : ''}{formatCurrency(itemVariance, 'KES')}
                              </>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={`${STATUS_COLOR[item.status] || 'bg-muted'} border-0 text-[10px]`}>
                              {STATUS_LABEL[item.status] || item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
