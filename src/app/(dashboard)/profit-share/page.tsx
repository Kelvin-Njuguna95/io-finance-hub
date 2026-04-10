'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Check, X } from 'lucide-react';
import type { ProfitShareRecord } from '@/types/database';
import { toast } from 'sonner';

interface ProjectShare {
  project_name: string;
  director_tag: string;
  revenue: number;
  direct_costs: number;
  distributable_profit: number;
  director_share: number;
  company_share: number;
  source: 'live' | 'record';
  record_id?: string;
  record_status?: string;
}

export default function ProfitSharePage() {
  const { user } = useUser();
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [disputeTarget, setDisputeTarget] = useState<ProjectShare | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [loading, setLoading] = useState(true);

  const prevDate = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 2, 1);
  const revenueSourceMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  useEffect(() => { load(); }, [selectedMonth]);

  async function load() {
    setLoading(true);
    const supabase = createClient();

    // Check for existing profit share records first
    const { data: existingRecords } = await supabase
      .from('profit_share_records')
      .select('*, projects(name)')
      .eq('year_month', selectedMonth)
      .order('director_tag');

    if (existingRecords && existingRecords.length > 0) {
      setShares(existingRecords.map((r: /* // */ any) => ({
        project_name: r.projects?.name || '—',
        director_tag: r.director_tag,
        revenue: 0,
        direct_costs: 0,
        distributable_profit: Number(r.distributable_profit_kes),
        director_share: Number(r.director_share_kes),
        company_share: Number(r.company_share_kes),
        source: 'record' as const,
        record_id: r.id,
        record_status: r.status,
      })));
      setLoading(false);
      return;
    }

    // Compute live from lagged revenue
    const { data: projects } = await supabase.from('projects').select('id, name, director_tag').eq('is_active', true);
    const { data: rateSetting } = await supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
    const stdRate = parseFloat(rateSetting?.value || '129.5');

    const { data: invoices } = await supabase.from('invoices').select('project_id, amount_usd, amount_kes').eq('billing_period', revenueSourceMonth);
    const { data: expenses } = await supabase.from('expenses').select('project_id, amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense');

    const invMap = new Map<string, number>();
    (invoices || []).forEach((i: /* // */ any) => {
      const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
      invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
    });

    const expMap = new Map<string, number>();
    (expenses || []).forEach((e: /* // */ any) => {
      expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
    });

    const rows: ProjectShare[] = (projects || [])
      .map((p: /* // */ any) => {
        const revenue = invMap.get(p.id) || 0;
        const directCosts = expMap.get(p.id) || 0;
        const distributable = revenue - directCosts;
        const directorShare = distributable > 0 ? Math.round(distributable * 0.70 * 100) / 100 : 0;
        const companyShare = distributable > 0 ? Math.round(distributable * 0.30 * 100) / 100 : 0;
        return {
          project_name: p.name,
          director_tag: p.director_tag,
          revenue,
          direct_costs: directCosts,
          distributable_profit: distributable,
          director_share: directorShare,
          company_share: companyShare,
          source: 'live' as const,
        };
      })
      .filter(r => r.revenue > 0 || r.direct_costs > 0)
      .sort((a, b) => b.distributable_profit - a.distributable_profit);

    setShares(rows);
    setLoading(false);
  }

  async function handleApprove(recordId: string) {
    const supabase = createClient();
    await supabase.from('profit_share_records').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', recordId);
    toast.success('Profit share approved');
    load();
  }

  async function handleDispute() {
    if (!disputeTarget?.record_id || !disputeReason.trim()) return;
    const supabase = createClient();
    await supabase.from('profit_share_records').update({
      status: 'disputed',
      dispute_reason: disputeReason,
    }).eq('id', disputeTarget.record_id);
    setDisputeTarget(null);
    setDisputeReason('');
    toast.success('Profit share disputed');
    load();
  }

  const isCfo = user?.role === 'cfo';
  const totalDirectorShare = shares.reduce((s, r) => s + r.director_share, 0);
  const totalCompanyShare = shares.reduce((s, r) => s + r.company_share, 0);
  const totalDistributable = shares.reduce((s, r) => s + (r.distributable_profit > 0 ? r.distributable_profit : 0), 0);
  const isLiveData = shares.length > 0 && shares[0].source === 'live';

  const statusColors: Record<string, string> = {
    pending_review: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    disputed: 'bg-rose-100 text-rose-700',
  };

  return (
    <div>
      <PageHeader title="Profit Share" description={'70/30 distribution — revenue from ' + formatYearMonth(revenueSourceMonth) + ' invoice'}>
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6 space-y-4">
        {isLiveData && (
          <div className="alert-info rounded-lg p-3 text-sm">
            These figures are computed live from current data. They will be finalized when the month is closed.
          </div>
        )}

        <div className="flex gap-6 text-sm">
          <span>Distributable Profit: <strong>{formatCurrency(totalDistributable, 'KES')}</strong></span>
          <span>Director Share (70%): <strong className="text-emerald-600">{formatCurrency(totalDirectorShare, 'KES')}</strong></span>
          <span>Company Share (30%): <strong>{formatCurrency(totalCompanyShare, 'KES')}</strong></span>
        </div>

        <Card className="io-card">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Director</TableHead>
                  <TableHead className="text-right">Revenue (KES)</TableHead>
                  <TableHead className="text-right">Expenses (KES)</TableHead>
                  <TableHead className="text-right">Distributable</TableHead>
                  <TableHead className="text-right">Director (70%)</TableHead>
                  <TableHead className="text-right">Company (30%)</TableHead>
                  {!isLiveData && <TableHead>Status</TableHead>}
                  {isCfo && !isLiveData && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Please wait</TableCell>
                  </TableRow>
                ) : shares.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No profit share data for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {shares.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.project_name}</TableCell>
                        <TableCell>{capitalize(r.director_tag)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{formatCurrency(r.revenue, 'KES')}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-red-600">{formatCurrency(r.direct_costs, 'KES')}</TableCell>
                        <TableCell className={`text-right font-mono text-sm font-semibold ${r.distributable_profit < 0 ? 'text-red-600' : ''}`}>
                          {formatCurrency(r.distributable_profit, 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-emerald-600">
                          {r.director_share > 0 ? formatCurrency(r.director_share, 'KES') : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {r.company_share > 0 ? formatCurrency(r.company_share, 'KES') : '—'}
                        </TableCell>
                        {!isLiveData && (
                          <TableCell>
                            <Badge variant="secondary" className={statusColors[r.record_status || 'pending_review']}>
                              {capitalize(r.record_status || 'pending_review')}
                            </Badge>
                          </TableCell>
                        )}
                        {isCfo && !isLiveData && (
                          <TableCell>
                            {r.record_status === 'pending_review' && r.record_id && (
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => handleApprove(r.record_id!)} title="Approve">
                                  <Check className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setDisputeTarget(r)} title="Dispute">
                                  <X className="h-4 w-4 text-red-600" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell colSpan={4} className="text-right">Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalDistributable, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600">{formatCurrency(totalDirectorShare, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalCompanyShare, 'KES')}</TableCell>
                      {!isLiveData && <TableCell></TableCell>}
                      {isCfo && !isLiveData && <TableCell></TableCell>}
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!disputeTarget} onOpenChange={() => setDisputeTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dispute Profit Share</DialogTitle>
            </DialogHeader>
            <Textarea
              placeholder="Reason for dispute (required)..."
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDisputeTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDispute} disabled={!disputeReason.trim()}>
                Submit Dispute
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
