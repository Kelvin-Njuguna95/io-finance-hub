'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileText,
  ShieldAlert,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getCurrentYearMonth } from '@/lib/format';
import { EXPENSE_STATUS } from '@/lib/constants/status';
import { CfoMiscApproval } from '@/components/misc/cfo-misc-approval';
import { OutstandingReceivablesPanel } from '@/components/revenue/outstanding-receivables-panel';
import { ExpenseQueuePanel } from '@/components/expenses/expense-queue-panel';
import type { MonthlyFinancialSnapshot } from '@/types/database';
import { HomeKpiStrip } from './home-kpi-strip';
import { HomePerformanceStrip } from './home-performance-strip';

type EodLogRow = {
  id: string;
  report_date: string;
  sender_name: string;
  trigger_type: string;
  slack_status: string | null;
  created_at: string | null;
  expense_count?: number;
  withdrawal_count?: number;
  budget_action_count?: number;
  payload?: {
    message?: string;
    expenses?: Array<Record<string, unknown>>;
    withdrawals?: Array<Record<string, unknown>>;
    budget_actions?: Array<Record<string, unknown>>;
  };
};

type HealthScoreRow = {
  id: string;
  project_name: string;
  score: number;
  score_band: 'healthy' | 'watch' | 'at_risk' | string;
  biggest_drag: string | null;
};

const HEALTH_BAND: Record<
  string,
  {
    icon: typeof CheckCircle2;
    tileClass: string;
    label: string;
  }
> = {
  healthy: {
    icon: CheckCircle2,
    tileClass:
      'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
    label: 'Healthy',
  },
  watch: {
    icon: AlertTriangle,
    tileClass:
      'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/30',
    label: 'Watch',
  },
  at_risk: {
    icon: ShieldAlert,
    tileClass:
      'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/25',
    label: 'At risk',
  },
};

export function CfoDashboard() {
  const [snapshot, setSnapshot] = useState<MonthlyFinancialSnapshot | null>(
    null,
  );
  const [eodLogs, setEodLogs] = useState<EodLogRow[]>([]);
  const [healthScores, setHealthScores] = useState<HealthScoreRow[]>([]);
  const [revenueEstimated, setRevenueEstimated] = useState(false);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const periodMonth = currentMonth + '-01';

      const [
        snapshotRes,
        eodRes,
        healthRes,
        laggedInvRes,
        expenseRes,
        rateRes,
        agentCountRes,
        monthClosureRes,
      ] = await Promise.all([
        supabase
          .from('monthly_financial_snapshots')
          .select('*')
          .eq('year_month', currentMonth)
          .single(),
        supabase
          .from('eod_reports')
          .select('*, users(full_name)')
          .order('report_date', { ascending: false })
          .limit(30),
        supabase
          .from('project_health_scores')
          .select('*, projects(name)')
          .eq('period_month', periodMonth)
          .order('score', { ascending: true }),
        supabase
          .from('lagged_revenue_company_month')
          .select('total_revenue_kes, total_revenue_usd, revenue_kes_estimated')
          .eq('expense_month', currentMonth)
          .maybeSingle(),
        supabase.from('expenses').select('amount_kes').eq('year_month', currentMonth).eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED),
        supabase
          .from('system_settings')
          .select('value')
          .eq('key', 'standard_exchange_rate')
          .single(),
        supabase.from('agent_counts').select('agent_count').eq('year_month', currentMonth),
        // F-19: only treat the snapshot as authoritative when the month is
        // closed/locked. Otherwise, blend live values over it so late-arriving
        // invoices and expenses surface even if a snapshot already exists.
        supabase.from('month_closures').select('status').eq('year_month', currentMonth).maybeSingle(),
      ]);

      const stdRate = parseFloat(rateRes.data?.value || '129.5');
      const laggedRevUsd = Number(laggedInvRes.data?.total_revenue_usd || 0);
      const laggedRevKes = Number(laggedInvRes.data?.total_revenue_kes || 0);
      const revenueKes = laggedRevKes > 0 ? laggedRevKes : Math.round(laggedRevUsd * stdRate * 100) / 100;
      setRevenueEstimated(Boolean(laggedInvRes.data?.revenue_kes_estimated));
      const totalExpKes = (expenseRes.data || []).reduce(
        (s: number, e: { amount_kes: number }) => s + Number(e.amount_kes),
        0,
      );
      const totalAgents = (agentCountRes.data || []).reduce(
        (s: number, a: { agent_count: number }) => s + Number(a.agent_count || 0),
        0,
      );

      const monthIsClosed =
        monthClosureRes.data?.status === 'closed' ||
        monthClosureRes.data?.status === 'locked';

      const liveSnapshot =
        snapshotRes.data && monthIsClosed
          ? {
              ...snapshotRes.data,
              total_agents: snapshotRes.data.total_agents || totalAgents,
            }
          : {
              ...snapshotRes.data,
              total_revenue_kes: revenueKes,
              total_revenue_usd: laggedRevUsd,
              total_direct_costs_kes: totalExpKes,
              gross_profit_kes: revenueKes - totalExpKes,
              operating_profit_kes: revenueKes - totalExpKes,
              net_profit_kes: revenueKes - totalExpKes,
              total_agents: totalAgents,
            };

      setSnapshot(liveSnapshot);

      setEodLogs(
        ((eodRes.data || []) as Array<Record<string, unknown>>).map((r) => ({
          ...(r as EodLogRow),
          sender_name:
            (r as { users?: { full_name?: string } }).users?.full_name ||
            ((r as { trigger_type: string }).trigger_type === 'auto'
              ? 'System'
              : '—'),
        })) as EodLogRow[],
      );
      setHealthScores(
        ((healthRes.data || []) as Array<Record<string, unknown>>).map((h) => ({
          ...(h as HealthScoreRow),
          project_name:
            (h as { projects?: { name?: string } }).projects?.name || '—',
        })) as HealthScoreRow[],
      );
    }

    loadData();
  }, [currentMonth]);

  const [viewingEod, setViewingEod] = useState<EodLogRow | null>(null);

  return (
    <div className="p-6 space-y-6">
      {/* Primary KPI strip — Bank Balance, Approved Budget, Withdrawn */}
      <HomeKpiStrip />

      {/* Company-wide P&L performance — lagged service period */}
      <HomePerformanceStrip />

      {/* Project Health */}
      {healthScores.length > 0 && (
        <SectionCard
          title="Project Health Overview"
          description="Composite score across active engagements"
          icon={ShieldAlert}
          tone="info"
        >
          <ul className="space-y-2">
            {healthScores.map((h) => {
              const band =
                HEALTH_BAND[h.score_band] ?? HEALTH_BAND.healthy;
              const Icon = band.icon;
              return (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        band.tileClass,
                      )}
                    >
                      <Icon className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {h.project_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {h.biggest_drag || band.label}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-foreground tabular-nums">
                      {Math.round(h.score)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">/ 100</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {/* Outstanding Receivables */}
      <OutstandingReceivablesPanel />

      {/* Expense Queue */}
      <ExpenseQueuePanel />

      {/* Accountant Misc Requests & Reports */}
      <CfoMiscApproval />

      {/* EOD Log */}
      <SectionCard
        title="EOD Report Log"
        description="Last 30 days · sent by accountants or auto-scheduler"
        icon={FileText}
        tone="brand"
      >
        {eodLogs.length === 0 ? (
          <EmptyState
            icon={FileText}
            tone="neutral"
            title="No EOD reports sent yet"
            description="Reports will appear here once accountants or the auto-scheduler send one."
          />
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border border-border bg-muted/20">
            {eodLogs.map((log) => (
              <li
                key={log.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors duration-[var(--dur-fast)] hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-24 shrink-0 font-medium tabular-nums text-foreground">
                    {log.report_date}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {log.sender_name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {log.created_at
                      ? new Intl.DateTimeFormat('en-KE', {
                          timeZone: 'Africa/Nairobi',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        }).format(new Date(log.created_at))
                      : '--:--'}{' '}
                    EAT
                  </span>
                  <Badge
                    variant="secondary"
                    className={
                      log.trigger_type === 'auto'
                        ? 'bg-info-soft text-info-soft-foreground'
                        : 'bg-muted text-muted-foreground'
                    }
                  >
                    {log.trigger_type}
                  </Badge>
                  {log.slack_status === 'failed' ? (
                    <Badge className="bg-danger-soft text-danger-soft-foreground">
                      Failed
                    </Badge>
                  ) : (
                    <Badge className="bg-success-soft text-success-soft-foreground">
                      Sent
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`View EOD report for ${log.report_date}`}
                    onClick={() => setViewingEod(log)}
                  >
                    <Eye className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* EOD Dialog — shadcn Dialog with focus trap, escape, return focus */}
      <Dialog open={Boolean(viewingEod)} onOpenChange={(open) => !open && setViewingEod(null)}>
        <DialogContent
          className="sm:max-w-2xl"
          aria-describedby={undefined}
        >
          {viewingEod && (
            <>
              <DialogHeader className="border-b border-border pb-3">
                <DialogTitle>EOD Report — {viewingEod.report_date}</DialogTitle>
                <DialogDescription>
                  Sent by {viewingEod.sender_name} ·{' '}
                  <span className="capitalize">{viewingEod.trigger_type}</span>{' '}
                  trigger
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto pr-1">
                {viewingEod.payload?.message ? (
                  <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-foreground/85">
                    {viewingEod.payload.message}
                  </pre>
                ) : (
                  <EodPayloadFallback log={viewingEod} />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-3">
                  <EodCountChip icon={FileText} label="expenses" value={viewingEod.expense_count ?? 0} />
                  <EodCountChip icon={ArrowDownToLine} label="withdrawals" value={viewingEod.withdrawal_count ?? 0} />
                  <EodCountChip icon={ClipboardList} label="budgets" value={viewingEod.budget_action_count ?? 0} />
                </span>
                <Badge
                  className={cn(
                    viewingEod.slack_status === 'failed'
                      ? 'bg-danger-soft text-danger-soft-foreground'
                      : 'bg-success-soft text-success-soft-foreground',
                  )}
                >
                  Slack: {viewingEod.slack_status}
                </Badge>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EodCountChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-3" aria-hidden />
      <span className="tabular-nums font-medium text-foreground/80">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function EodPayloadFallback({ log }: { log: EodLogRow }) {
  const hasAny =
    (log.payload?.expenses?.length ?? 0) > 0 ||
    (log.payload?.withdrawals?.length ?? 0) > 0 ||
    (log.payload?.budget_actions?.length ?? 0) > 0;

  if (!hasAny) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No report data available
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {(log.payload?.expenses?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Expenses Logged ({log.expense_count})
          </h4>
          {log.payload!.expenses!.map((e: Record<string, unknown>, i: number) => {
            const projectName =
              (e.projects as { name?: string } | undefined)?.name || 'Shared';
            const category =
              (e.expense_categories as { name?: string } | undefined)?.name || '—';
            const amount = Number(e.amount_kes);
            const description = e.description as string;
            return (
              <p key={i} className="ml-3 text-sm text-muted-foreground">
                • {projectName} — {category} — KES{' '}
                {amount.toLocaleString()} — {description}
              </p>
            );
          })}
        </section>
      )}
      {(log.payload?.withdrawals?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Withdrawals ({log.withdrawal_count})
          </h4>
          {log.payload!.withdrawals!.map((w: Record<string, unknown>, i: number) => (
            <p key={i} className="ml-3 text-sm text-muted-foreground">
              • {w.director_tag as string} — USD{' '}
              {Number(w.amount_usd).toLocaleString()} @{' '}
              {Number(w.exchange_rate).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = KES{' '}
              {Number(w.amount_kes).toLocaleString()} —{' '}
              {(w.forex_bureau as string) || '—'}
            </p>
          ))}
        </section>
      )}
      {(log.payload?.budget_actions?.length ?? 0) > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-foreground">
            Budget Actions ({log.budget_action_count})
          </h4>
          {log.payload!.budget_actions!.map(
            (b: Record<string, unknown>, i: number) => {
              const budgets = b.budgets as
                | {
                    projects?: { name?: string };
                    departments?: { name?: string };
                  }
                | undefined;
              const name =
                budgets?.projects?.name || budgets?.departments?.name || '—';
              return (
                <p key={i} className="ml-3 text-sm text-muted-foreground">
                  • {name} — {b.status as string}
                </p>
              );
            },
          )}
        </section>
      )}
    </div>
  );
}
