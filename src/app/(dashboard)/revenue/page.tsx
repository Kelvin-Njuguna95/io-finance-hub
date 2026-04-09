'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { InvoiceFormDialog } from '@/components/revenue/invoice-form-dialog';
import { PaymentFormDialog } from '@/components/revenue/payment-form-dialog';
import { formatCurrency, formatDate, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, DollarSign, FileText, CreditCard, CalendarClock } from 'lucide-react';
import { isBackdated, cleanNotes as cleanBackdatedNotes, getAgingBucket, computePaymentStatus } from '@/lib/backdated-utils';
import { toast } from 'sonner';
import { getStatusBadgeClass } from '@/lib/status';
import { getUserErrorMessage } from '@/lib/errors';
import type { Invoice, Payment } from '@/types/database';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';


export default function RevenuePage() {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<(Invoice & { project_name?: string })[]>([]);
  const [payments, setPayments] = useState<(Payment & { invoice_number?: string; project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [reportMode, setReportMode] = useState<'accrual' | 'cash'>('accrual');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [paymentInvoice, setPaymentInvoice] = useState<(Invoice & { project_name?: string; payments?: { amount_usd: number }[] }) | null>(null);
  const [paymentAmountUsd, setPaymentAmountUsd] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // A. Current month invoices
      const { data: currentInvoices } = await supabase
        .from('invoices')
        .select('*, projects(name), payments(amount_usd)')
        .eq('billing_period', selectedMonth)
        .order('invoice_date', { ascending: false });

      // B. Carried-forward outstanding invoices from previous months
      const { data: allPriorInvoices } = await supabase
        .from('invoices')
        .select('*, projects(name), payments(amount_usd)')
        .lt('billing_period', selectedMonth)
        .in('status', ['sent', 'partially_paid', 'overdue'])
        .order('invoice_date', { ascending: false });

      // Filter prior invoices to only those not fully paid
      const outstandingPrior = (allPriorInvoices || []).filter((inv: any) => {
        const totalPaid = (inv.payments || []).reduce((s: number, p: any) => s + Number(p.amount_usd), 0);
        return totalPaid < Number(inv.amount_usd);
      });

      // Combine: current month first, then carried-forward
      const combinedInvoices = [
        ...(currentInvoices || []).map((i: any) => ({ ...i, project_name: i.projects?.name, is_carried_forward: false })),
        ...outstandingPrior.map((i: any) => ({ ...i, project_name: i.projects?.name, is_carried_forward: true })),
      ];

      setInvoices(combinedInvoices as any);

      // Payments for selected month
      const { data: payData } = await supabase
        .from('payments')
        .select('*, invoices(invoice_number, project_id, projects(name))')
        .order('payment_date', { ascending: false });

      const monthPayments = (payData || []).filter((p: Record<string, unknown>) => {
        const pd = p.payment_date as string;
        return pd && pd.startsWith(selectedMonth);
      });

      setPayments(
        monthPayments.map((p: Record<string, unknown>) => ({
          ...p,
          invoice_number: (p.invoices as Record<string, unknown>)?.invoice_number as string | undefined,
          project_name: ((p.invoices as Record<string, unknown>)?.projects as Record<string, unknown>)?.name as string | undefined,
        })) as (Payment & { invoice_number?: string; project_name?: string })[]
      );

      // Bank balance (standing minus all withdrawals)
      const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
      const standingBal = parseFloat(balSetting?.value || '0');
      const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
      const totalWd = (allWd || []).reduce((s: number, w: any) => s + Number(w.amount_usd), 0);
      setBankBalance(standingBal - totalWd);
    }
    load();
  }, [selectedMonth]);

  const currentMonthInvoices = useMemo(() => invoices.filter((i: any) => !i.is_carried_forward), [invoices]);
  const carriedForwardInvoices = useMemo(() => invoices.filter((i: any) => i.is_carried_forward), [invoices]);
  const totalInvoicedUsd = useMemo(() => currentMonthInvoices
    .filter((i: any) => !isBackdated(i.description))
    .reduce((s, i) => s + Number(i.amount_usd), 0), [currentMonthInvoices]);
  const totalCashReceivedUsd = useMemo(() => payments.reduce((s, p) => s + Number(p.amount_usd), 0), [payments]);
  const totalOutstandingUsd = useMemo(() => invoices.reduce((s, i: any) => {
    const paid = (i.payments || []).reduce((ps: number, p: any) => ps + Number(p.amount_usd), 0);
    return s + Math.max(0, Number(i.amount_usd) - paid);
  }, 0), [invoices]);
  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

  const paymentContext = useMemo(() => {
    if (!paymentInvoice) return null;
    const totalPaid = (paymentInvoice.payments || []).reduce((s, p) => s + Number(p.amount_usd), 0);
    const outstanding = Math.max(0, Number(paymentInvoice.amount_usd) - totalPaid);
    return { totalPaid, outstanding };
  }, [paymentInvoice]);

  function openPaymentDialog(inv: Invoice & { project_name?: string; payments?: { amount_usd: number }[] }) {
    const totalPaid = (inv.payments || []).reduce((s, p) => s + Number(p.amount_usd), 0);
    const outstanding = Math.max(0, Number(inv.amount_usd) - totalPaid);
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
    const nextStatus = remainingOutstanding === 0 ? 'paid' : 'partially_paid';
    const { error: invoiceError } = await supabase
      .from('invoices')
      .update({ status: nextStatus })
      .eq('id', paymentInvoice.id);

    if (invoiceError) {
      setSubmittingPayment(false);
      toast.error(getUserErrorMessage());
      return;
    }

    setInvoices((prev) => prev.map((inv: any) => (
      inv.id === paymentInvoice.id
        ? {
          ...inv,
          status: nextStatus,
          payments: [...(inv.payments || []), { amount_usd: paymentAmountUsd }],
        }
        : inv
    )));

    if (paymentDate.startsWith(selectedMonth)) {
      setPayments((prev) => [
        {
          id: `temp-${Date.now()}`,
          invoice_id: paymentInvoice.id,
          payment_date: paymentDate,
          amount_usd: paymentAmountUsd,
          amount_kes: 0,
          payment_method: null,
          reference: null,
          notes: paymentNotes || null,
          recorded_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          invoice_number: paymentInvoice.invoice_number,
          project_name: paymentInvoice.project_name,
        },
        ...prev,
      ]);
    }

    setBankBalance((prev) => prev + paymentAmountUsd);
    toast.success(`Payment of ${formatCurrency(paymentAmountUsd, 'USD')} recorded for ${paymentInvoice.invoice_number}`);
    setSubmittingPayment(false);
    closePaymentDialog();
  }

  return (
    <div>
      <PageHeader title="Revenue" description="Invoices & payments">
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
        onSaved={() => { setShowInvoiceDialog(false); window.location.reload(); }}
      />
      <PaymentFormDialog
        open={showPaymentDialog}
        onClose={() => setShowPaymentDialog(false)}
        onSaved={() => { setShowPaymentDialog(false); window.location.reload(); }}
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

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard title="Bank Balance (USD)" value={formatCurrency(bankBalance, 'USD')} subtitle="Available after withdrawals" icon={DollarSign} />
          <StatCard title="Invoiced This Month (USD)" value={formatCurrency(totalInvoicedUsd, 'USD')} icon={FileText} />
          <StatCard title="Cash Received (USD)" value={formatCurrency(totalCashReceivedUsd, 'USD')} icon={CreditCard} />
          <StatCard
            title="Total Outstanding (USD)"
            value={formatCurrency(totalOutstandingUsd, 'USD')}
            subtitle={carriedForwardInvoices.length > 0 ? `Includes ${carriedForwardInvoices.length} from prior months` : ''}
            icon={DollarSign}
          />
          <StatCard
            title="Carried Forward"
            value={String(carriedForwardInvoices.length)}
            subtitle={carriedForwardInvoices.length > 0 ? 'Unpaid invoices from prior months' : 'All prior invoices paid'}
            icon={FileText}
          />
        </div>

        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                      <TableHead className="text-right">Paid (USD)</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      {canCreate && <TableHead className="w-[80px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canCreate ? 9 : 8} className="text-center py-8 text-neutral-500">
                          No invoices for {formatYearMonth(selectedMonth)}
                        </TableCell>
                      </TableRow>
                    ) : (
                      invoices.map((inv: any) => {
                        const paidAmount = (inv.payments || []).reduce((s: number, p: any) => s + Number(p.amount_usd), 0);
                        const outstandingAmount = Math.max(0, Number(inv.amount_usd) - paidAmount);
                        return (
                        <TableRow key={inv.id} className={inv.is_carried_forward ? 'bg-amber-50/50' : ''}>
                          <TableCell className="font-medium">
                            {inv.invoice_number}
                            {inv.is_carried_forward && (
                              <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-700 text-[10px]">Prior</Badge>
                            )}
                            {isBackdated(inv.description) && (
                              <Badge variant="secondary" className="ml-2 bg-purple-100 text-purple-700 text-[10px]">
                                <CalendarClock className="h-3 w-3 mr-1 inline" />Backdated
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{inv.project_name}</TableCell>
                          <TableCell className="text-sm text-neutral-500">{inv.billing_period}</TableCell>
                          <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={getStatusBadgeClass(inv.status)}>
                              {capitalize(inv.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(Number(inv.amount_usd), 'USD')}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-emerald-600">
                            {paidAmount > 0 ? formatCurrency(paidAmount, 'USD') : '—'}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm font-semibold ${outstandingAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {outstandingAmount > 0 ? formatCurrency(outstandingAmount, 'USD') : 'Paid'}
                          </TableCell>
                          {canCreate && (
                            <TableCell>
                              <div className="flex gap-1">
                                {outstandingAmount > 0 && (
                                  <Button variant="outline" size="sm" className="text-xs" onClick={() => openPaymentDialog(inv)}>
                                    Record Payment
                                  </Button>
                                )}
                                <Button variant="ghost" size="sm" className="text-xs" onClick={async () => {
                                  if (!confirm('Delete this invoice? This cannot be undone.')) return;
                                  const supabase = createClient();
                                  // Delete payments first
                                  const { error: paymentDeleteError } = await supabase.from('payments').delete().eq('invoice_id', inv.id);
                                  const { error: invoiceDeleteError } = await supabase.from('invoices').delete().eq('id', inv.id);
                                  if (paymentDeleteError || invoiceDeleteError) {
                                  toast.error(getUserErrorMessage());
                                  return;
                                }
                                toast.success('Invoice deleted');
                                window.location.reload();
                              }}>Delete Invoice</Button>
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
                    {payments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-neutral-500">
                          No payments for {formatYearMonth(selectedMonth)}
                        </TableCell>
                      </TableRow>
                    ) : (
                      payments.map((p) => (
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
        </Tabs>
      </div>
    </div>
  );
}
