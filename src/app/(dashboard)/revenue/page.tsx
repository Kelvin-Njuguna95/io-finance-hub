'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import { isIdempotencyConflict } from '@/lib/idempotency';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InvoiceFormDialog } from '@/components/revenue/invoice-form-dialog';
import { PaymentFormDialog } from '@/components/revenue/payment-form-dialog';
import { formatCompactKES, formatCurrency, formatDate, formatYearMonth } from '@/lib/format';
import { Plus, FileText, CreditCard } from 'lucide-react';
import { getAgingBucket, isBackdated } from '@/lib/backdated-utils';
import { getTotalPaidUsd } from '@/lib/cash-balance';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import type { Invoice, Payment } from '@/types/database';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FilterPillBar } from '@/app/(dashboard)/misc/_components/FilterPillBar';
import { InvoiceRow, InvoiceRowHead, type InvoiceSortKey } from './_components/InvoiceRow';
import type { InvoiceStatusKind } from './_components/InvoiceStatusPill';
import { computeAgingPill, type AgingPillVariant } from './_components/AgingPill';
import { type DueBarVariant } from './_components/DueBar';
import { AgingBucketsPanel, type AgingBuckets } from './_components/AgingBucketsPanel';


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

type InvoiceFilter = 'all' | 'open' | 'partial' | 'paid' | 'overdue' | 'pending';
type NormalizedStatus = Exclude<InvoiceFilter, 'all'>;
type SortKey = 'created_at' | 'amount' | 'due_date' | 'status';
type SortDirection = 'asc' | 'desc';

function normalizeStatus(invoice: RevenueInvoice): NormalizedStatus {
  const rawStatus = (invoice.payment_status || '').toLowerCase();
  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
  const today = new Date();
  if (dueDate) today.setHours(0, 0, 0, 0);

  if (rawStatus === 'paid') return 'paid';
  if (rawStatus === 'partially_paid') return 'partial';
  if (rawStatus === 'overdue') return 'overdue';
  if (dueDate && dueDate < today && rawStatus !== 'paid') return 'overdue';
  if (rawStatus === 'pending') return 'pending';
  return 'open';
}

function statusKindFor(status: NormalizedStatus): InvoiceStatusKind {
  return status;
}

function formatInvoiceKesAmount(invoice: RevenueInvoice): string {
  const kes = Number(invoice.amount_kes || 0);
  if (kes > 0) return formatCurrency(kes, 'KES');
  const usd = Number(invoice.amount_usd || 0);
  if (usd > 0) return `≈ ${formatCurrency(usd * 128.5, 'KES')}`;
  return '—';
}

export default function RevenuePage() {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<RevenueInvoice[]>([]);
  // Default to 'all' so the page lands on a populated state. Filtering by a
  // specific month uses billing_period (preserved from pre-retheme), which
  // typically excludes invoices billed for prior months — defaulting to 'all'
  // avoids the empty-state contradiction with the Outstanding KPI.
  const [selectedMonth, setSelectedMonth] = useState<'all' | string>('all');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [bankBalance, setBankBalance] = useState(0);
  const [paymentInvoice, setPaymentInvoice] = useState<RevenueInvoice | null>(null);
  const [paymentAmountUsd, setPaymentAmountUsd] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [paymentIdempotencyKey, regeneratePaymentIdempotencyKey] = useIdempotencyKey();
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
        created_at,
        updated_at,
        notes,
        created_by
      `)
      .order('created_at', { ascending: false });

    if (invoiceError || !invoiceData) {
      setInvoices([]);
      toast.error(getUserErrorMessage());
    } else {
      const [projectsRes, paymentsRes] = await Promise.all([
        supabase.from('projects').select('id, name'),
        supabase.from('payments').select('id, amount_usd, payment_date, payment_method, reference, notes, invoice_id, amount_kes, recorded_by, created_at, updated_at'),
      ]);

      if (paymentsRes.error) {
        console.error('Failed to load payments', paymentsRes.error);
        toast.error(getUserErrorMessage(paymentsRes.error, 'Unable to load payments — outstanding totals may be inaccurate.'));
      }

      const projectsById = new Map<string, string>();
      if (projectsRes.data) {
        for (const p of projectsRes.data as Array<{ id: string; name: string }>) {
          projectsById.set(p.id, p.name);
        }
      }

      const paymentsByInvoice = new Map<string, Payment[]>();
      if (paymentsRes.data) {
        for (const payment of paymentsRes.data as Payment[]) {
          const current = paymentsByInvoice.get(payment.invoice_id) ?? [];
          current.push(payment);
          paymentsByInvoice.set(payment.invoice_id, current);
        }
      }

      setInvoices(invoiceData.map((i: Invoice) => {
        const invoicePayments = paymentsByInvoice.get(i.id) ?? [];
        const paidUsd = invoicePayments.reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
        const outstandingUsd = Math.max(0, Number(i.amount_usd || 0) - paidUsd);
        return {
          ...i,
          payments: invoicePayments,
          payment_status: outstandingUsd <= 0 ? 'paid' : paidUsd > 0 ? 'partially_paid' : (i.status || 'unpaid'),
          total_paid: paidUsd,
          balance_outstanding: outstandingUsd,
          project_name: projectsById.get(i.project_id),
        };
      }));

    }

    const { data: balSetting } = await supabase.from('system_settings').select('value').eq('key', 'bank_balance_usd').single();
    const seedBalance = parseFloat(balSetting?.value || '0');
    const { data: allWd } = await supabase.from('withdrawals').select('amount_usd');
    const totalWd = (allWd || []).reduce((s: number, w: /* // */ any) => s + Number(w.amount_usd), 0);
    const { data: allInvoicesEver } = await supabase
      .from('invoices')
      .select('amount_usd, status, payments(amount_usd)');
    const totalPaid = getTotalPaidUsd(allInvoicesEver || []);
    setBankBalance(seedBalance + totalPaid - totalWd);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const scopedInvoices = useMemo(() => (
    selectedMonth === 'all'
      ? invoices
      : invoices.filter((i) => i.billing_period === selectedMonth)
  ), [invoices, selectedMonth]);

  const totalInvoicedUsd = useMemo(() => invoices
    .filter((i: RevenueInvoice) => !isBackdated(i.description))
    .reduce((s, i) => s + Number(i.amount_usd), 0), [invoices]);

  const allPayments = useMemo(() => (
    invoices
      .flatMap((inv) => (inv.payments ?? []).map((payment) => ({
        ...payment,
        invoice_number: inv.invoice_number,
        project_name: inv.project_name,
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

  const outstandingTotals = useMemo(() => invoices.reduce((acc, inv) => {
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
  }, { usd: 0, kes: 0 }), [invoices]);

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
    // Fresh key for each opening — the page stays mounted so the hook's
    // initial value would otherwise persist across multiple submit cycles.
    regeneratePaymentIdempotencyKey();
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
      idempotency_key: paymentIdempotencyKey,
    });

    if (paymentError && isIdempotencyConflict(paymentError)) {
      // The first attempt with this key already inserted the payment AND
      // updated the invoice's total_paid / balance_outstanding / status.
      // Re-running the UPDATE here would double-count, so skip it and
      // just refresh the page data to show the prior write.
      await loadData();
      toast.success(`Payment of ${formatCurrency(paymentAmountUsd, 'USD')} recorded for ${paymentInvoice.invoice_number}`);
      setSubmittingPayment(false);
      closePaymentDialog();
      return;
    }

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

  // Aging buckets for the 4th KPI card (current/31-60/61-90/90+) — sums outstanding USD into KES via existing amount_kes proportion
  const agingBuckets: AgingBuckets = useMemo(() => {
    const result: AgingBuckets = { current: 0, thirty: 0, sixty: 0, ninety: 0 };
    for (const inv of invoices) {
      const paidUsd = (inv.payments ?? []).reduce((sum, p) => sum + Number(p.amount_usd || 0), 0);
      const outstandingUsd = Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd);
      if (outstandingUsd <= 0) continue;
      const amountUsd = Number(inv.amount_usd ?? 0);
      const amountKes = Number(inv.amount_kes ?? 0);
      const proportionalKes = amountUsd > 0 ? (outstandingUsd / amountUsd) * amountKes : 0;
      const days = Math.floor(
        (Date.now() - new Date(inv.invoice_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days <= 30) result.current += proportionalKes;
      else if (days <= 60) result.thirty += proportionalKes;
      else if (days <= 90) result.sixty += proportionalKes;
      else result.ninety += proportionalKes;
    }
    return result;
  }, [invoices]);

  // KPI: Collected this month (sum of payments where payment_date matches selectedMonth, USD + KES)
  const collectedThisMonth = useMemo(() => {
    const all = invoices.flatMap((inv) => inv.payments ?? []);
    const filter = selectedMonth === 'all' ? null : selectedMonth;
    const scoped = filter ? all.filter((p) => (p.payment_date || '').startsWith(filter)) : all;
    return {
      usd: scoped.reduce((s, p) => s + Number(p.amount_usd || 0), 0),
      kes: scoped.reduce((s, p) => s + Number(p.amount_kes || 0), 0),
    };
  }, [invoices, selectedMonth]);

  const openInvoiceCount = useMemo(
    () => invoices.filter((inv) => {
      const paidUsd = (inv.payments ?? []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
      return Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd) > 0;
    }).length,
    [invoices],
  );

  // Filter pills for the Invoices tab
  const filterCounts = useMemo(() => {
    const map: Record<NormalizedStatus, number> = {
      open: 0, partial: 0, paid: 0, overdue: 0, pending: 0,
    };
    for (const inv of scopedInvoices) {
      map[normalizeStatus(inv)] += 1;
    }
    return map;
  }, [scopedInvoices]);

  const filterPills = [
    { key: 'all' as const, label: 'All', count: scopedInvoices.length },
    { key: 'open' as const, label: 'Open', count: filterCounts.open },
    { key: 'overdue' as const, label: 'Overdue', count: filterCounts.overdue },
    { key: 'paid' as const, label: 'Paid', count: filterCounts.paid },
    { key: 'partial' as const, label: 'Partial', count: filterCounts.partial },
    { key: 'pending' as const, label: 'Pending', count: filterCounts.pending },
  ];

  // Map page sortKey to InvoiceRowHead sort key (rowhead uses 'invoice'/'amount'/'due'/'status')
  const rowSortKey: InvoiceSortKey | null = (() => {
    if (sortKey === 'amount') return 'amount';
    if (sortKey === 'status') return 'status';
    if (sortKey === 'due_date') return 'due';
    if (sortKey === 'created_at') return 'invoice';
    return null;
  })();

  function handleRowSort(key: InvoiceSortKey) {
    const mapped: SortKey =
      key === 'amount' ? 'amount'
        : key === 'status' ? 'status'
          : key === 'due' ? 'due_date'
            : 'created_at';
    handleSort(mapped);
  }

  function buildInvoiceRowProps(inv: RevenueInvoice) {
    const normalizedStatus = normalizeStatus(inv);
    const paidUsd = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
    const outstandingUsd = Math.max(0, Number(inv.amount_usd ?? 0) - paidUsd);
    const isPaid = normalizedStatus === 'paid';
    const lastPayment = isPaid
      ? [...(inv.payments ?? [])].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''))[0]
      : null;
    const aging = computeAgingPill({
      dueDate: inv.due_date,
      isPaid,
      paidDate: lastPayment?.payment_date,
      hasIssued: Boolean(inv.invoice_date),
    });
    let dueBarVariant: DueBarVariant | null = null;
    let dueBarPct: number | undefined;
    let outstandingLabel: string | null = null;
    if (normalizedStatus === 'paid') {
      dueBarVariant = 'paid';
      dueBarPct = 100;
    } else if (normalizedStatus === 'overdue') {
      dueBarVariant = 'over';
      dueBarPct = 100;
    } else if (normalizedStatus === 'partial') {
      const totalUsd = Number(inv.amount_usd ?? 0);
      const pct = totalUsd > 0 ? (paidUsd / totalUsd) * 100 : 0;
      dueBarVariant = 'default';
      dueBarPct = pct;
      outstandingLabel = `${formatCompactKES(outstandingUsd > 0 && Number(inv.amount_kes) > 0 ? (outstandingUsd / totalUsd) * Number(inv.amount_kes) : outstandingUsd).replace('KES ', 'KES ')} outstanding`;
    } else if (normalizedStatus === 'open' || normalizedStatus === 'pending') {
      dueBarVariant = 'default';
      dueBarPct = 0;
    }
    return {
      invoiceNumber: inv.invoice_number,
      invoiceTitle: (inv as RevenueInvoice).description?.replace(/\[BACKDATED\][^\s]*\s*/g, '').trim() || inv.project_name || '—',
      invoiceSub: inv.project_name && inv.project_name !== inv.invoice_number ? inv.project_name : undefined,
      clientName: inv.client_name || inv.project_name || null,
      issuedDateLabel: inv.invoice_date ? formatDate(inv.invoice_date) : null,
      dueDateLabel: inv.due_date ? formatDate(inv.due_date) : null,
      ageVariant: aging.variant as AgingPillVariant,
      ageLabel: aging.label,
      amountKes: Number(inv.amount_kes || 0),
      amountKesFallback: formatInvoiceKesAmount(inv),
      outstandingLabel,
      dueBarVariant,
      dueBarPct,
      status: statusKindFor(normalizedStatus),
      isBackdated: isBackdated(inv.description),
    };
  }

  const monthSelect = (
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
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      {canCreate && (
        <>
          <Link href="/invoices">
            <Button size="sm" variant="secondary">Manage Invoices</Button>
          </Link>
          <Button size="sm" className="gap-1" onClick={() => setShowInvoiceDialog(true)}>
            <Plus className="h-4 w-4" /> Invoice
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowPaymentDialog(true)}>
            <Plus className="h-4 w-4" /> Payment
          </Button>
        </>
      )}
    </div>
  );

  const subtitle =
    selectedMonth === 'all'
      ? `${invoices.length} invoices · ${formatCompactKES(outstandingTotals.kes)} outstanding`
      : `${formatYearMonth(selectedMonth)} · ${scopedInvoices.length} invoices · ${formatCompactKES(outstandingTotals.kes)} outstanding`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Revenue &"
        accent="payments"
        subtitle={subtitle}
        action={headerActions}
      />

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

      <div className="mt-6 space-y-6">
        {/* 4-card KPI strip — Bank balance (headline) + Outstanding + Collected + Aging */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeadlineStatCard
            eyebrow="Bank balance · USD"
            value={formatCurrency(bankBalance, 'USD')}
            sub="Available after withdrawals"
          />
          <StatCard
            title="Outstanding · open"
            value={formatCompactKES(outstandingTotals.kes)}
            subtitle={`${openInvoiceCount} invoice${openInvoiceCount === 1 ? '' : 's'} unpaid · ${formatCurrency(outstandingTotals.usd, 'USD')}`}
            icon={FileText}
            tone={openInvoiceCount > 0 ? 'warning' : 'success'}
          />
          <StatCard
            title={selectedMonth === 'all' ? 'Collected · all-time' : `Collected · ${formatYearMonth(selectedMonth)}`}
            value={formatCompactKES(collectedThisMonth.kes)}
            subtitle={formatCurrency(collectedThisMonth.usd, 'USD')}
            icon={CreditCard}
            tone="success"
          />
          <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Aging · open invoices
            </p>
            <AgingBucketsPanel buckets={agingBuckets} />
          </div>
        </div>

        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="outstanding">Outstanding Receivables</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="mt-4 space-y-4">
            <FilterPillBar
              pills={filterPills}
              activeKey={invoiceFilter}
              onChange={(k) => setInvoiceFilter(k)}
            />
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              <InvoiceRowHead
                sortKey={rowSortKey}
                sortDirection={sortDirection}
                onSort={handleRowSort}
              />
              {filteredInvoices.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No invoices found.
                </div>
              ) : (
                filteredInvoices.map((inv) => {
                  const paidAmount = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
                  const outstandingAmount = Math.max(0, Number(inv.amount_usd ?? 0) - paidAmount);
                  const rowBusy = deletingInvoiceId === inv.id || (submittingPayment && paymentInvoice?.id === inv.id);
                  const rowProps = buildInvoiceRowProps(inv);
                  return (
                    <InvoiceRow
                      key={inv.id}
                      {...rowProps}
                      actions={
                        canCreate ? (
                          <div className="flex items-center gap-1.5">
                            {outstandingAmount > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={(e) => { e.stopPropagation(); openPaymentDialog(inv); }}
                                disabled={rowBusy}
                              >
                                Record
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteInvoice(inv); }}
                              disabled={rowBusy}
                            >
                              Delete
                            </Button>
                          </div>
                        ) : null
                      }
                    />
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="payments" className="mt-4">
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              <div className="grid grid-cols-[110px_1.4fr_1.2fr_1fr_140px] items-center gap-4 border-b border-border bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                <div>Date</div>
                <div>Invoice</div>
                <div>Project</div>
                <div>Method</div>
                <div className="text-right">Amount (USD)</div>
              </div>
              {filteredPayments.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  {selectedMonth === 'all' ? 'No payments found' : `No payments for ${formatYearMonth(selectedMonth)}`}
                </div>
              ) : (
                filteredPayments.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-[110px_1.4fr_1.2fr_1fr_140px] items-center gap-4 border-b border-border-subtle px-5 py-3 text-[13px] last:border-b-0"
                  >
                    <div className="font-mono text-[12px] tabular-nums text-foreground">
                      {formatDate(p.payment_date)}
                    </div>
                    <div className="truncate font-medium text-foreground">{p.invoice_number}</div>
                    <div className="truncate text-muted-foreground">{p.project_name}</div>
                    <div className="text-muted-foreground">{p.payment_method || '—'}</div>
                    <div className="text-right font-mono tabular-nums text-foreground">
                      {formatCurrency(Number(p.amount_usd), 'USD')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="outstanding" className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Open receivables with a remaining balance.
              </p>
              <Link href="/reports/outstanding">
                <Button variant="ghost" size="sm">
                  Open detailed aging report
                </Button>
              </Link>
            </div>
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              <InvoiceRowHead />
              {outstandingInvoices.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No outstanding receivables.
                </div>
              ) : (
                outstandingInvoices.map((inv) => {
                  const paidAmount = (inv.payments ?? []).reduce((sum, payment) => sum + Number(payment.amount_usd || 0), 0);
                  const outstandingAmount = Math.max(0, Number(inv.amount_usd ?? 0) - paidAmount);
                  const rowProps = buildInvoiceRowProps(inv);
                  return (
                    <InvoiceRow
                      key={inv.id}
                      {...rowProps}
                      actions={
                        canCreate && outstandingAmount > 0 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={(e) => { e.stopPropagation(); openPaymentDialog(inv); }}
                          >
                            Record
                          </Button>
                        ) : null
                      }
                    />
                  );
                })
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
