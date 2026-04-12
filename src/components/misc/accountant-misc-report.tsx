'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { formatCurrency, formatDate } from '@/lib/format';
import { Plus, Trash2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';

interface ApprovedRequest {
  id: string;
  purpose: string;
  amount_requested: number;
  amount_approved: number;
}

interface ReportItem {
  id?: string;
  description: string;
  amount: number;
  expense_date: string;
  misc_request_id: string;
  receipt_url: string;
  isNew?: boolean;
}

interface MiscReport {
  id: string;
  status: string;
  total_approved: number;
  total_claimed: number;
  variance: number;
}

export function AccountantMiscReport() {
  const { user } = useUser();
  const [approvedRequests, setApprovedRequests] = useState<ApprovedRequest[]>([]);
  const [report, setReport] = useState<MiscReport | null>(null);
  const [items, setItems] = useState<ReportItem[]>([]);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  useEffect(() => { load(); }, []);

  async function load() {
    const supabase = createClient();

    // Get approved requests for this month
    const { data: reqs } = await supabase
      .from('accountant_misc_requests')
      .select('id, purpose, amount_requested, amount_approved')
      .eq('period_month', periodMonth)
      .in('status', ['approved', 'reported']);
    setApprovedRequests((reqs || []) as ApprovedRequest[]);

    // Get existing report
    const { data: rep } = await supabase
      .from('accountant_misc_report')
      .select('*')
      .eq('period_month', periodMonth)
      .single();

    if (rep) {
      setReport(rep as MiscReport);
      // Load items
      const { data: itemData } = await supabase
        .from('accountant_misc_report_items')
        .select('*')
        .eq('accountant_misc_report_id', rep.id)
        .order('expense_date');
      setItems((itemData || []) as ReportItem[]);
    }
  }

  async function createReport() {
    const supabase = createClient();
    const totalApproved = approvedRequests.reduce((s, r) => s + Number(r.amount_approved), 0);

    const { data, error } = await supabase.from('accountant_misc_report').insert({
      period_month: periodMonth,
      submitted_by: user!.id,
      total_approved: totalApproved,
    }).select().single();

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      setReport(data as MiscReport);
      toast.success('Misc report created');
    }
  }

  function addItem() {
    setItems([...items, {
      description: '',
      amount: 0,
      expense_date: new Date().toISOString().split('T')[0],
      misc_request_id: '',
      receipt_url: '',
      isNew: true,
    }]);
  }

  function updateItem(idx: number, field: string, value: string | number) {
    setItems(items.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    const supabase = createClient();

    // Delete existing items and re-insert all
    await supabase.from('accountant_misc_report_items').delete().eq('accountant_misc_report_id', report.id);

    const rows = items.filter(i => i.description.trim() && i.amount > 0).map(i => ({
      accountant_misc_report_id: report.id,
      misc_request_id: i.misc_request_id || null,
      description: i.description,
      amount: i.amount,
      expense_date: i.expense_date,
      receipt_url: i.receipt_url || null,
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from('accountant_misc_report_items').insert(rows);
      if (error) { toast.error(getUserErrorMessage()); setSaving(false); return; }
    }

    toast.success('Report saved');
    setSaving(false);
    load();
  }

  async function handleSubmit() {
    if (!report) return;
    await handleSave();
    const supabase = createClient();
    await supabase.from('accountant_misc_report').update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }).eq('id', report.id);

    // Mark all approved requests as reported
    await supabase.from('accountant_misc_requests')
      .update({ status: 'reported' })
      .eq('period_month', periodMonth)
      .eq('status', 'approved');

    toast.success('Report submitted for CFO review');
    load();
  }

  const totalClaimed = items.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalApproved = approvedRequests.reduce((s, r) => s + Number(r.amount_approved), 0);
  const variance = totalApproved - totalClaimed;

  if (approvedRequests.length === 0) {
    return null; // Hide if no approved requests
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Monthly Misc Report — {new Intl.DateTimeFormat('en-KE', { month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' }).format(now)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Reference panel — approved requests */}
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">Approved Requests This Month</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Purpose</TableHead>
                <TableHead className="text-xs text-right">Requested</TableHead>
                <TableHead className="text-xs text-right">Approved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvedRequests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{r.purpose}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatCurrency(r.amount_requested, 'KES')}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">{formatCurrency(r.amount_approved, 'KES')}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={2} className="text-right text-sm">Total Approved</TableCell>
                <TableCell className="text-right font-mono text-sm">{formatCurrency(totalApproved, 'KES')}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {!report ? (
          <Button onClick={createReport} className="w-full">Create Misc Report for This Month</Button>
        ) : (
          <>
            {/* Status */}
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className={
                report.status === 'draft' ? 'bg-muted text-foreground/90' :
                report.status === 'submitted' ? 'bg-info-soft text-info-soft-foreground' :
                'bg-success-soft text-success-soft-foreground'
              }>
                {report.status === 'cfo_reviewed' ? 'CFO Reviewed' : report.status}
              </Badge>
              <div className="flex gap-4 text-sm">
                <span>Claimed: <strong>{formatCurrency(totalClaimed, 'KES')}</strong></span>
                <span className={variance < 0 ? 'text-danger-soft-foreground font-medium' : 'text-success-soft-foreground'}>
                  Variance: {formatCurrency(variance, 'KES')}
                </span>
              </div>
            </div>

            <Separator />

            {/* Itemised spend entry */}
            {report.status === 'draft' && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={addItem} className="gap-1">
                  <Plus className="h-3 w-3" /> Add Item
                </Button>
              </div>
            )}

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 text-center">No expenditure items yet. Click "Add Item" to start.</p>
            ) : (
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-md border p-2">
                    <div className="col-span-2">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={item.expense_date} onChange={(e) => updateItem(idx, 'expense_date', e.target.value)} disabled={report.status !== 'draft'} className="text-sm" />
                    </div>
                    <div className="col-span-4">
                      <Label className="text-xs">Description</Label>
                      <Input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} disabled={report.status !== 'draft'} className="text-sm" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Amount (KES)</Label>
                      <Input type="number" step="0.01" value={item.amount || ''} onChange={(e) => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)} disabled={report.status !== 'draft'} className="text-sm" />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Linked Request</Label>
                      <select
                        className="w-full rounded-md border px-2 py-1.5 text-sm"
                        value={item.misc_request_id}
                        onChange={(e) => updateItem(idx, 'misc_request_id', e.target.value)}
                        disabled={report.status !== 'draft'}
                      >
                        <option value="">—</option>
                        {approvedRequests.map((r) => (
                          <option key={r.id} value={r.id}>{r.purpose.substring(0, 30)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      {report.status === 'draft' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-3 w-3 text-danger-soft-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {report.status === 'draft' && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleSave} disabled={saving} className="gap-1">
                  <Save className="h-4 w-4" /> Save Draft
                </Button>
                <Button onClick={handleSubmit} disabled={saving} className="gap-1">
                  <Send className="h-4 w-4" /> Submit Report
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
