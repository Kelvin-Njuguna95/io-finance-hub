'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ExpenseFormDialog } from '@/components/expenses/expense-form-dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus } from 'lucide-react';
import type { Expense } from '@/types/database';

export default function ExpensesPage() {
  const { user } = useUser();
  const [expenses, setExpenses] = useState<(Expense & { project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('expenses')
        .select('*, projects(name)')
        .eq('year_month', selectedMonth)
        .order('expense_date', { ascending: false });

      setExpenses(
        (data || []).map((e: Record<string, unknown>) => ({
          ...e,
          project_name: (e.projects as Record<string, unknown>)?.name as string | undefined,
        })) as (Expense & { project_name?: string })[]
      );
      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

  const totalUsd = expenses.reduce((s, e) => s + Number(e.amount_usd), 0);
  const totalKes = expenses.reduce((s, e) => s + Number(e.amount_kes), 0);

  return (
    <div>
      <PageHeader title="Expenses" description="Track and manage all expenses">
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
        {canCreate && (
          <Button size="sm" className="gap-1" onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4" /> Add Expense
          </Button>
        )}
      </PageHeader>

      <ExpenseFormDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onSaved={() => {
          const supabase = createClient();
          supabase
            .from('expenses')
            .select('*, projects(name)')
            .eq('year_month', selectedMonth)
            .order('expense_date', { ascending: false })
            .then(({ data }) => {
              setExpenses(
                (data || []).map((e: Record<string, unknown>) => ({
                  ...e,
                  project_name: (e.projects as Record<string, unknown>)?.name as string | undefined,
                })) as (Expense & { project_name?: string })[]
              );
            });
        }}
      />

      <div className="p-6">
        <div className="mb-4 flex gap-4 text-sm">
          <span className="font-medium">Total: {formatCurrency(totalUsd, 'USD')}</span>
          <span className="text-neutral-500">|</span>
          <span className="font-medium">{formatCurrency(totalKes, 'KES')}</span>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">KES</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-neutral-500">
                      No expenses for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">{formatDate(e.expense_date)}</TableCell>
                      <TableCell className="font-medium">{e.description}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {capitalize(e.expense_type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-neutral-500">
                        {e.project_name || 'Shared'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(e.amount_usd), 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(e.amount_kes), 'KES')}
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
