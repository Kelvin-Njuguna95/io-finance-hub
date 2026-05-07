'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatKES, formatUSD } from '@/lib/utils/currency';
import { Send, Clock, CheckCircle, AlertTriangle, Minus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import type {
  EodSectionsPayload,
  EodSection,
  ExpenseRow,
  WithdrawalRow,
  CashReceiptRow,
  BudgetActionRow,
} from '@/lib/eod/sections';

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
  sections: EodSectionsPayload;
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

  // Check if data has changed since last send (compares live counts in
  // `summary` against the counts persisted on existing_report).
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
          {s?.sections ? (
            <SectionList sections={s.sections.sections} />
          ) : null}

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

      {/* Preview dialog — same itemised rendering as the panel, plus the
          Slack header / footer the recipients will see. */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isResend ? 'Resend Updated EOD Report?' : 'Send EOD Report to Slack?'}</DialogTitle>
            <DialogDescription>
              {isResend
                ? 'This will update the report with the latest data and resend to Slack.'
                : 'This will post the daily summary to #cobra-squad.'}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[420px] pr-2">
            {s?.sections ? (
              <div className="space-y-4 rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] px-4 py-4">
                <div className="space-y-1 border-b border-border-subtle pb-3">
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.10em] text-foreground">
                    IO Finance — End of Day Report
                  </p>
                  <p className="text-[12px] text-muted-foreground">
                    {s.sections.header.reportDateFormatted}
                    {s.sections.header.preparedBy
                      ? ` · Prepared by: ${s.sections.header.preparedBy}`
                      : ''}
                  </p>
                </div>
                <SectionList sections={s.sections.sections} />
                {isResend && (
                  <p className="rounded-[var(--radius-sm)] border border-warning/30 bg-warning-soft/40 px-3 py-2 text-[12px] text-warning-soft-foreground">
                    This will replace the previously sent report with updated data.
                  </p>
                )}
              </div>
            ) : null}
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

// ─── Section rendering ─────────────────────────────────────────────────────

function SectionList({ sections }: { sections: EodSectionsPayload['sections'] }) {
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <SectionBlock key={section.key} section={section} />
      ))}
    </div>
  );
}

function SectionBlock({ section }: { section: EodSection }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
      <div className="border-b border-border-subtle bg-[var(--paper-2)] px-3 py-1.5">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.10em] text-muted-foreground">
          {section.title}
        </span>
      </div>
      {section.rows.length === 0 ? (
        <p className="px-3 py-2.5 font-mono text-[12px] italic text-muted-foreground">
          {section.emptyState}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border-subtle">
            {section.key === 'expenses' &&
              section.rows.map((row) => (
                <ExpenseRowItem key={row.id} row={row} />
              ))}
            {section.key === 'withdrawals' &&
              section.rows.map((row) => (
                <WithdrawalRowItem key={row.id} row={row} />
              ))}
            {section.key === 'cash_received' &&
              section.rows.map((row) => (
                <CashRowItem key={row.id} row={row} />
              ))}
            {section.key === 'budget_actions' &&
              section.rows.map((row) => (
                <BudgetRowItem key={row.id} row={row} />
              ))}
          </ul>
          <SectionTotal section={section} />
        </>
      )}
    </div>
  );
}

function SectionTotal({ section }: { section: EodSection }) {
  if (section.key === 'budget_actions' || section.totals === null) return null;
  if (section.key === 'expenses') {
    return (
      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle bg-[var(--paper-2)] px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          Total
        </span>
        <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
          {formatKES(section.totals.kes)}
        </span>
      </div>
    );
  }
  // withdrawals / cash_received
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle bg-[var(--paper-2)] px-3 py-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
        Total
      </span>
      <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
        {formatUSD(section.totals.usd)}{' '}
        <span className="text-muted-foreground">({formatKES(section.totals.kes)})</span>
      </span>
    </div>
  );
}

function RowShell({
  primary,
  secondary,
  amount,
}: {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  amount?: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 px-3 py-2 text-[12.5px]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-foreground">{primary}</p>
        {secondary ? (
          <p className="truncate text-[11.5px] text-muted-foreground">{secondary}</p>
        ) : null}
      </div>
      {amount ? (
        <span className="shrink-0 font-mono tabular-nums text-foreground">{amount}</span>
      ) : null}
    </li>
  );
}

function ExpenseRowItem({ row }: { row: ExpenseRow }) {
  return (
    <RowShell
      primary={
        <>
          <span className="font-medium">{row.project}</span>
          <span className="text-muted-foreground"> — {row.category}</span>
        </>
      }
      secondary={row.description || undefined}
      amount={formatKES(row.amountKes)}
    />
  );
}

function WithdrawalRowItem({ row }: { row: WithdrawalRow }) {
  const fxRate = new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(row.exchangeRate);
  return (
    <RowShell
      primary={<span className="font-medium">{row.director}</span>}
      secondary={`@ ${fxRate} — ${row.forexBureau}`}
      amount={
        <>
          {formatUSD(row.amountUsd)}{' '}
          <span className="text-muted-foreground">({formatKES(row.amountKes)})</span>
        </>
      }
    />
  );
}

function CashRowItem({ row }: { row: CashReceiptRow }) {
  return (
    <RowShell
      primary={
        <>
          <span className="font-medium">{row.project}</span>
          <span className="text-muted-foreground"> — {row.invoiceNumber}</span>
        </>
      }
      secondary={`Ref: ${row.reference}`}
      amount={
        <>
          {formatUSD(row.amountUsd)}{' '}
          <span className="text-muted-foreground">({formatKES(row.amountKes)})</span>
        </>
      }
    />
  );
}

function BudgetRowItem({ row }: { row: BudgetActionRow }) {
  return (
    <RowShell
      primary={<span className="font-medium">{row.scope}</span>}
      secondary={row.statusLabel}
    />
  );
}
