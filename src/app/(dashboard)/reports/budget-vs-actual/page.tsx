'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';

interface BvaRow {
  scope: string;
  budget_usd: number;
  actual_usd: number;
  variance_usd: number;
  utilization_pct: number;
}

export default function BudgetVsActualPage() {
  const [rows, setRows] = useState<BvaRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // Get approved budgets for this month
      const { data: budgets } = await supabase
        .from('budgets')
        .select(`
          id, project_id, department_id,
          projects(name), departments(name),
          budget_versions(total_amount_usd, status)
        `)
        .eq('year_month', selectedMonth);

      // Get expenses for this month
      const { data: expenses } = await supabase
        .from('expenses')
        .select('budget_id, amount_usd')
        .eq('year_month', selectedMonth);

      const expenseByBudget = new Map<string, number>();
      (expenses || []).forEach((e) => {
        expenseByBudget.set(e.budget_id, (expenseByBudget.get(e.budget_id) || 0) + Number(e.amount_usd));
      });

      const result: BvaRow[] = (budgets || []).map((b: Record<string, unknown>) => {
        const versions = (b.budget_versions as Record<string, unknown>[]) || [];
        const approved = versions.find((v: Record<string, unknown>) => v.status === 'approved');
        const budgetUsd = Number(approved?.total_amount_usd || 0);
        const actualUsd = expenseByBudget.get(b.id as string) || 0;
        const variance = budgetUsd - actualUsd;
        const utilization = budgetUsd > 0 ? (actualUsd / budgetUsd) * 100 : 0;

        return {
          scope: ((b.projects as Record<string, unknown>)?.name as string) ||
                 ((b.departments as Record<string, unknown>)?.name as string) || '—',
          budget_usd: budgetUsd,
          actual_usd: actualUsd,
          variance_usd: variance,
          utilization_pct: utilization,
        };
      });

      setRows(result);
    }
    load();
  }, [selectedMonth]);

  return (
    <div>
      <PageHeader title="Budget vs Actual" description="Compare planned versus actual spending">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Budget (USD)</TableHead>
                  <TableHead className="text-right">Actual (USD)</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Utilization</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-neutral-500">
                      No budget data for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.scope}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(r.budget_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(r.actual_usd, 'USD')}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm ${r.variance_usd < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrency(r.variance_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="secondary"
                          className={
                            r.utilization_pct > 100
                              ? 'bg-red-100 text-red-700'
                              : r.utilization_pct > 90
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-green-100 text-green-700'
                          }
                        >
                          {formatPercent(r.utilization_pct)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
