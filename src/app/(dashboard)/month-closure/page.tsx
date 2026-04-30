'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { AlertTriangle, Lock, Unlock, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import { DashboardAlert } from '@/components/common/dashboard-alert';

import { cn } from '@/lib/utils';

interface Warning {
  warning_type: string;
  warning_message: string;
  severity: string;
}

const STATUS_TONE: Record<string, { rail: string; pill: string; icon: 'open' | 'closed' }> = {
  open: {
    rail: 'border-l-[var(--info)]',
    pill: 'bg-info-soft text-info-soft-foreground',
    icon: 'open',
  },
  under_review: {
    rail: 'border-l-[var(--gold)]',
    pill: 'bg-warning-soft text-warning-soft-foreground',
    icon: 'open',
  },
  closed: {
    rail: 'border-l-[var(--success)]',
    pill: 'bg-success-soft text-success-soft-foreground',
    icon: 'closed',
  },
  locked: {
    rail: 'border-l-[var(--paper-4)]',
    pill: 'bg-[var(--paper-3)] text-foreground',
    icon: 'closed',
  },
};

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-danger-soft text-danger-soft-foreground',
  high: 'bg-[oklch(0.95_0.10_50)] text-[oklch(0.42_0.15_55)]',
  medium: 'bg-warning-soft text-warning-soft-foreground',
  low: 'bg-[var(--paper-3)] text-muted-foreground',
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

    const { data: mc } = await supabase
      .from('month_closures')
      .select('status')
      .eq('year_month', selectedMonth)
      .single();
    setMonthStatus(mc?.status || 'open');

    const { data: warningData } = await supabase.rpc('fn_month_closure_warnings', {
      p_year_month: selectedMonth,
    });
    const allWarnings = warningData || [];

    // HARD BLOCK: accountant misc report
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
    try {
      const res = await fetch('/api/month-closure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          year_month: selectedMonth,
          warnings_acknowledged: warnings.map((w) => w.warning_type),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(getUserErrorMessage(payload?.error));
        return;
      }
      toast.success('Month closed successfully');
      setShowCloseDialog(false);
      loadData();
    } catch (error) {
      toast.error(getUserErrorMessage(error, 'Failed to close month.'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReopen() {
    if (!reopenReason.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/month-closure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reopen',
          year_month: selectedMonth,
          reason: reopenReason,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(getUserErrorMessage(payload?.error));
        return;
      }
      toast.success('Month reopened');
      setShowReopenDialog(false);
      setReopenReason('');
      loadData();
    } catch (error) {
      toast.error(getUserErrorMessage(error, 'Failed to reopen month.'));
    } finally {
      setLoading(false);
    }
  }

  const isCfo = user?.role === 'cfo';
  const canClose = isCfo && (monthStatus === 'open' || monthStatus === 'under_review');
  const canReopen = isCfo && (monthStatus === 'closed' || monthStatus === 'locked');
  const tone = STATUS_TONE[monthStatus] || STATUS_TONE.open!;
  const isLocked = tone.icon === 'closed';

  const monthSelect = (
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
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      {canClose && (
        <Button size="sm" className="gap-1.5" onClick={() => setShowCloseDialog(true)}>
          <Lock className="size-3.5" /> Close month
        </Button>
      )}
      {canReopen && (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowReopenDialog(true)}>
          <Unlock className="size-3.5" /> Reopen
        </Button>
      )}
    </div>
  );

  const subtitle = `${formatYearMonth(selectedMonth)} · status: ${capitalize(monthStatus.replace(/_/g, ' '))}${warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ' · all checks clear'}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Month"
        accent="closure"
        subtitle={subtitle}
        action={headerActions}
      />

      <div className="mt-6 space-y-6">
        {/* Status banner */}
        <div
          className={cn(
            'grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[var(--radius-lg)] border border-border bg-card px-5 py-4',
            'border-l-[3px]',
            tone.rail,
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--paper-2)]">
            {isLocked ? (
              <Lock className="size-5 text-foreground" strokeWidth={1.75} />
            ) : (
              <Unlock className="size-5 text-foreground" strokeWidth={1.75} />
            )}
          </div>
          <div className="min-w-0">
            <h2
              className="font-display text-[18px] font-medium leading-tight tracking-[-0.005em] text-foreground"
              style={{ fontVariationSettings: '"opsz" 28' }}
            >
              {formatYearMonth(selectedMonth)}{' '}
              <em className="font-normal italic" style={{ color: 'var(--gold-lo)' }}>
                {isLocked ? 'is locked' : 'remains open'}
              </em>
            </h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
              {isLocked
                ? 'Financial records for this period are sealed. Reopen requires CFO authorisation and is audit logged.'
                : warnings.length === 0
                  ? 'All pre-closure checks have passed. Ready to close when CFO authorises.'
                  : `Resolve ${warnings.length} warning${warnings.length === 1 ? '' : 's'} below before closing.`}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
              tone.pill,
            )}
          >
            {capitalize(monthStatus.replace(/_/g, ' '))}
          </span>
        </div>

        {/* Pre-closure checks list-frame */}
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="flex items-baseline justify-between border-b border-border bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span>Pre-closure checks</span>
            <span>
              {warnings.length === 0
                ? 'All clear'
                : `${warnings.length} item${warnings.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {warnings.length === 0 ? (
            <div className="flex items-center gap-2.5 px-5 py-6 text-[13px] text-success-soft-foreground">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>All checks passed — ready for closure.</span>
            </div>
          ) : (
            warnings.map((w, i) => {
              const sevTone = SEVERITY_TONE[w.severity] || SEVERITY_TONE.low!;
              return (
                <div
                  key={i}
                  className="grid grid-cols-[100px_1fr] items-start gap-4 border-b border-border-subtle px-5 py-3.5 last:border-b-0"
                >
                  <span
                    className={cn(
                      'inline-flex w-fit items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                      sevTone,
                    )}
                  >
                    {w.severity}
                  </span>
                  <p className="text-[13px] leading-[1.55] text-foreground">{w.warning_message}</p>
                </div>
              );
            })
          )}
        </section>

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
                description={
                  <ul className="list-disc list-inside space-y-1">
                    {warnings.map((w, i) => (
                      <li key={i}>{w.warning_message}</li>
                    ))}
                  </ul>
                }
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
