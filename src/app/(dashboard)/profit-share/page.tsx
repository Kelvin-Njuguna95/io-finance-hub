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
import { formatCurrency, getCurrentYearMonth, formatYearMonth, capitalize, formatDate } from '@/lib/format';
import { formatKES } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { toast } from 'sonner';

interface PayoutWithdrawal {
  id: string;
  payout_type: 'full' | 'partial' | null;
  amount_usd: number;
  amount_kes: number;
  withdrawal_date: string;
  users?: { full_name: string | null } | null;
}

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
  total_paid_out?: number;
  balance_remaining?: number;
  payout_status?: 'unpaid' | 'partial' | 'paid';
}

function PayoutStatusBadge({ status }: { status: string }) {
  const styles = {
    unpaid: 'bg-slate-100 text-slate-600',
    partial: 'bg-amber-100 text-amber-700',
    paid: 'bg-green-100 text-green-700',
  };
  const labels = {
    unpaid: 'Not Paid',
    partial: 'Partial',
    paid: 'Fully Paid',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', styles[status as keyof typeof styles] ?? styles.unpaid)}>
      {labels[status as keyof typeof labels] ?? status}
    </span>
  );
}

export default function ProfitSharePage() {
  const { user } = useUser();
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [disputeTarget, setDisputeTarget] = useState<ProjectShare | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [payoutHistory, setPayoutHistory] = useState<Record<string, PayoutWithdrawal[]>>({});

  const prevDate = new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 2, 1);
  const revenueSourceMonth = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  useEffect(() => { load(); }, [selectedMonth]);

  async function loadPayoutHistory(recordId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from('withdrawals')
      .select('id, payout_type, amount_usd, amount_kes, withdrawal_date, users:recorded_by(full_name)')
      .eq('profit_share_record_id', recordId)
      .eq('withdrawal_type', 'director_payout')
      .order('withdrawal_date', { ascending: false });

    setPayoutHistory((prev) => ({ ...prev, [recordId]: (data || []) as PayoutWithdrawal[] }));
  }

  async function toggleExpanded(recordId: string) {
    if (expandedRecordId === recordId) {
      setExpandedRecordId(null);
      return;
    }
    setExpandedRecordId(recordId);
    if (!payoutHistory[recordId]) {
      await loadPayoutHistory(recordId);
    }
  }

  async function load() {
    setLoading(true);
    const supabase = createClient();

    const { data: existingRecords } = await supabase
      .from('profit_share_records')
      .select('*, projects(name)')
      .eq('year_month', selectedMonth)
      .order('director_tag');

    if (existingRecords && existingRecords.length > 0) {
      setShares(existingRecords.map((r: {
        projects?: { name?: string } | null;
        director_tag: string;
        distributable_profit_kes: number;
        director_share_kes: number;
        company_share_kes: number;
        id: string;
        status: string;
        total_paid_out?: number | null;
        balance_remaining?: number | null;
        payout_status?: 'unpaid' | 'partial' | 'paid' | null;
      }) => ({
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
        total_paid_out: Number(r.total_paid_out || 0),
        balance_remaining: Number(r.balance_remaining ?? r.director_share_kes ?? 0),
        payout_status: (r.payout_status || 'unpaid') as 'unpaid' | 'partial' | 'paid',
      })));
      setLoading(false);
      return;
    }

    const { data: projects } = await supabase.from('projects').select('id, name, director_tag').eq('is_active', true);
    const { data: rateSetting } = await supabase.from('system_settings').select('value').eq('key', 'standard_exchange_rate').single();
    const stdRate = parseFloat(rateSetting?.value || '129.5');

    const { data: invoices } = await supabase.from('invoices').select('project_id, amount_usd, amount_kes').eq('billing_period', revenueSourceMonth);
    const { data: expenses } = await supabase.from('expenses').select('project_id, amount_kes').eq('year_month', selectedMonth).eq('expense_type', 'project_expense');

    const invMap = new Map<string, number>();
    (invoices || []).forEach((i: { project_id: string; amount_kes: number; amount_usd: number }) => {
      const kes = Number(i.amount_kes) > 0 ? Number(i.amount_kes) : Math.round(Number(i.amount_usd) * stdRate * 100) / 100;
      invMap.set(i.project_id, (invMap.get(i.project_id) || 0) + kes);
    });

    const expMap = new Map<string, number>();
    (expenses || []).forEach((e: { project_id: string; amount_kes: number }) => {
      expMap.set(e.project_id, (expMap.get(e.project_id) || 0) + Number(e.amount_kes));
    });

    const rows: ProjectShare[] = (projects || [])
      .map((p: { id: string; name: string; director_tag: string }) => {
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

  const userRole = user?.role ?? null;
  const isCfo = userRole === 'cfo';
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
        {userRole === 'cfo' && (
          <Button
            onClick={() => {
              window.location.href = '/profit-share/payouts';
            }}
          >
            + Initiate Payout
          </Button>
        )}
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
                  {!isLiveData && <TableHead className="text-right">Paid Out</TableHead>}
                  {!isLiveData && <TableHead className="text-right">Remaining</TableHead>}
                  {!isLiveData && <TableHead>Payout Status</TableHead>}
                  {!isLiveData && <TableHead>Status</TableHead>}
                  {isCfo && !isLiveData && <TableHead className="w-[180px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">Please wait</TableCell>
                  </TableRow>
                ) : shares.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      No profit share data for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {shares.map((r, i) => (
                      <TableRow key={`row-${r.record_id || i}`}>
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
                          <>
                            <TableCell className="text-right font-mono text-sm">{formatKES(r.total_paid_out || 0)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{formatKES(r.balance_remaining ?? r.director_share)}</TableCell>
                            <TableCell><PayoutStatusBadge status={r.payout_status || 'unpaid'} /></TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={statusColors[r.record_status || 'pending_review']}>
                                {capitalize(r.record_status || 'pending_review')}
                              </Badge>
                            </TableCell>
                          </>
                        )}
                        {isCfo && !isLiveData && (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {r.record_status === 'pending_review' && r.record_id && (
                                <>
                                  <Button variant="ghost" size="icon" onClick={() => handleApprove(r.record_id!)} title="Approve">
                                    <Check className="h-4 w-4 text-green-600" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => setDisputeTarget(r)} title="Dispute">
                                    <X className="h-4 w-4 text-red-600" />
                                  </Button>
                                </>
                              )}
                              {r.record_id && (
                                <Button variant="ghost" size="sm" onClick={() => toggleExpanded(r.record_id!)}>
                                  {expandedRecordId === r.record_id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              )}
                              {r.record_id && r.payout_status !== 'paid' && (
                                <Button
                                  variant="link"
                                  className="text-xs text-amber-700 hover:text-amber-900 font-medium p-0"
                                  onClick={() => {
                                    window.location.href = `/withdrawals?type=director_payout&profit_share_record_id=${r.record_id}`;
                                  }}
                                >
                                  Record Payout →
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {shares.map((r, i) => (
                      expandedRecordId === r.record_id ? (
                        <TableRow key={r.record_id || i}>
                            <TableCell colSpan={12} className="bg-amber-50 p-4">
                              <p className="text-xs font-medium text-amber-800 mb-2">Payout History</p>
                              {(payoutHistory[r.record_id || ''] || []).length === 0 ? (
                                <p className="text-xs text-slate-500">No payouts recorded yet.</p>
                              ) : (
                                <table className="text-xs w-full">
                                  <thead>
                                    <tr className="text-slate-500">
                                      <th className="text-left">Date</th>
                                      <th className="text-left">Type</th>
                                      <th className="text-right">Amount (USD)</th>
                                      <th className="text-right">Amount (KES)</th>
                                      <th className="text-left">Recorded by</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(payoutHistory[r.record_id || ''] || []).map((w) => (
                                      <tr key={w.id}>
                                        <td>{formatDate(w.withdrawal_date)}</td>
                                        <td className="capitalize">{w.payout_type || '—'}</td>
                                        <td className="text-right">USD {Number(w.amount_usd || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="text-right">{formatKES(Number(w.amount_kes || 0))}</td>
                                        <td>{w.users?.full_name || '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </TableCell>
                          </TableRow>
                      ) : null
                    ))}
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell colSpan={4} className="text-right">Total</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalDistributable, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-600">{formatCurrency(totalDirectorShare, 'KES')}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(totalCompanyShare, 'KES')}</TableCell>
                      {!isLiveData && <TableCell></TableCell>}
                      {!isLiveData && <TableCell></TableCell>}
                      {!isLiveData && <TableCell></TableCell>}
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
