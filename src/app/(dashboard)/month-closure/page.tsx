'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { AlertTriangle, Lock, Unlock, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import { DashboardAlert } from '@/components/common/dashboard-alert';

interface Warning {
  warning_type: string;
  warning_message: string;
  severity: string;
}

const statusColors: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-green-100 text-green-700',
  locked: 'bg-neutral-100 text-neutral-700',
};

export default function MonthClosurePage() {
  const { user } = useUser();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [monthStatus, setMonthStatus] = useState<string>('open');
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showReopenDialog, setShowReopenDialog] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedMonth]);

  async function loadData() {
    const supabase = createClient();

    // Get month status
    const { data: mc } = await supabase
      .from('month_closures')
      .select('status')
      .eq('year_month', selectedMonth)
      .single();
    setMonthStatus(mc?.status || 'open');

    // Get warnings
    const { data: warningData } = await supabase.rpc('fn_month_closure_warnings', {
      p_year_month: selectedMonth,
    });
    const allWarnings = warningData || [];

    // Check accountant misc report — HARD BLOCK
    const periodMonth = selectedMonth + '-01';
    const { data: approvedReqs } = await supabase
      .from('accountant_misc_requests')
      .select('id', { count: 'exact', head: true })
      .eq('period_month', periodMonth)
      .eq('status', 'approved');

    if ((approvedReqs as /* // */ any)?.length > 0 || (approvedReqs as /* // */ any)?.count > 0) {
      const { data: miscReport } = await supabase
        .from('accountant_misc_report')
        .select('status')
        .eq('period_month', periodMonth)
        .single();

      if (!miscReport || miscReport.status === 'draft') {
        allWarnings.push({
          warning_type: 'accountant_misc_report_missing',
          warning_message: 'Accountant misc expenditure report has not been submitted. Month cannot be closed until this is complete.',
          severity: 'critical',
        });
      }
    }

    setWarnings(allWarnings);
  }

  async function handleClose() {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('fn_close_month', {
      p_year_month: selectedMonth,
      p_warnings_acknowledged: warnings.map((w) => w.warning_type),
    });

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Month closed successfully');
      setShowCloseDialog(false);
      loadData();
    }
    setLoading(false);
  }

  async function handleReopen() {
    if (!reopenReason.trim()) return;
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('fn_reopen_month', {
      p_year_month: selectedMonth,
      p_reason: reopenReason,
    });

    if (error) {
      toast.error(getUserErrorMessage());
    } else {
      toast.success('Month reopened');
      setShowReopenDialog(false);
      setReopenReason('');
      loadData();
    }
    setLoading(false);
  }

  const isCfo = user?.role === 'cfo';
  const canClose = isCfo && (monthStatus === 'open' || monthStatus === 'under_review');
  const canReopen = isCfo && (monthStatus === 'closed' || monthStatus === 'locked');

  return (
    <div>
      <PageHeader title="Month Closure" description="Close and lock financial periods">
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

      <div className="p-6 space-y-6">
        {/* Status */}
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              {monthStatus === 'closed' || monthStatus === 'locked' ? (
                <Lock className="h-5 w-5 text-neutral-500" />
              ) : (
                <Unlock className="h-5 w-5 text-blue-500" />
              )}
              <div>
                <p className="text-sm font-medium">{formatYearMonth(selectedMonth)}</p>
                <Badge variant="secondary" className={statusColors[monthStatus]}>
                  {capitalize(monthStatus)}
                </Badge>
              </div>
            </div>
            <div className="flex gap-2">
              {canClose && (
                <Button onClick={() => setShowCloseDialog(true)}>
                  Close Month
                </Button>
              )}
              {canReopen && (
                <Button variant="outline" onClick={() => setShowReopenDialog(true)}>
                  Reopen Month
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Warnings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Pre-Closure Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {warnings.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-600 py-2">
                <CheckCircle className="h-4 w-4" />
                All checks passed — ready for closure
              </div>
            ) : (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md border p-3">
                    <Badge
                      variant="secondary"
                      className={
                        w.severity === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : w.severity === 'high'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }
                    >
                      {w.severity}
                    </Badge>
                    <p className="text-sm">{w.warning_message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Close Dialog */}
        <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Close {formatYearMonth(selectedMonth)}</DialogTitle>
              <DialogDescription>
                This will calculate overhead allocations, project profitability, and profit share records.
                All agent counts and financial records for this period will be locked.
              </DialogDescription>
            </DialogHeader>
            {warnings.length > 0 && (
              <DashboardAlert
                variant="warning"
                title={`${warnings.length} warning(s) will be acknowledged:`}
                description={<ul className="list-disc list-inside space-y-1">
                  {warnings.map((w, i) => (
                    <li key={i}>{w.warning_message}</li>
                  ))}
                </ul>}
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCloseDialog(false)}>Cancel</Button>
              <Button onClick={handleClose} disabled={loading}>
                {loading ? 'Closing...' : 'Confirm Month Closure'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reopen Dialog */}
        <Dialog open={showReopenDialog} onOpenChange={setShowReopenDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reopen {formatYearMonth(selectedMonth)}</DialogTitle>
              <DialogDescription>
                This will unlock all records for this period. A reason is required and will be audit logged.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              placeholder="Reason for reopening (required)..."
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowReopenDialog(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleReopen} disabled={loading || !reopenReason.trim()}>
                {loading ? 'Reopening...' : 'Reopen Month'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
