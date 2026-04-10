'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/lib/format';
import { Send, Clock, CheckCircle, AlertTriangle, Minus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

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
    lines.push(`IO Finance — End of Day Report`);
    lines.push(`${new Date().toLocaleDateString('en-US', { timeZone: 'Africa/Nairobi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
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
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">End of Day Report</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Please wait</p></CardContent>
      </Card>
    );
  }

  const s = status;
  const sent = s?.already_sent;
  const hasActivity = s?.has_activity;

  // Check if data has changed since last send
  const existingCounts = sent ? {
    expenses: s?.existing_report?.expense_count || 0,
    withdrawals: s?.existing_report?.withdrawal_count || 0,
    budgets: s?.existing_report?.budget_action_count || 0,
    cashReceived: s?.existing_report?.cash_received_count || 0,
  } : null;
  const currentCounts = {
    expenses: s?.summary.expense_count || 0,
    withdrawals: s?.summary.withdrawal_count || 0,
    budgets: s?.summary.budget_action_count || 0,
    cashReceived: s?.summary.cash_received_count || 0,
  };
  const hasNewActivity = sent && existingCounts && (
    currentCounts.expenses !== existingCounts.expenses ||
    currentCounts.withdrawals !== existingCounts.withdrawals ||
    currentCounts.budgets !== existingCounts.budgets ||
    currentCounts.cashReceived !== existingCounts.cashReceived
  );

  let statusBadge: React.ReactNode;
  if (sent) {
    const time = s?.existing_report?.created_at
      ? new Date(s.existing_report.created_at).toLocaleTimeString('en-US', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false })
      : '--:--';
    statusBadge = <Badge className="bg-green-100 text-green-700"><CheckCircle className="h-3 w-3 mr-1" /> Sent at {time} EAT</Badge>;
  } else if (hasActivity) {
    statusBadge = <Badge className="bg-amber-100 text-amber-700"><Clock className="h-3 w-3 mr-1" /> Not Sent</Badge>;
  } else {
    statusBadge = <Badge className="bg-muted text-muted-foreground"><Minus className="h-3 w-3 mr-1" /> No Activity Today</Badge>;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">End of Day Report</CardTitle>
          {statusBadge}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Expenses logged today</span>
              <span className="font-medium">{s?.summary.expense_count || 0} entries — {formatCurrency(s?.summary.expense_total_kes || 0, 'KES')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Withdrawals recorded</span>
              <span className="font-medium">{s?.summary.withdrawal_count || 0} entries</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cash received</span>
              <span className="font-medium">{s?.summary.cash_received_count || 0} entries</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Budget actions</span>
              <span className="font-medium">{s?.summary.budget_action_count || 0} submissions/reviews</span>
            </div>
          </div>

          {/* New activity detected since last send */}
          {hasNewActivity && (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 p-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>New activity recorded since last send. Resend to capture all changes.</span>
            </div>
          )}

          {/* Send button — first time */}
          {!sent && hasActivity && (
            <Button className="w-full gap-2" onClick={() => handlePreview(false)}>
              <Send className="h-4 w-4" /> Send EOD Report
            </Button>
          )}

          {/* Resend button — when already sent but new activity exists */}
          {sent && hasNewActivity && (
            <Button className="w-full gap-2" variant="outline" onClick={() => handlePreview(true)}>
              <RefreshCw className="h-4 w-4" /> Resend with Updated Data
            </Button>
          )}

          {/* Manual resend button — always available when already sent */}
          {sent && !hasNewActivity && (
            <Button className="w-full gap-2" variant="ghost" size="sm" onClick={() => handlePreview(true)}>
              <RefreshCw className="h-4 w-4" /> Resend Report
            </Button>
          )}

          {sent && s?.existing_report?.slack_status === 'failed' && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Slack delivery failed: {s.existing_report.error_message}
            </div>
          )}
        </CardContent>
      </Card>

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
            <pre className="text-xs whitespace-pre-wrap bg-muted/50 rounded-md p-3 font-mono">
              {preview}
            </pre>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>Cancel</Button>
            <Button onClick={() => handleSend(isResend)} disabled={sending} className="gap-1">
              <Send className="h-4 w-4" /> {sending ? 'Sending...' : isResend ? 'Confirm & Resend' : 'Confirm & Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
