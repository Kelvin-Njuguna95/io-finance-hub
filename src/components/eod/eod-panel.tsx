'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCompactKES, formatCurrency } from '@/lib/format';
import { Send, Clock, CheckCircle, AlertTriangle, Minus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

interface EodStatus {
  report_date: string;
  already_sent: boolean;
  existing_report: /* // */ any;
  has_activity: boolean;
  summary: {
    expense_count: number;
    expense_total_kes: number;
    withdrawal_count: number;
    cash_received_count: number;
    budget_action_count: number;
  };
}

const TODAY_LABEL = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  weekday: 'short',
  day: '2-digit',
  month: 'short',
}).format(new Date());

export function EodPanel() {
  const [status, setStatus] = useState<EodStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState('');
  const [isResend, setIsResend] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return {};
    return { 'Authorization': `Bearer ${session.access_token}` };
  }

  async function loadStatus() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/eod', { headers });
      const data = await res.json();
      setStatus(data);
    } catch {
      toast.error('Failed to load EOD status');
    }
    setLoading(false);
  }

  async function handleSend(resend = false) {
    setSending(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ trigger_type: 'manual', resend }),
      });
      const data = await res.json();

      if (data.success) {
        if (data.slack_status === 'success') {
          toast.success(resend ? 'EOD report updated and resent to Slack' : 'EOD report sent to Slack');
        } else {
          toast.error(`Report saved but Slack delivery failed: ${data.error_message}`);
        }
        setShowPreview(false);
        loadStatus();
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch {
      toast.error('Failed to send EOD report');
    }
    setSending(false);
  }

  function handlePreview(resend = false) {
    if (!status) return;
    setIsResend(resend);
    const lines: string[] = [];
    lines.push('IO Finance — End of Day Report');
    lines.push(
      new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date()),
    );
    lines.push('');
    lines.push(`Expenses: ${status.summary.expense_count} entries — ${formatCurrency(status.summary.expense_total_kes || 0, 'KES')}`);
    lines.push(`Withdrawals: ${status.summary.withdrawal_count} entries`);
    lines.push(`Cash Received: ${status.summary.cash_received_count} entries`);
    lines.push(`Budget Actions: ${status.summary.budget_action_count} submissions/reviews`);
    if (resend) {
      lines.push('');
      lines.push('⚠ This will replace the previously sent report with updated data.');
    }
    setPreview(lines.join('\n'));
    setShowPreview(true);
  }

  if (loading) {
    return (
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            EOD digest <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>{' '}
            <span className="text-foreground">{TODAY_LABEL}</span>
          </span>
        </div>
        <p className="px-5 py-6 text-center text-sm text-muted-foreground">Please wait</p>
      </section>
    );
  }

  const s = status;
  const sent = s?.already_sent;
  const hasActivity = s?.has_activity;

  // Check if data has changed since last send
  const existingCounts = sent
    ? {
        expenses: s?.existing_report?.expense_count || 0,
        withdrawals: s?.existing_report?.withdrawal_count || 0,
        budgets: s?.existing_report?.budget_action_count || 0,
        cashReceived: s?.existing_report?.cash_received_count || 0,
      }
    : null;
  const currentCounts = {
    expenses: s?.summary.expense_count || 0,
    withdrawals: s?.summary.withdrawal_count || 0,
    budgets: s?.summary.budget_action_count || 0,
    cashReceived: s?.summary.cash_received_count || 0,
  };
  const hasNewActivity =
    sent &&
    existingCounts &&
    (currentCounts.expenses !== existingCounts.expenses ||
      currentCounts.withdrawals !== existingCounts.withdrawals ||
      currentCounts.budgets !== existingCounts.budgets ||
      currentCounts.cashReceived !== existingCounts.cashReceived);

  // Status pill content
  let statusPillTone: string;
  let statusPillIcon: React.ReactNode;
  let statusPillLabel: string;
  if (sent) {
    const time = s?.existing_report?.created_at
      ? new Intl.DateTimeFormat('en-KE', {
          timeZone: 'Africa/Nairobi',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(s.existing_report.created_at))
      : '--:--';
    statusPillTone = 'bg-success-soft text-success-soft-foreground';
    statusPillIcon = <CheckCircle className="size-3" strokeWidth={2} aria-hidden />;
    statusPillLabel = `Sent ${time} EAT`;
  } else if (hasActivity) {
    statusPillTone = 'bg-warning-soft text-warning-soft-foreground';
    statusPillIcon = <Clock className="size-3" strokeWidth={2} aria-hidden />;
    statusPillLabel = 'Not sent';
  } else {
    statusPillTone = 'bg-[var(--paper-3)] text-muted-foreground';
    statusPillIcon = <Minus className="size-3" strokeWidth={2} aria-hidden />;
    statusPillLabel = 'No activity';
  }

  return (
    <>
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        {/* Header strip */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            EOD digest
            <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
            <span className="text-foreground">{TODAY_LABEL}</span>
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
              statusPillTone,
            )}
          >
            {statusPillIcon}
            {statusPillLabel}
          </span>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">
          {/* 4-row summary list */}
          <dl className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
            <SummaryRow
              label="Expenses logged"
              value={`${s?.summary.expense_count || 0} entr${(s?.summary.expense_count || 0) === 1 ? 'y' : 'ies'}`}
              detail={(s?.summary.expense_total_kes || 0) > 0 ? formatCompactKES(s?.summary.expense_total_kes || 0) : undefined}
            />
            <SummaryRow
              label="Withdrawals recorded"
              value={`${s?.summary.withdrawal_count || 0} entr${(s?.summary.withdrawal_count || 0) === 1 ? 'y' : 'ies'}`}
            />
            <SummaryRow
              label="Cash received"
              value={`${s?.summary.cash_received_count || 0} entr${(s?.summary.cash_received_count || 0) === 1 ? 'y' : 'ies'}`}
            />
            <SummaryRow
              label="Budget actions"
              value={`${s?.summary.budget_action_count || 0} submission${(s?.summary.budget_action_count || 0) === 1 ? '' : 's'}`}
            />
          </dl>

          {/* New-activity callout — paper-2 + warning left-rail */}
          {hasNewActivity && (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-warning/30 border-l-[3px] border-l-[var(--warning)] bg-warning-soft/40 px-3 py-2.5 text-[12.5px] text-warning-soft-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>New activity recorded since last send. Resend to capture all changes.</span>
            </div>
          )}

          {/* Action buttons */}
          {!sent && hasActivity && (
            <Button className="w-full gap-2" onClick={() => handlePreview(false)}>
              <Send className="size-4" /> Send EOD report
            </Button>
          )}
          {sent && hasNewActivity && (
            <Button className="w-full gap-2" variant="outline" onClick={() => handlePreview(true)}>
              <RefreshCw className="size-4" /> Resend with updated data
            </Button>
          )}
          {sent && !hasNewActivity && (
            <Button
              className="w-full gap-2"
              variant="ghost"
              size="sm"
              onClick={() => handlePreview(true)}
            >
              <RefreshCw className="size-4" /> Resend report
            </Button>
          )}

          {/* Slack failure callout */}
          {sent && s?.existing_report?.slack_status === 'failed' && (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-danger/30 border-l-[3px] border-l-[var(--danger)] bg-danger-soft/40 px-3 py-2.5 text-[12.5px] text-danger-soft-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span>
                Slack delivery failed: <span className="font-mono">{s.existing_report.error_message}</span>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Preview dialog — kept untouched */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isResend ? 'Resend Updated EOD Report?' : 'Send EOD Report to Slack?'}</DialogTitle>
            <DialogDescription>
              {isResend
                ? 'This will update the report with the latest data and resend to Slack'
                : 'This will post the daily summary to Slack'}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[300px]">
            <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs">
              {preview}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleSend(isResend)} disabled={sending} className="gap-1">
              <Send className="size-4" /> {sending ? 'Sending...' : isResend ? 'Confirm & Resend' : 'Confirm & Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[13px]">
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-baseline gap-2 font-mono tabular-nums text-foreground">
        <span>{value}</span>
        {detail && (
          <>
            <span aria-hidden className="text-[var(--paper-4)]">·</span>
            <span>{detail}</span>
          </>
        )}
      </dd>
    </div>
  );
}
