'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InvoiceFormDialog } from '@/components/revenue/invoice-form-dialog';
import { PaymentFormDialog } from '@/components/revenue/payment-form-dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, DollarSign, FileText, CreditCard, CalendarClock, ChevronDown, ChevronUp } from 'lucide-react';
import { getAgingBucket, isBackdated } from '@/lib/backdated-utils';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import type { Invoice, Payment } from '@/types/database';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';


type RevenueInvoice = Invoice & {
  projects?: { name?: string | null } | null;
  payments?: Payment[];
  project_name?: string;
  client_name?: string;
  payment_status?: string;
  total_paid?: number;
  balance_outstanding?: number;
  status?: string;
  year_month?: string;
};

type InvoiceFilter = 'all' | 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'pending';
type SortKey = 'created_at' | 'amount' | 'due_date' | 'status';
type SortDirection = 'asc' | 'desc';

function normalizeStatus(invoice: RevenueInvoice): InvoiceFilter {
  const rawStatus = (invoice.payment_status || '').toLowerCase();
  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
  const today = new Date();
  if (dueDate) today.setHours(0, 0, 0, 0);

  if (rawStatus === 'paid') return 'paid';
  if (rawStatus === 'partially_paid') return 'partially_paid';
  if (rawStatus === 'overdue') return 'overdue';
  if (dueDate && dueDate < today && rawStatus !== 'paid') return 'overdue';
  if (rawStatus === 'pending') return 'pending';
  return 'unpaid';
}

function getStatusBadgeClass(status: InvoiceFilter) {
  if (status === 'paid') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'partially_paid') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'overdue') return 'bg-rose-200 text-rose-900 border-rose-300';
  return 'bg-rose-100 text-rose-700 border-rose-200';
}

export default function RevenuePage() {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<RevenueInvoice[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<'all' | string>(getCurrentYearMonth());
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [paymentInvoice, setPaymentInvoice] = useState<RevenueInvoice | null>(null);
  const [paymentAmountUsd, setPaymentAmountUsd] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState<RevenueInvoice | null>(null);

  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

  const loadData = useCallback(async () => {
    const supabase = createClient();

    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        id,
        invoice_number,
        project_id,
        invoice_date,
        due_date,
        billing_period,
        amount_usd,
        amount_kes,
        status,
        description,
        client_name,
        payment_status,
        total_paid,
        balance_outstanding,
        projects(name),
        payments(id, amount_usd, payment_date, payment_method, reference)
      `)
      .order('created_at', { ascending: false });

    if (invoiceError) {
      setInvoices([]);
      toast.error(getUserErrorMessage());
    } else {
      setInvoices((invoiceData || []).map((i: any) => ({
        ...i,
        payments: i.payments || [],
        payment_status: i.payment_status || i.status || 'unpaid',
        total_paid: (i.payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount_usd || 0), 0),
        balance_outstanding: Math.max(0, Number(i.amount_usd || 0) - (i.payments || []).reduce((sum: number, payment: any) => sum + Number(payment.amount_usd || 0), 0)),
        project_name: i.projects?.name,
        client_name: i.client_name,
      })));
    }

    const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
    const standingBal = parseFloat(balSetting?.value || '0');
    const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
    const totalWd = (allWd || []).reduce((s: number, w: any) => s + Number(w.amount_usd), 0);
    setBankBalance(standingBal - totalWd);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const scopedInvoices = useMemo(() => (
    selectedMonth === 'all'
      ? invoices
      : invoices.filter((i) => i.billing_period === selectedMonth)
  ), [invoices, selectedMonth]);

  const totalInvoicedUsd = useMemo(() => scopedInvoices
    .filter((i: RevenueInvoice) => !isBackdated(i.description))
    .reduce((s, i) => s + Number(i.amount_usd), 0), [scopedInvoices]);

  const allPayments = useMemo(() => (
    invoices
      .flatMap((inv) => (inv.payments ?? []).map((payment) => ({
        ...payment,
        invoice_number: inv.invoice_number,
        project_name: inv.projects?.name,
      })))
      .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())
  ), [invoices]);

  const filteredPayments = useMemo(() => (
    selectedMonth === 'all'
      ? allPayments
      : allPayments.filter((payment) => payment.payment_date?.startsWith(selectedMonth))
  ), [allPayments, selectedMonth]);

  const totalCashReceivedUsd = useMemo(() => invoices
    .flatMap((inv) => inv.payments ?? [])
    .reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0), [invoices]);

  const outstandingTotals = useMemo(() => scopedInvoices.reduce((acc, inv) => {
    const paidUsd = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
    const invoiceOutstandingUsd = Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd);
    if (invoiceOutstandingUsd > 0) {
      const amountUsd = Number(inv.amount_usd ?? 0);
      const amountKes = Number(inv.amount_kes ?? 0);
      const proportionalOutstandingKes = amountUsd > 0
        ? (invoiceOutstandingUsd / amountUsd) * amountKes
        : 0;

      acc.usd += invoiceOutstandingUsd;
      acc.kes += Math.max(0, proportionalOutstandingKes);
    }
    return acc;
  }, { usd: 0, kes: 0 }), [scopedInvoices]);

  const paymentContext = useMemo(() => {
    if (!paymentInvoice) return null;
    const paidUsd = (paymentInvoice.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
    const outstanding = Math.max(0, Number(paymentInvoice.amount_usd ?? 0) - paidUsd);
    return { outstanding };
  }, [paymentInvoice]);

  const filteredInvoices = useMemo(() => {
    const base = invoiceFilter === 'all'
      ? scopedInvoices
      : scopedInvoices.filter((inv) => normalizeStatus(inv) === invoiceFilter);

    return [...base].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';
      if (sortKey === 'amount') {
        aValue = Number(a.amount_usd || 0);
        bValue = Number(b.amount_usd || 0);
      } else if (sortKey === 'created_at') {
        aValue = a.created_at ? new Date(a.created_at).getTime() : 0;
        bValue = b.created_at ? new Date(b.created_at).getTime() : 0;
      } else if (sortKey === 'due_date') {
        aValue = a.due_date ? new Date(a.due_date).getTime() : 0;
        bValue = b.due_date ? new Date(b.due_date).getTime() : 0;
      } else {
        aValue = normalizeStatus(a);
        bValue = normalizeStatus(b);
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [invoiceFilter, scopedInvoices, sortDirection, sortKey]);

  const outstandingInvoices = useMemo(() => {
    return [...invoices]
      .filter((inv) => {
        const paidUsd = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
        return Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd) > 0;
      })
      .sort((a, b) => {
        const aDays = getAgingBucket(a.invoice_date).days;
        const bDays = getAgingBucket(b.invoice_date).days;
        return bDays - aDays;
      });
  }, [invoices]);

  function openPaymentDialog(inv: RevenueInvoice) {
    const paidUsd = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
    const outstanding = Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd);
    setPaymentInvoice(inv);
    setPaymentAmountUsd(outstanding);
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentNotes('');
  }

  function closePaymentDialog() {
    if (submittingPayment) return;
    setPaymentInvoice(null);
    setPaymentAmountUsd(0);
    setPaymentNotes('');
  }

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextKey);
    setSortDirection('asc');
  }

  async function submitInvoicePayment() {
    if (!paymentInvoice || !paymentContext) return;
    if (paymentAmountUsd <= 0) {
      toast.error('Paid amount must be greater than 0');
      return;
    }
    if (paymentAmountUsd > paymentContext.outstanding) {
      toast.error('Paid amount cannot exceed outstanding balance');
      return;
    }
    if (!user?.id) {
      toast.error(getUserErrorMessage());
      return;
    }

    setSubmittingPayment(true);
    const supabase = createClient();
    const { error: paymentError } = await supabase.from('payments').insert({
      invoice_id: paymentInvoice.id,
      payment_date: paymentDate,
      amount_usd: paymentAmountUsd,
      amount_kes: 0,
      notes: paymentNotes || null,
      recorded_by: user.id,
    });

    if (paymentError) {
      setSubmittingPayment(false);
      toast.error(getUserErrorMessage());
      return;
    }

    const remainingOutstanding = Math.max(0, paymentContext.outstanding - paymentAmountUsd);
    const nextStatus = remainingOutstanding <= 0 ? 'paid' : 'partially_paid';
    const nextTotalPaid = Number(paymentInvoice.total_paid ?? 0) + paymentAmountUsd;

    const { error: invoiceError } = await supabase
      .from('invoices')
      .update({
        total_paid: nextTotalPaid,
        balance_outstanding: remainingOutstanding,
        payment_status: nextStatus,
        status: nextStatus,
      })
      .eq('id', paymentInvoice.id);

    if (invoiceError) {
      setSubmittingPayment(false);
      toast.error(getUserErrorMessage());
      return;
    }

    await loadData();
    toast.success(`Payment of ${formatCurrency(paymentAmountUsd, 'USD')} recorded for ${paymentInvoice.invoice_number}`);
    setSubmittingPayment(false);
    closePaymentDialog();
  }

  async function deleteInvoice(invoice: RevenueInvoice) {
    setDeletingInvoiceId(invoice.id);
    const supabase = createClient();
    const { error } = await supabase.from('invoices').delete().eq('id', invoice.id);

    if (error) {
      toast.error(getUserErrorMessage());
      setDeletingInvoiceId(null);
      return;
    }

    await loadData();
    toast.success('Invoice deleted');
    setDeletingInvoiceId(null);
    setConfirmDeleteInvoice(null);
  }

  return (
    <div>
      <PageHeader title="Revenue" description="Invoices & payments">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All months</SelectItem>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        {canCreate && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" asChild>
              <Link href="/invoices">Manage Invoices</Link>
            </Button>
            <Button size="sm" className="gap-1" onClick={() => setShowInvoiceDialog(true)}>
              <Plus className="h-4 w-4" /> Invoice
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowPaymentDialog(true)}>
              <Plus className="h-4 w-4" /> Payment
            </Button>
          </div>
        )}
      </PageHeader>

      <InvoiceFormDialog
        open={showInvoiceDialog}
        onClose={() => setShowInvoiceDialog(false)}
        onSaved={async () => {
          setShowInvoiceDialog(false);
          await loadData();
        }}
      />
      <PaymentFormDialog
        open={showPaymentDialog}
        onClose={() => setShowPaymentDialog(false)}
        onSaved={async () => {
          setShowPaymentDialog(false);
          await loadData();
        }}
      />
      <Dialog open={Boolean(paymentInvoice)} onOpenChange={(open) => { if (!open) closePaymentDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Capture payment details for this invoice.
            </DialogDescription>
          </DialogHeader>

          {paymentInvoice && paymentContext && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                <div><span className="font-medium">Invoice:</span> {paymentInvoice.invoice_number}</div>
                <div><span className="font-medium">Project:</span> {paymentInvoice.project_name || '—'}</div>
                <div><span className="font-medium">Outstanding:</span> {formatCurrency(paymentContext.outstanding, 'USD')}</div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="inline-paid-amount">Paid Amount (USD)</Label>
                <Input
                  id="inline-paid-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paymentAmountUsd || ''}
                  onChange={(e) => setPaymentAmountUsd(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inline-payment-date">Payment Date</Label>
                <Input
                  id="inline-payment-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="inline-payment-notes">Notes</Label>
                <Textarea
                  id="inline-payment-notes"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  rows={3}
                  placeholder="Optional notes"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closePaymentDialog} disabled={submittingPayment}>Cancel</Button>
            <Button onClick={submitInvoicePayment} disabled={submittingPayment}>
              {submittingPayment ? 'Saving...' : 'Submit Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmDeleteInvoice)} onOpenChange={(open) => { if (!open) setConfirmDeleteInvoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete invoice {confirmDeleteInvoice?.invoice_number}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteInvoice(null)} disabled={Boolean(deletingInvoiceId)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!confirmDeleteInvoice || Boolean(deletingInvoiceId)}
              onClick={async () => {
                if (!confirmDeleteInvoice) return;
                await deleteInvoice(confirmDeleteInvoice);
              }}
            >
              {deletingInvoiceId ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Bank Balance (USD)" value={formatCurrency(bankBalance, 'USD')} subtitle="Available after withdrawals" icon={DollarSign} />
          <StatCard title="All Invoices (USD)" value={formatCurrency(totalInvoicedUsd, 'USD')} icon={FileText} />
          <StatCard title="Cash Received (USD)" value={formatCurrency(totalCashReceivedUsd, 'USD')} icon={CreditCard} />
          <StatCard
            title="Outstanding Receivables"
            value={formatCurrency(outstandingTotals.usd, 'USD')}
            subtitle={formatCurrency(outstandingTotals.kes, 'KES')}
            icon={DollarSign}
          />
        </div>

        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="outstanding">Outstanding Receivables</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="text-sm">Status Filter</Label>
                  <Select value={invoiceFilter} onValueChange={(v: InvoiceFilter) => setInvoiceFilter(v)}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="partially_paid">Partially Paid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Project Name</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>
                        <Button type="button" variant="ghost" className="px-0" onClick={() => handleSort('amount')}>
                          Amount (USD) {sortKey === 'amount' && (sortDirection === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />)}
                        </Button>
                      </TableHead>
                      <TableHead>Amount (KES)</TableHead>
                      <TableHead>Paid (USD)</TableHead>
                      <TableHead>Outstanding (USD)</TableHead>
                      <TableHead>
                        <Button type="button" variant="ghost" className="px-0" onClick={() => handleSort('status')}>
                          Status {sortKey === 'status' && (sortDirection === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />)}
                        </Button>
                      </TableHead>
                      <TableHead>
                        <Button type="button" variant="ghost" className="px-0" onClick={() => handleSort('due_date')}>
                          Due Date {sortKey === 'due_date' && (sortDirection === 'asc' ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />)}
                        </Button>
                      </TableHead>
                      {canCreate && <TableHead className="w-[210px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canCreate ? 10 : 9} className="text-center py-8 text-neutral-500">
                          No invoices found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredInvoices.map((inv) => {
                        const normalizedStatus = normalizeStatus(inv);
                        const paidAmount = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
                        const outstandingAmount = Math.max(0, Number(inv.amount_usd ?? 0) - paidAmount);
                        const rowBusy = deletingInvoiceId === inv.id || (submittingPayment && paymentInvoice?.id === inv.id);

                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium">
                              {inv.invoice_number}
                              {isBackdated(inv.description) && (
                                <Badge variant="secondary" className="ml-2 bg-purple-100 text-purple-700 text-[10px]">
                                  <CalendarClock className="h-3 w-3 mr-1 inline" />Backdated
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{inv.project_name || '—'}</TableCell>
                            <TableCell>{inv.client_name || '—'}</TableCell>
                            <TableCell className="font-mono text-sm">{formatCurrency(Number(inv.amount_usd || 0), 'USD')}</TableCell>
                            <TableCell className="font-mono text-sm">{inv.amount_kes ? formatCurrency(Number(inv.amount_kes), 'KES') : '—'}</TableCell>
                            <TableCell className="font-mono text-sm text-emerald-600">{formatCurrency(paidAmount, 'USD')}</TableCell>
                            <TableCell className={`font-mono text-sm font-semibold ${outstandingAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {formatCurrency(outstandingAmount, 'USD')}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getStatusBadgeClass(normalizedStatus)}>
                                {capitalize(normalizedStatus)}
                              </Badge>
                            </TableCell>
                            <TableCell>{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                            {canCreate && (
                              <TableCell>
                                <div className="flex gap-2">
                                  {outstandingAmount > 0 && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs"
                                      onClick={() => openPaymentDialog(inv)}
                                      disabled={rowBusy}
                                    >
                                      Record Payment
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs"
                                    onClick={() => setConfirmDeleteInvoice(inv)}
                                    disabled={rowBusy}
                                  >
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
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-neutral-500">
                          {selectedMonth === 'all' ? 'No payments found' : `No payments for ${formatYearMonth(selectedMonth)}`}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPayments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(p.payment_date)}</TableCell>
                          <TableCell className="font-medium">{p.invoice_number}</TableCell>
                          <TableCell>{p.project_name}</TableCell>
                          <TableCell>{p.payment_method || '—'}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(Number(p.amount_usd), 'USD')}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="outstanding">
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-neutral-600">
                    Open receivables with a remaining balance.
                  </p>
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/reports/outstanding">Open detailed aging report</Link>
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Invoice Date</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Aging</TableHead>
                      <TableHead className="text-right">Outstanding (USD)</TableHead>
                      {canCreate && <TableHead className="w-[150px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outstandingInvoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canCreate ? 7 : 6} className="text-center py-8 text-neutral-500">
                          No outstanding receivables.
                        </TableCell>
                      </TableRow>
                    ) : (
                      outstandingInvoices.map((inv) => {
                        const paidAmount = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
                        const outstandingAmount = Math.max(0, Number(inv.amount_usd ?? 0) - paidAmount);
                        const aging = getAgingBucket(inv.invoice_date);

                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                            <TableCell>{inv.project_name || '—'}</TableCell>
                            <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                            <TableCell>{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={aging.days > 90 ? 'bg-rose-100 text-rose-700 border-rose-200' : aging.days > 60 ? 'bg-amber-100 text-amber-700 border-amber-200' : aging.days > 30 ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}>
                                {aging.bucket}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-semibold text-rose-600">
                              {formatCurrency(outstandingAmount, 'USD')}
                            </TableCell>
                            {canCreate && (
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => openPaymentDialog(inv)}
                                >
                                  Record Payment
                                </Button>
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
