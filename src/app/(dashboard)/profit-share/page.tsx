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

const statusColors: Record<string, string> = {
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-700',
};

export default function ProfitSharePage() {
  const { user } = useUser();
  const [records, setRecords] = useState<(ProfitShareRecord & { project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [disputeRecord, setDisputeRecord] = useState<ProfitShareRecord | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  useEffect(() => {
    load();
  }, [selectedMonth]);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from('profit_share_records')
      .select('*, projects(name)')
      .eq('year_month', selectedMonth)
      .order('director_tag');

    setRecords(
      (data || []).map((r: Record<string, unknown>) => ({
        ...r,
        project_name: (r.projects as Record<string, unknown>)?.name as string | undefined,
      })) as (ProfitShareRecord & { project_name?: string })[]
    );
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
    if (!disputeRecord || !disputeReason.trim()) return;
    const supabase = createClient();
    await supabase.from('profit_share_records').update({
      status: 'disputed',
      dispute_reason: disputeReason,
    }).eq('id', disputeRecord.id);
    setDisputeRecord(null);
    setDisputeReason('');
    toast.success('Profit share disputed');
    load();
  }

  const isCfo = user?.role === 'cfo';
  const totalDirectorShare = records.reduce((s, r) => s + Number(r.director_share_usd), 0);
  const totalCompanyShare = records.reduce((s, r) => s + Number(r.company_share_usd), 0);

  return (
    <div>
      <PageHeader title="Profit Share" description="70/30 profit distribution by project">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6 space-y-4">
        <div className="flex gap-6 text-sm">
          <span>Director Share (70%): <strong>{formatCurrency(totalDirectorShare, 'USD')}</strong></span>
          <span>Company Share (30%): <strong>{formatCurrency(totalCompanyShare, 'USD')}</strong></span>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Director</TableHead>
                  <TableHead className="text-right">Distributable</TableHead>
                  <TableHead className="text-right">Director (70%)</TableHead>
                  <TableHead className="text-right">Company (30%)</TableHead>
                  <TableHead>Status</TableHead>
                  {isCfo && <TableHead className="w-[100px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isCfo ? 7 : 6} className="text-center py-8 text-neutral-500">
                      No profit share records for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.project_name}</TableCell>
                      <TableCell>{capitalize(r.director_tag)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(r.distributable_profit_usd), 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(r.director_share_usd), 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(Number(r.company_share_usd), 'USD')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColors[r.status]}>
                          {capitalize(r.status)}
                        </Badge>
                      </TableCell>
                      {isCfo && (
                        <TableCell>
                          {r.status === 'pending_review' && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => handleApprove(r.id)}
                                title="Approve"
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => setDisputeRecord(r)}
                                title="Dispute"
                              >
                                <X className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!disputeRecord} onOpenChange={() => setDisputeRecord(null)}>
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
              <Button variant="outline" onClick={() => setDisputeRecord(null)}>Cancel</Button>
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
