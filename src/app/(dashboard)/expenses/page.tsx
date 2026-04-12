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
import { Plus, ListChecks, GitCompareArrows, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import type { Expense } from '@/types/database';

export default function ExpensesPage() {
  const { user } = useUser();
  const [expenses, setExpenses] = useState<(Expense & { project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [showDialog, setShowDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<(Expense & { project_name?: string }) | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
    return headers;
  }

  async function reloadExpenses() {
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
  }

  async function handleDelete() {
    if (!deleteTarget || !deleteReason.trim()) return;
    setDeleting(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/expenses/delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ expense_id: deleteTarget.id, reason: deleteReason }),
      });
      const result = await res.json();
      if (result.success) {
        toast.success('Expense deleted');
        setDeleteTarget(null);
        setDeleteReason('');
        reloadExpenses();
      } else {
        toast.error(result.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete expense');
    }
    setDeleting(false);
  }

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

  const isCfo = user?.role === 'cfo';
  const canCreate = isCfo || user?.role === 'accountant';

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
            .then(({ data }: { data: Record<string, unknown>[] | null }) => {
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
        {/* Quick Links */}
        {(user?.role === 'cfo' || user?.role === 'accountant') && (
          <div className="mb-4 flex gap-3">
            <Link href="/expenses/queue">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ListChecks className="h-3.5 w-3.5" /> Expense Queue
              </Button>
            </Link>
            {user?.role === 'cfo' && (
              <Link href="/expenses/variance">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <GitCompareArrows className="h-3.5 w-3.5" /> Variance Dashboard
                </Button>
              </Link>
            )}
          </div>
        )}

        <div className="mb-4 flex gap-4 text-sm">
          <span className="font-medium">Total: {formatCurrency(totalKes, 'KES')}</span>
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
                  <TableHead className="text-right">KES</TableHead>
                  {isCfo && <TableHead className="w-[60px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isCfo ? 6 : 5} className="text-center py-8 text-muted-foreground">
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
                      <TableCell className="text-sm text-muted-foreground">
                        {e.project_name || 'Shared'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(e.amount_kes), 'KES')}
                      </TableCell>
                      {isCfo && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-danger-soft-foreground hover:text-danger-soft-foreground hover:bg-danger-soft"
                            onClick={() => { setDeleteTarget(e); setDeleteReason(''); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="rounded-md bg-danger-soft border border-danger/40 p-3">
                <p className="text-sm font-medium text-danger-soft-foreground">You are about to permanently delete this expense:</p>
                <div className="mt-2 text-sm text-danger-soft-foreground space-y-1">
                  <p><strong>{deleteTarget.description}</strong></p>
                  <p>{deleteTarget.project_name || 'Shared'} · {formatDate(deleteTarget.expense_date)}</p>
                  <p className="font-mono font-semibold">{formatCurrency(Number(deleteTarget.amount_kes), 'KES')}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm">Reason for deletion <span className="text-danger-soft-foreground">*</span></Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why is this expense being deleted?"
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting || !deleteReason.trim()}
                  className="gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting...' : 'Delete Expense'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
