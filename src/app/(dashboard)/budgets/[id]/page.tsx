'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, formatDateTime, capitalize } from '@/lib/format';
import { Check, X, History } from 'lucide-react';
import { toast } from 'sonner';
import type { Budget, BudgetVersion, BudgetItem, BudgetApproval } from '@/types/database';

const statusColors: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const router = useRouter();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [approvals, setApprovals] = useState<BudgetApproval[]>([]);
  const [activeVersion, setActiveVersion] = useState<BudgetVersion | null>(null);
  const [scopeName, setScopeName] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const supabase = createClient();

    const { data: b } = await supabase
      .from('budgets')
      .select('*, projects(name), departments(name)')
      .eq('id', id)
      .single();

    if (!b) {
      router.push('/budgets');
      return;
    }

    setBudget(b as Budget);
    setScopeName(
      (b.projects as { name: string } | null)?.name ||
      (b.departments as { name: string } | null)?.name ||
      '—'
    );

    const { data: vers } = await supabase
      .from('budget_versions')
      .select('*')
      .eq('budget_id', id)
      .order('version_number', { ascending: false });

    setVersions((vers || []) as BudgetVersion[]);

    const latestVersion = (vers || []).find(
      (v: BudgetVersion) => v.version_number === b.current_version
    ) || (vers || [])[0];

    if (latestVersion) {
      setActiveVersion(latestVersion as BudgetVersion);
      loadVersionItems((latestVersion as BudgetVersion).id);
    }

    const { data: apps } = await supabase
      .from('budget_approvals')
      .select('*')
      .in('budget_version_id', (vers || []).map((v: BudgetVersion) => v.id))
      .order('created_at', { ascending: false });

    setApprovals((apps || []) as BudgetApproval[]);
  }

  async function loadVersionItems(versionId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from('budget_items')
      .select('*')
      .eq('budget_version_id', versionId)
      .order('sort_order');
    setItems((data || []) as BudgetItem[]);
  }

  function selectVersion(v: BudgetVersion) {
    setActiveVersion(v);
    loadVersionItems(v.id);
  }

  async function handleApprove() {
    if (!activeVersion) return;
    setProcessing(true);
    const supabase = createClient();

    // Update version status
    await supabase.from('budget_versions').update({
      status: 'approved',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', activeVersion.id);

    // Create approval record
    await supabase.from('budget_approvals').insert({
      budget_version_id: activeVersion.id,
      action: 'approved',
      approved_by: user!.id,
    });

    toast.success('Budget approved');
    setProcessing(false);
    load();
  }

  async function handleReject() {
    if (!activeVersion || !rejectionReason.trim()) return;
    setProcessing(true);
    const supabase = createClient();

    // Update version status
    await supabase.from('budget_versions').update({
      status: 'rejected',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: rejectionReason,
    }).eq('id', activeVersion.id);

    // Create approval record
    await supabase.from('budget_approvals').insert({
      budget_version_id: activeVersion.id,
      action: 'rejected',
      approved_by: user!.id,
      reason: rejectionReason,
    });

    toast.success('Budget rejected');
    setShowRejectDialog(false);
    setRejectionReason('');
    setProcessing(false);
    load();
  }

  async function handleMarkUnderReview() {
    if (!activeVersion) return;
    const supabase = createClient();
    await supabase.from('budget_versions').update({
      status: 'under_review',
      reviewed_by: user!.id,
      reviewed_at: new Date().toISOString(),
    }).eq('id', activeVersion.id);
    toast.success('Budget marked as under review');
    load();
  }

  const isCfo = user?.role === 'cfo';
  const isAccountant = user?.role === 'accountant';
  const canApprove = isCfo && activeVersion?.status !== 'approved' && activeVersion?.status !== 'draft';
  const canMarkReview = isAccountant && activeVersion?.status === 'submitted';

  return (
    <div>
      <PageHeader title={`Budget — ${scopeName}`} description={budget?.year_month || ''}>
        {canApprove && (
          <div className="flex gap-2">
            <Button onClick={handleApprove} disabled={processing} className="gap-1" size="sm">
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowRejectDialog(true)}
              disabled={processing}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </div>
        )}
        {canMarkReview && (
          <Button onClick={handleMarkUnderReview} size="sm" variant="outline">
            Mark Under Review
          </Button>
        )}
      </PageHeader>

      <div className="p-6 space-y-6">
        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">Line Items</TabsTrigger>
            <TabsTrigger value="versions" className="gap-1">
              <History className="h-3 w-3" /> Version History ({versions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="space-y-4">
            {/* Version summary */}
            {activeVersion && (
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium">
                      Version {activeVersion.version_number}
                    </span>
                    <Badge variant="secondary" className={statusColors[activeVersion.status]}>
                      {capitalize(activeVersion.status)}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <span className="font-mono">{formatCurrency(activeVersion.total_amount_usd, 'USD')}</span>
                    <span className="font-mono">{formatCurrency(activeVersion.total_amount_kes, 'KES')}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeVersion?.rejection_reason && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-red-800">Rejection Reason</p>
                  <p className="text-sm text-red-700 mt-1">{activeVersion.rejection_reason}</p>
                </CardContent>
              </Card>
            )}

            {/* Items table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit (USD)</TableHead>
                      <TableHead className="text-right">Unit (KES)</TableHead>
                      <TableHead className="text-right">Total (USD)</TableHead>
                      <TableHead className="text-right">Total (KES)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={item.id}>
                        <TableCell className="text-neutral-400">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell className="text-sm text-neutral-500">{item.category || '—'}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(Number(item.unit_cost_usd || 0), 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(Number(item.unit_cost_kes || 0), 'KES')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatCurrency(Number(item.amount_usd), 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {formatCurrency(Number(item.amount_kes), 'KES')}
                        </TableCell>
                      </TableRow>
                    ))}
                    {items.length > 0 && (
                      <TableRow className="font-semibold">
                        <TableCell colSpan={6} className="text-right">Total</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(items.reduce((s, i) => s + Number(i.amount_usd), 0), 'USD')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(items.reduce((s, i) => s + Number(i.amount_kes), 0), 'KES')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="versions" className="space-y-2">
            {versions.map((v) => (
              <Card
                key={v.id}
                className={`cursor-pointer transition-colors ${v.id === activeVersion?.id ? 'border-neutral-900' : 'hover:border-neutral-300'}`}
                onClick={() => selectVersion(v)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">v{v.version_number}</span>
                    <Badge variant="secondary" className={statusColors[v.status]}>
                      {capitalize(v.status)}
                    </Badge>
                    {v.submitted_at && (
                      <span className="text-xs text-neutral-400">
                        Submitted {formatDateTime(v.submitted_at)}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-mono">
                    {formatCurrency(v.total_amount_usd, 'USD')}
                  </span>
                </CardContent>
              </Card>
            ))}

            {/* Approval history */}
            {approvals.length > 0 && (
              <>
                <Separator className="my-4" />
                <h3 className="text-sm font-medium mb-2">Approval History</h3>
                {approvals.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-sm rounded-md border p-3">
                    <Badge variant={a.action === 'approved' ? 'default' : 'destructive'}>
                      {a.action}
                    </Badge>
                    <span className="text-neutral-500">{formatDateTime(a.created_at)}</span>
                    {a.reason && <span className="text-neutral-600">— {a.reason}</span>}
                  </div>
                ))}
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Rejection dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Budget</DialogTitle>
            <DialogDescription>
              The submitter will need to revise and resubmit as a new version.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection (required)..."
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processing || !rejectionReason.trim()}
            >
              Reject Budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
