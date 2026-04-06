'use client';

import { useEffect, useState } from 'react';
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
import { Plus, DollarSign, FileText, CreditCard } from 'lucide-react';
import type { Invoice, Payment } from '@/types/database';

const invoiceStatusColors: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  sent: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

export default function RevenuePage() {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<(Invoice & { project_name?: string })[]>([]);
  const [payments, setPayments] = useState<(Payment & { invoice_number?: string; project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [reportMode, setReportMode] = useState<'accrual' | 'cash'>('accrual');
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [invRes, payRes] = await Promise.all([
        supabase
          .from('invoices')
          .select('*, projects(name)')
          .eq('billing_period', selectedMonth)
          .order('invoice_date', { ascending: false }),
        supabase
          .from('payments')
          .select('*, invoices(invoice_number, project_id, projects(name))')
          .order('payment_date', { ascending: false }),
      ]);

      setInvoices(
        (invRes.data || []).map((i: Record<string, unknown>) => ({
          ...i,
          project_name: (i.projects as Record<string, unknown>)?.name as string | undefined,
        })) as (Invoice & { project_name?: string })[]
      );

      // Filter payments for selected month
      const monthPayments = (payRes.data || []).filter((p: Record<string, unknown>) => {
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
    }
    load();
  }, [selectedMonth]);

  const totalInvoicedUsd = invoices.reduce((s, i) => s + Number(i.amount_usd), 0);
  const totalCashReceivedUsd = payments.reduce((s, p) => s + Number(p.amount_usd), 0);
  const canCreate = user?.role === 'cfo' || user?.role === 'accountant';

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

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard title="Invoiced (USD)" value={formatCurrency(totalInvoicedUsd, 'USD')} icon={FileText} />
          <StatCard title="Cash Received (USD)" value={formatCurrency(totalCashReceivedUsd, 'USD')} icon={CreditCard} />
          <StatCard
            title="Outstanding"
            value={formatCurrency(totalInvoicedUsd - totalCashReceivedUsd, 'USD')}
            icon={DollarSign}
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
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-neutral-500">
                          No invoices for {formatYearMonth(selectedMonth)}
                        </TableCell>
                      </TableRow>
                    ) : (
                      invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                          <TableCell>{inv.project_name}</TableCell>
                          <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={invoiceStatusColors[inv.status]}>
                              {capitalize(inv.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatCurrency(Number(inv.amount_usd), 'USD')}
                          </TableCell>
                        </TableRow>
                      ))
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
