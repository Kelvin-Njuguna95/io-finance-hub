'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency, formatDate } from '@/lib/format';
import { isBackdated, cleanNotes, getAgingBucket, computePaymentStatus } from '@/lib/backdated-utils';
import { Download, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatCompactCurrency } from '@/components/reports/executive-kit';
import { getInvoiceOutstandingTotal, getOutstandingInvoices } from '@/lib/queries/invoices';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

interface OutstandingInvoice {
  id: string;
  invoice_number: string;
  project_name: string;
  invoice_date: string;
  due_date: string | null;
  amount_usd: number;
  description: string | null;
  status: string;
  totalPaid: number;
  balance: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  aging: { bucket: string; days: number; color: string };
  isBackdatedInv: boolean;
  payments: { id: string; amount_usd: number; payment_date: string; payment_method: string | null; reference: string | null }[];
}

const bucketColors: Record<string, string> = {
  '0-30 days': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  '31-60 days': 'bg-blue-100 text-blue-700',
  '61-90 days': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  '90+ days': 'bg-red-100 text-red-700',
};

const chartBarColors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

export default function OutstandingReceivablesPage() {
  const { user } = useUser();
  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<OutstandingInvoice | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    amount_usd: '',
    amount_kes: '',
    payment_method: '',
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const canAct = user?.role === 'cfo' || user?.role === 'accountant';

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const { data } = await getOutstandingInvoices(supabase);

    const processed: OutstandingInvoice[] = (data || [])
      .map((inv: /* // */ any) => {
        const totalPaid = (inv.payments || []).reduce((s: number, p: /* // */ any) => s + Number(p.amount_usd), 0);
        const balance = getInvoiceOutstandingTotal(inv as /* // */ any);
        const paymentStatus = computePaymentStatus(Number(inv.amount_usd), totalPaid);
        const aging = getAgingBucket(inv.invoice_date);
        const isBackdatedInv = isBackdated(inv.description);

        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          project_name: inv.projects?.name || 'Unknown',
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          amount_usd: Number(inv.amount_usd),
          description: inv.description,
          status: inv.status,
          totalPaid,
          balance,
          paymentStatus,
          aging,
          isBackdatedInv,
          payments: inv.payments || [],
        };
      })
      .filter((inv) => inv.balance > 0);

    setInvoices(processed);
    setLoading(false);
  }

  // Summary calculations
  const totalOutstanding = invoices.reduce((s, inv) => s + inv.balance, 0);

  const overdue90 = invoices.filter((inv) => inv.aging.bucket === '90+ days');
  const overdue90Count = overdue90.length;
  const overdue90Total = overdue90.reduce((s, inv) => s + inv.balance, 0);

  const avgDaysOutstanding =
    invoices.length > 0
      ? Math.round(
          invoices.reduce((s, inv) => s + inv.aging.days * inv.balance, 0) /
            invoices.reduce((s, inv) => s + inv.balance, 0)
        )
      : 0;

  const backdatedCount = invoices.filter((inv) => inv.isBackdatedInv).length;

  // Aging chart data
  const bucketOrder = ['0-30 days', '31-60 days', '61-90 days', '90+ days'];
  const agingChartData = bucketOrder.map((bucket) => ({
    bucket,
    total: invoices
      .filter((inv) => inv.aging.bucket === bucket)
      .reduce((s, inv) => s + inv.balance, 0),
  }));

  // CSV export
  function exportCSV() {
    const headers = ['Invoice #', 'Project', 'Invoice Date', 'Due Date', 'Amount (USD)', 'Paid (USD)', 'Outstanding (USD)', 'Age (days)', 'Status'];
    const rows = invoices.map((inv) => [
      inv.invoice_number,
      inv.project_name,
      inv.invoice_date,
      inv.due_date || '',
      inv.amount_usd.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      inv.totalPaid.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      inv.balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(inv.aging.days),
      inv.aging.bucket,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `outstanding-receivables-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  }

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Outstanding Receivables',
      'Unpaid invoices and aging analysis',
      invoices.slice(0, 120).map((inv) => `${inv.invoice_number} | ${inv.project_name} | outstanding ${inv.balance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD | aging ${inv.aging.bucket}`),
      `IO_Outstanding_Receivables_${new Date().toISOString().split('T')[0]}.pdf`,
    );
  }

  // Record payment
  function openPaymentDialog(inv: OutstandingInvoice) {
    setSelectedInvoice(inv);
    setPaymentForm({
      payment_date: new Date().toISOString().split('T')[0],
      amount_usd: '',
      amount_kes: '',
      payment_method: '',
      reference: '',
      notes: '',
    });
    setPaymentDialogOpen(true);
  }

  async function handleSavePayment() {
    if (!selectedInvoice || !user) return;

    const amountUsd = parseFloat(paymentForm.amount_usd);
    if (!amountUsd || amountUsd <= 0) {
      toast.error('Please enter a valid USD amount');
      return;
    }
    if (amountUsd > selectedInvoice.balance) {
      toast.error('Payment amount exceeds outstanding balance');
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const { error } = await supabase.from('payments').insert({
      invoice_id: selectedInvoice.id,
      payment_date: paymentForm.payment_date,
      amount_usd: amountUsd,
      amount_kes: paymentForm.amount_kes ? parseFloat(paymentForm.amount_kes) : null,
      payment_method: paymentForm.payment_method || null,
      reference: paymentForm.reference || null,
      notes: paymentForm.notes || null,
      recorded_by: user.id,
    });

    setSaving(false);

    if (error) {
      toast.error(getUserErrorMessage('Unable to record this payment right now. Please try again.'));
      return;
    }

    toast.success('Payment recorded successfully');
    setPaymentDialogOpen(false);
    loadData();
  }

  return (
    <div>
      <PageHeader title="Outstanding Receivables" description="Unpaid invoices and aging analysis">
        <Button size="sm" variant="outline" className="gap-1" onClick={exportCSV}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={exportPdf}>
          <FileDown className="h-4 w-4" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        <ExecutiveInsightPanel lines={[
          overdue90Total === 0 ? 'Zero long-overdue debt — clean book.' : `90+ day debt at ${formatCompactCurrency(overdue90Total, 'USD')} needs action.`,
          overdue90Count === 0 ? 'No urgent collections needed.' : `${overdue90Count} invoice(s) require immediate collections follow-up.`,
          overdue90Total > 0 ? 'Recommend weekly review until aging mix improves.' : 'Collections healthy — no immediate action needed.',
        ]} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveKpiCard label="Total Outstanding" value={formatCompactCurrency(totalOutstanding, 'USD')} trend="Watch weekly" />
          <ExecutiveKpiCard label="Overdue 90+ Days" value={overdue90Total === 0 ? formatCurrency(0, 'USD') : formatCompactCurrency(overdue90Total, 'USD')} trend={overdue90Total === 0 ? 'Clean' : 'Action Needed'} positive={overdue90Total === 0} />
          <ExecutiveKpiCard label="Avg Days Outstanding" value={`${avgDaysOutstanding} days`} trend="Cycle speed" />
          <ExecutiveKpiCard label="Invoices Outstanding" value={`${invoices.length}`} trend="Open ledger" />
        </div>

        {/* Aging Summary Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Aging Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingChartData} layout="vertical" margin={{ left: 80, right: 40 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `USD ${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="bucket" width={80} />
                  <Tooltip
                    formatter={(value) => [formatCurrency(Number(value), 'USD'), 'Total']}
                  />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                    {agingChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={chartBarColors[index]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Detailed Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Invoice Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount (USD)</TableHead>
                  <TableHead className="text-right">Paid (USD)</TableHead>
                  <TableHead className="text-right">Outstanding (USD)</TableHead>
                  <TableHead className="text-right">Age (days)</TableHead>
                  <TableHead>Status</TableHead>
                  {canAct && <TableHead className="w-[120px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={canAct ? 10 : 9} className="text-center py-8 text-muted-foreground">
                      Please wait
                    </TableCell>
                  </TableRow>
                ) : invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={canAct ? 10 : 9} className="text-center py-8 text-muted-foreground">
                      No outstanding receivables
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">
                        {inv.invoice_number}
                        {inv.isBackdatedInv && (
                          <Badge variant="secondary" className="ml-2 bg-purple-100 text-purple-700 text-[10px]">
                            Backdated
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{inv.project_name}</TableCell>
                      <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                      <TableCell>{inv.due_date ? formatDate(inv.due_date) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(inv.amount_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-emerald-600">
                        {inv.totalPaid > 0 ? formatCurrency(inv.totalPaid, 'USD') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold text-rose-600">
                        {formatCurrency(inv.balance, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {inv.aging.days}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={bucketColors[inv.aging.bucket] || ''}>
                          {inv.aging.bucket}
                        </Badge>
                      </TableCell>
                      {canAct && (
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
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Record Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          {selectedInvoice && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                <p><span className="font-medium">Invoice:</span> {selectedInvoice.invoice_number}</p>
                <p><span className="font-medium">Project:</span> {selectedInvoice.project_name}</p>
                <p><span className="font-medium">Outstanding:</span> {formatCurrency(selectedInvoice.balance, 'USD')}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="payment_date">Payment Date</Label>
                  <Input
                    id="payment_date"
                    type="date"
                    value={paymentForm.payment_date}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, payment_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="amount_usd">Amount USD</Label>
                  <Input
                    id="amount_usd"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={paymentForm.amount_usd}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amount_usd: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="amount_kes">Amount KES (optional)</Label>
                  <Input
                    id="amount_kes"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={paymentForm.amount_kes}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, amount_kes: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="payment_method">Payment Method</Label>
                  <Input
                    id="payment_method"
                    placeholder="e.g. Wire, M-Pesa, Check"
                    value={paymentForm.payment_method}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, payment_method: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="reference">Reference</Label>
                  <Input
                    id="reference"
                    placeholder="Transaction reference"
                    value={paymentForm.reference}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Optional notes"
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePayment} disabled={saving}>
              {saving ? 'Saving...' : 'Save Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
