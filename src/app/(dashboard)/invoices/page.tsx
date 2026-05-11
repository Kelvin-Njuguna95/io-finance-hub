'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InvoiceFormDialog } from '@/components/revenue/invoice-form-dialog';
import { PaymentFormDialog } from '@/components/revenue/payment-form-dialog';
import { InvoiceEditDialog, type EditableInvoice } from '@/components/revenue/invoice-edit-dialog';
import { formatCompactKES, formatCurrency, formatDate, formatYearMonth } from '@/lib/format';
import { getAgingBucket, isBackdated } from '@/lib/backdated-utils';
import { toast } from 'sonner';
import { DollarSign, FileText, AlertTriangle, Plus, CreditCard } from 'lucide-react';
import { getAllInvoices, getInvoicesByMonth, getInvoiceOutstandingTotal, getInvoicePaidTotal } from '@/lib/queries/invoices';
import { INVOICE_STATUS, OUTSTANDING_INVOICE_STATUSES } from '@/lib/constants/status';

import { FilterPillBar } from '@/app/(dashboard)/misc/_components/FilterPillBar';
import { InvoiceRow, InvoiceRowHead } from '@/app/(dashboard)/revenue/_components/InvoiceRow';
import type { InvoiceStatusKind } from '@/app/(dashboard)/revenue/_components/InvoiceStatusPill';
import { computeAgingPill, type AgingPillVariant } from '@/app/(dashboard)/revenue/_components/AgingPill';
import { type DueBarVariant } from '@/app/(dashboard)/revenue/_components/DueBar';
import { AgingBucketsPanel, type AgingBuckets } from '@/app/(dashboard)/revenue/_components/AgingBucketsPanel';

type InvoiceRowData = {
  id: string;
  invoice_number: string;
  project_id: string;
  invoice_date: string;
  due_date: string | null;
  billing_period: string;
  amount_usd: number;
  amount_kes?: number | null;
  status: string;
  description: string | null;
  updated_at: string;
  projects?: { name?: string | null };
  payments?: { id?: string; amount_usd: number; payment_date?: string | null }[];
};

type InvoiceFilter = 'all' | 'outstanding' | 'open' | 'overdue' | 'partial' | 'paid' | 'pending';
type NormalizedStatus = Exclude<InvoiceFilter, 'all' | 'outstanding'>;

function normalizeStatus(row: InvoiceRowData): NormalizedStatus {
  const rawStatus = (row.status || '').toLowerCase();
  const paidUsd = (row.payments || []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
  const outstanding = Math.max(0, Number(row.amount_usd || 0) - paidUsd);
  const dueDate = row.due_date ? new Date(row.due_date) : null;
  const today = new Date();
  if (dueDate) today.setHours(0, 0, 0, 0);

  if (rawStatus === 'paid' || outstanding <= 0) return 'paid';
  if (rawStatus === 'partially_paid' || (paidUsd > 0 && outstanding > 0)) return 'partial';
  if (rawStatus === 'overdue') return 'overdue';
  if (dueDate && dueDate < today) return 'overdue';
  if (rawStatus === 'draft' || rawStatus === 'pending') return 'pending';
  return 'open';
}

function statusKindFor(status: NormalizedStatus): InvoiceStatusKind {
  return status;
}

function formatInvoiceKesAmount(row: InvoiceRowData): string {
  const kes = Number(row.amount_kes || 0);
  if (kes > 0) return formatCurrency(kes, 'KES');
  const usd = Number(row.amount_usd || 0);
  if (usd > 0) return `≈ ${formatCurrency(usd * 128.5, 'KES')}`;
  return '—';
}

function buildInvoiceRowProps(row: InvoiceRowData) {
  const normalized = normalizeStatus(row);
  const paidUsd = getInvoicePaidTotal(row);
  const outstandingUsd = getInvoiceOutstandingTotal(row);
  const isPaid = normalized === 'paid';
  const lastPayment = isPaid
    ? [...(row.payments ?? [])].sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''))[0]
    : null;
  const aging = computeAgingPill({
    dueDate: row.due_date,
    isPaid,
    paidDate: lastPayment?.payment_date,
    hasIssued: Boolean(row.invoice_date),
  });
  let dueBarVariant: DueBarVariant | null = null;
  let dueBarPct: number | undefined;
  let outstandingLabel: string | null = null;
  if (normalized === 'paid') {
    dueBarVariant = 'paid';
    dueBarPct = 100;
  } else if (normalized === 'overdue') {
    dueBarVariant = 'over';
    dueBarPct = 100;
  } else if (normalized === 'partial') {
    const totalUsd = Number(row.amount_usd ?? 0);
    dueBarVariant = 'default';
    dueBarPct = totalUsd > 0 ? (paidUsd / totalUsd) * 100 : 0;
    const proportionalOutstandingKes =
      totalUsd > 0 && Number(row.amount_kes) > 0
        ? (outstandingUsd / totalUsd) * Number(row.amount_kes)
        : outstandingUsd;
    outstandingLabel = `${formatCompactKES(proportionalOutstandingKes)} outstanding`;
  } else if (normalized === 'open' || normalized === 'pending') {
    dueBarVariant = 'default';
    dueBarPct = 0;
  }
  return {
    invoiceNumber: row.invoice_number,
    invoiceTitle:
      (row.description || '').replace(/\[BACKDATED\][^\s]*\s*/g, '').trim() ||
      row.projects?.name ||
      '—',
    invoiceSub: row.projects?.name && row.projects.name !== row.invoice_number ? row.projects.name : undefined,
    clientName: row.projects?.name || null,
    issuedDateLabel: row.invoice_date ? formatDate(row.invoice_date) : null,
    dueDateLabel: row.due_date ? formatDate(row.due_date) : null,
    ageVariant: aging.variant as AgingPillVariant,
    ageLabel: aging.label,
    amountKes: Number(row.amount_kes || 0),
    amountKesFallback: formatInvoiceKesAmount(row),
    outstandingLabel,
    dueBarVariant,
    dueBarPct,
    status: statusKindFor(normalized),
    isBackdated: isBackdated(row.description),
  };
}

export default function InvoicesPage() {
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState<'all' | string>('all');

  const [rows, setRows] = useState<InvoiceRowData[]>([]);
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('all');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<EditableInvoice | null>(null);

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
    setRows((data || []) as InvoiceRowData[]);
  }, [selectedMonth]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const filterCounts = useMemo(() => {
    const map: Record<NormalizedStatus, number> = {
      open: 0, overdue: 0, partial: 0, paid: 0, pending: 0,
    };
    for (const row of rows) {
      map[normalizeStatus(row)] += 1;
    }
    return map;
  }, [rows]);

  const outstandingCount = filterCounts.open + filterCounts.overdue + filterCounts.partial;

  const filteredRows = useMemo(() => {
    if (invoiceFilter === 'all') return rows;
    if (invoiceFilter === 'outstanding') {
      return rows.filter((row) => {
        const ns = normalizeStatus(row);
        if (ns === 'open' || ns === 'overdue' || ns === 'partial') return true;
        // Defensive: keep parity with previous OUTSTANDING_INVOICE_STATUSES check.
        return row.status !== 'paid'
          && getInvoiceOutstandingTotal(row) > 0
          && OUTSTANDING_INVOICE_STATUSES.includes(row.status as /* // */ any);
      });
    }
    return rows.filter((row) => normalizeStatus(row) === invoiceFilter);
  }, [rows, invoiceFilter]);

  const totals = useMemo(() => {
    const totalInvoiced = rows.reduce((s, r) => s + Number(r.amount_usd || 0), 0);
    const totalOutstandingUsd = rows.reduce((s, r) => s + getInvoiceOutstandingTotal(r), 0);
    const totalOutstandingKes = rows.reduce((s, r) => {
      const totalUsd = Number(r.amount_usd ?? 0);
      const totalKes = Number(r.amount_kes ?? 0);
      const outstandingUsd = getInvoiceOutstandingTotal(r);
      if (outstandingUsd <= 0) return s;
      const proportional = totalUsd > 0 ? (outstandingUsd / totalUsd) * totalKes : 0;
      return s + Math.max(0, proportional);
    }, 0);
    const overdueRows = rows.filter((r) => {
      if (getInvoiceOutstandingTotal(r) <= 0) return false;
      const dueDate = r.due_date ? new Date(r.due_date) : null;
      const today = new Date();
      if (dueDate) today.setHours(0, 0, 0, 0);
      if (dueDate && dueDate < today) return true;
      return getAgingBucket(r.invoice_date).days > 30;
    });
    return {
      totalInvoiced,
      totalOutstandingUsd,
      totalOutstandingKes,
      overdueCount: overdueRows.length,
      overdueAmountKes: overdueRows.reduce((s, r) => {
        const totalUsd = Number(r.amount_usd ?? 0);
        const totalKes = Number(r.amount_kes ?? 0);
        const outstandingUsd = getInvoiceOutstandingTotal(r);
        const proportional = totalUsd > 0 ? (outstandingUsd / totalUsd) * totalKes : 0;
        return s + Math.max(0, proportional);
      }, 0),
    };
  }, [rows]);

  const agingBuckets: AgingBuckets = useMemo(() => {
    const result: AgingBuckets = { current: 0, thirty: 0, sixty: 0, ninety: 0 };
    for (const row of rows) {
      const outstandingUsd = getInvoiceOutstandingTotal(row);
      if (outstandingUsd <= 0) continue;
      const totalUsd = Number(row.amount_usd ?? 0);
      const totalKes = Number(row.amount_kes ?? 0);
      const proportionalKes = totalUsd > 0 ? (outstandingUsd / totalUsd) * totalKes : 0;
      const days = Math.floor(
        (Date.now() - new Date(row.invoice_date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days <= 30) result.current += proportionalKes;
      else if (days <= 60) result.thirty += proportionalKes;
      else if (days <= 90) result.sixty += proportionalKes;
      else result.ninety += proportionalKes;
    }
    return result;
  }, [rows]);

  const filterPills = [
    { key: 'all' as const, label: 'All', count: rows.length },
    { key: 'outstanding' as const, label: 'Outstanding', count: outstandingCount },
    { key: 'open' as const, label: 'Open', count: filterCounts.open },
    { key: 'overdue' as const, label: 'Overdue', count: filterCounts.overdue },
    { key: 'partial' as const, label: 'Partial', count: filterCounts.partial },
    { key: 'paid' as const, label: 'Paid', count: filterCounts.paid },
    { key: 'pending' as const, label: 'Pending', count: filterCounts.pending },
  ];

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

  const monthSelect = (
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
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      <Link href="/revenue">
        <Button size="sm" variant="ghost">Go to Revenue Overview</Button>
      </Link>
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
  );

  const subtitle = `${rows.length} invoice${rows.length === 1 ? '' : 's'} · ${formatCompactKES(totals.totalOutstandingKes)} outstanding`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Invoices &"
        accent="lifecycle"
        subtitle={subtitle}
        action={headerActions}
      />

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
      <InvoiceEditDialog
        invoice={editingInvoice}
        open={!!editingInvoice}
        onClose={() => setEditingInvoice(null)}
        onSaved={() => { setEditingInvoice(null); loadInvoices(); }}
      />

      <div className="mt-6 space-y-6">
        {/* 4-card KPI strip — Total invoiced / Outstanding · open / Overdue / Aging buckets */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total invoiced"
            value={formatCurrency(totals.totalInvoiced, 'USD')}
            subtitle={`${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
            icon={FileText}
            tone="brand"
          />
          <StatCard
            title="Outstanding · open"
            value={formatCompactKES(totals.totalOutstandingKes)}
            subtitle={`${outstandingCount} invoice${outstandingCount === 1 ? '' : 's'} · ${formatCurrency(totals.totalOutstandingUsd, 'USD')}`}
            icon={DollarSign}
            tone={outstandingCount > 0 ? 'warning' : 'success'}
          />
          <StatCard
            title="Overdue"
            value={String(totals.overdueCount)}
            subtitle={totals.overdueCount > 0 ? formatCompactKES(totals.overdueAmountKes) : 'None'}
            icon={AlertTriangle}
            tone={totals.overdueCount > 0 ? 'danger' : 'success'}
          />
          <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Aging · open invoices
            </p>
            <AgingBucketsPanel buckets={agingBuckets} />
          </div>
        </div>

        {/* Filter pills */}
        <FilterPillBar
          pills={filterPills}
          activeKey={invoiceFilter}
          onChange={(k) => setInvoiceFilter(k)}
        />

        {/* Invoice list */}
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <InvoiceRowHead />
          {filteredRows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              {selectedMonth === 'all'
                ? invoiceFilter === 'all'
                  ? 'No invoices found.'
                  : `No ${filterPills.find((p) => p.key === invoiceFilter)?.label.toLowerCase() || ''} invoices found.`
                : `No invoices found for ${formatYearMonth(selectedMonth)}.`}
            </div>
          ) : (
            filteredRows.map((row) => {
              const rowProps = buildInvoiceRowProps(row);
              return (
                <InvoiceRow
                  key={row.id}
                  {...rowProps}
                  actions={
                    canManage ? (
                      <div className="flex items-center gap-1.5">
                        <Select value={row.status} onValueChange={(v) => v && handleStatusChange(row.id, v)}>
                          <SelectTrigger className="h-7 w-[110px] text-[11px]" onClick={(e) => e.stopPropagation()}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={INVOICE_STATUS.DRAFT}>Draft</SelectItem>
                            <SelectItem value={INVOICE_STATUS.SENT}>Sent</SelectItem>
                            <SelectItem value={INVOICE_STATUS.PARTIALLY_PAID}>Partial</SelectItem>
                            <SelectItem value={INVOICE_STATUS.PAID}>Paid</SelectItem>
                            <SelectItem value={INVOICE_STATUS.OVERDUE}>Overdue</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); setEditingInvoice(row); }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); handleDeleteInvoice(row.id); }}
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
      </div>
    </div>
  );
}
