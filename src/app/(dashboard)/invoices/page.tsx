'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InvoiceFormDialog } from '@/components/revenue/invoice-form-dialog';
import { PaymentFormDialog } from '@/components/revenue/payment-form-dialog';
import { formatCurrency, formatDate, formatYearMonth, capitalize } from '@/lib/format';
import { getStatusBadgeClass } from '@/lib/status';
import { getAgingBucket } from '@/lib/backdated-utils';
import { toast } from 'sonner';
import { DollarSign, FileText, AlertTriangle, Plus, CreditCard } from 'lucide-react';
import { getAllInvoices, getInvoiceOutstandingTotal, getInvoicesByMonth } from '@/lib/queries/invoices';
import { INVOICE_STATUS, OUTSTANDING_INVOICE_STATUSES } from '@/lib/constants/status';

type InvoiceRow = {
  id: string;
  invoice_number: string;
  project_id: string;
  invoice_date: string;
  due_date: string | null;
  billing_period: string;
  amount_usd: number;
  status: string;
  description: string | null;
  projects?: { name?: string | null };
  payments?: { amount_usd: number }[];
};

export default function InvoicesPage() {
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState<'all' | string>('all');

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [tab, setTab] = useState<'all' | 'outstanding'>('all');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  const canManage = user?.role === 'cfo' || user?.role === 'accountant';

  const loadInvoices = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = selectedMonth === 'all'
      ? await getAllInvoices(supabase)
      : await getInvoicesByMonth(supabase, selectedMonth);
    if (error) {
      toast.error('Failed to load invoices');
      return;
    }
    setRows((data || []) as InvoiceRow[]);
  }, [selectedMonth]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const viewRows = useMemo(() => {
    if (tab === 'all') return rows;
    return rows.filter((row) => getInvoiceOutstandingTotal(row) > 0 && OUTSTANDING_INVOICE_STATUSES.includes(row.status as /* // */ any));
  }, [rows, tab]);

  const totals = useMemo(() => {
    const totalInvoiced = rows.reduce((s, r) => s + Number(r.amount_usd || 0), 0);
    const totalPaid = rows.reduce((s, r) => s + (r.payments || []).reduce((ps, p) => ps + Number(p.amount_usd || 0), 0), 0);
    const totalOutstanding = Math.max(0, totalInvoiced - totalPaid);
    const overdueCount = rows.filter((r) => {
      const paid = (r.payments || []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
      const outstanding = Number(r.amount_usd) - paid;
      if (outstanding <= 0) return false;
      return getAgingBucket(r.invoice_date).days > 30;
    }).length;
    return { totalInvoiced, totalPaid, totalOutstanding, overdueCount };
  }, [rows]);

  async function handleDeleteInvoice(id: string) {
    const supabase = createClient();
    const { error: paymentDeleteError } = await supabase.from('payments').delete().eq('invoice_id', id);
    if (paymentDeleteError) {
      toast.error('Failed to delete linked payments');
      return;
    }
    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete invoice');
      return;
    }
    toast.success('Invoice deleted');
    loadInvoices();
  }

  async function handleStatusChange(invoiceId: string, status: string) {
    const supabase = createClient();
    const { error } = await supabase.from('invoices').update({ status }).eq('id', invoiceId);
    if (error) {
      toast.error('Failed to update invoice status');
      return;
    }
    toast.success('Invoice status updated');
    loadInvoices();
  }

  return (
    <div>
      <PageHeader title="Invoices" description="Dedicated invoice creation and lifecycle management">
        <div className="flex gap-2">
          <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>

              {Array.from({ length: 12 }, (_, i) => {
                const d = new Date();
                d.setMonth(d.getMonth() - i);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
              })}
            </SelectContent>
          </Select>

          {canManage && (
            <>
              <Button size="sm" className="gap-1" onClick={() => setShowInvoiceDialog(true)}>
                <Plus className="h-4 w-4" /> New Invoice
              </Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowPaymentDialog(true)}>
                <CreditCard className="h-4 w-4" /> Record Payment
              </Button>
            </>
          )}
        </div>
      </PageHeader>

      <InvoiceFormDialog
        open={showInvoiceDialog}
        onClose={() => setShowInvoiceDialog(false)}
        onSaved={() => { setShowInvoiceDialog(false); loadInvoices(); }}
      />
      <PaymentFormDialog
        open={showPaymentDialog}
        onClose={() => setShowPaymentDialog(false)}
        onSaved={() => { setShowPaymentDialog(false); loadInvoices(); }}
      />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Invoiced" value={formatCurrency(totals.totalInvoiced, 'USD')} icon={FileText} />
          <StatCard title="Cash Received" value={formatCurrency(totals.totalPaid, 'USD')} icon={DollarSign} />
          <StatCard title="Outstanding" value={formatCurrency(totals.totalOutstanding, 'USD')} icon={DollarSign} />
          <StatCard title="Overdue Invoices" value={String(totals.overdueCount)} icon={AlertTriangle} />
        </div>

        <div className="flex items-center justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'outstanding')}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="outstanding">Outstanding Only</TabsTrigger>
            </TabsList>
          </Tabs>

          <Link href="/revenue">
            <Button variant="ghost" size="sm">Go to Revenue Overview</Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount (USD)</TableHead>
                  <TableHead className="text-right">Paid (USD)</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  {canManage && <TableHead className="w-[220px]">Management</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canManage ? 9 : 8} className="py-8 text-center text-sm text-muted-foreground">
                      {selectedMonth === 'all' ? 'No invoices found.' : `No invoices found for ${formatYearMonth(selectedMonth)}`}

                    </TableCell>
                  </TableRow>
                ) : (
                  viewRows.map((row) => {
                    const paidAmount = (row.payments || []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
                    const outstanding = Math.max(0, Number(row.amount_usd || 0) - paidAmount);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.invoice_number}</TableCell>
                        <TableCell>{row.projects?.name || '—'}</TableCell>
                        <TableCell>{formatDate(row.invoice_date)}</TableCell>
                        <TableCell>{row.due_date ? formatDate(row.due_date) : '—'}</TableCell>
                        <TableCell>
                          <Badge className={getStatusBadgeClass(row.status)}>{capitalize(row.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(Number(row.amount_usd || 0), 'USD')}</TableCell>
                        <TableCell className="text-right font-mono text-emerald-700">
                          {paidAmount > 0 ? formatCurrency(paidAmount, 'USD') : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {outstanding > 0 ? formatCurrency(outstanding, 'USD') : 'Paid'}
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Select value={row.status} onValueChange={(v) => v && handleStatusChange(row.id, v)}>
                                <SelectTrigger className="h-8 w-[130px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={INVOICE_STATUS.DRAFT}>Draft</SelectItem>
                                  <SelectItem value={INVOICE_STATUS.SENT}>Sent</SelectItem>
                                  <SelectItem value={INVOICE_STATUS.PARTIALLY_PAID}>Partially Paid</SelectItem>
                                  <SelectItem value={INVOICE_STATUS.PAID}>Paid</SelectItem>
                                  <SelectItem value={INVOICE_STATUS.OVERDUE}>Overdue</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteInvoice(row.id)}>
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
