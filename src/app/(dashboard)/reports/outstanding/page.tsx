'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Send } from 'lucide-react';
import { toast } from 'sonner';

import { useUser } from '@/hooks/use-user';
import {
  useReceivables,
  type AgingBucket,
  type AgingTone,
  type ExposureRow,
} from '@/hooks/use-receivables';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCompactKES } from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);

const TONE_FILL: Record<AgingTone, string> = {
  success: 'bg-[var(--success,oklch(0.55_0.13_145))]',
  neutral: 'bg-[var(--gold)]',
  warning: 'bg-[oklch(0.65_0.15_70)]',
  danger: 'bg-[var(--danger)]',
};

const TONE_AMOUNT_TEXT: Record<AgingTone, string> = {
  success: 'text-foreground',
  neutral: 'text-foreground',
  warning: 'text-foreground',
  danger: 'text-[var(--danger)]',
};

const PILL_TONE: Record<AgingTone, string> = {
  success: 'bg-success-soft text-success-soft-foreground',
  neutral: 'bg-[var(--paper-3)] text-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
};

function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

export default function OutstandingReceivablesPage() {
  const { user } = useUser();
  const router = useRouter();

  // Route-level role gate.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Outstanding Receivables is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const r = useReceivables();
  const summary = r.summary;

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Outstanding"
          accent="receivables"
          subtitle={
            r.loading
              ? `${summary.asOfLabel} · loading…`
              : `As of ${summary.asOfLabel} · ${summary.invoiceCount} open ${summary.invoiceCount === 1 ? 'invoice' : 'invoices'} · ${summary.escalationCount} over 60 days · DSO ${summary.dsoDays.toFixed(0)} days`
          }
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — bulk export"
              >
                <Download className="size-4" /> Bulk export
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — send reminders"
              >
                <Send className="size-4" /> Send reminders
                {summary.escalationCount > 0 && (
                  <span className="ml-1 inline-flex size-5 items-center justify-center rounded-full bg-danger-soft text-[10px] font-semibold text-danger-soft-foreground">
                    {summary.escalationCount}
                  </span>
                )}
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow="Total outstanding · all clients"
            value={formatCompactKES(summary.totalOutstandingKes)}
            tone={
              summary.escalationCount > 0
                ? 'bad'
                : summary.invoiceCount > 0
                  ? 'neutral'
                  : 'good'
            }
            sub={
              summary.invoiceCount === 0
                ? 'No outstanding invoices'
                : `Across ${summary.invoiceCount} ${summary.invoiceCount === 1 ? 'invoice' : 'invoices'} · ${summary.escalationCount} need escalation`
            }
            loading={r.loading}
          />
          <StatCard
            title="Past 60 days · at risk"
            value={formatCompactKES(summary.pastDueAtRiskKes)}
            subtitle={
              summary.totalOutstandingKes > 0
                ? `${((summary.pastDueAtRiskKes / summary.totalOutstandingKes) * 100).toFixed(1)}% of book · provision recommended`
                : 'No invoices past 60 days'
            }
            loading={r.loading}
            tone="danger"
          />
          <StatCard
            title="DSO · weighted"
            value={`${summary.dsoDays.toFixed(0)} days`}
            subtitle={
              summary.dsoMonthDeltaDays === null
                ? 'No prior snapshot to compare'
                : summary.dsoMonthDeltaDays >= 0
                  ? `+ ${summary.dsoMonthDeltaDays.toFixed(0)} days vs prior`
                  : `− ${Math.abs(summary.dsoMonthDeltaDays).toFixed(0)} days vs prior · improving`
            }
            loading={r.loading}
            tone="brand"
          />
          <StatCard
            title="Collected this week"
            value={formatCompactKES(summary.collectedThisWeekKes)}
            subtitle={
              summary.clearedThisWeekCount === 0
                ? 'Trailing 7 days'
                : `${summary.clearedThisWeekCount} ${summary.clearedThisWeekCount === 1 ? 'invoice' : 'invoices'} cleared · trailing 7 days`
            }
            loading={r.loading}
            tone="success"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="aging">
          <TabsList>
            <TabsTrigger value="aging">Aging buckets</TabsTrigger>
            <TabsTrigger value="all">
              All invoices{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {summary.invoiceCount}
              </span>
            </TabsTrigger>
            <TabsTrigger value="by-client">By client</TabsTrigger>
            <TabsTrigger value="by-project">By project</TabsTrigger>
            <TabsTrigger value="reminder-log">Reminder log</TabsTrigger>
          </TabsList>

          <TabsContent value="aging" className="pt-4">
            <AgingChart buckets={r.agingBuckets} loading={r.loading} />
          </TabsContent>

          <TabsContent value="all" className="pt-4">
            <PlaceholderTab>
              All-invoices listing wires up next — top exposures over 30 days
              are shown below.
            </PlaceholderTab>
          </TabsContent>

          <TabsContent value="by-client" className="pt-4">
            <PlaceholderTab>By-client rollup deferred.</PlaceholderTab>
          </TabsContent>

          <TabsContent value="by-project" className="pt-4">
            <PlaceholderTab>By-project rollup deferred.</PlaceholderTab>
          </TabsContent>

          <TabsContent value="reminder-log" className="pt-4">
            <PlaceholderTab>
              Reminder tracking coming soon — there is no schema field for
              last-contact today.
            </PlaceholderTab>
          </TabsContent>
        </Tabs>

        {/* Top exposures */}
        <section className="space-y-4">
          <header>
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Top exposures · over 30 days
            </p>
            <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
              Invoices needing{' '}
              <em className="not-italic italic text-[var(--gold-lo)]">action</em>
            </h3>
          </header>
          <ExposureTable rows={r.topExposures} loading={r.loading} />
        </section>
      </div>
    </div>
  );
}

// ---------- Aging chart ----------

function AgingChart({
  buckets,
  loading,
}: {
  buckets: AgingBucket[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading aging buckets…
      </div>
    );
  }
  if (buckets.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No outstanding invoices
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3 xl:grid-cols-5">
      {buckets.map((b) => (
        <div
          key={b.key}
          className="relative overflow-hidden bg-card px-6 py-6"
        >
          <span className="absolute right-3.5 top-3.5 font-mono text-[11px] font-semibold text-[var(--paper-4)]">
            {b.sharePct.toFixed(0)}%
          </span>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {b.label}
          </p>
          <p
            className={cn(
              'mt-2 font-display text-[26px] font-medium leading-tight tracking-tight tabular-nums',
              TONE_AMOUNT_TEXT[b.tone],
            )}
          >
            {formatCompactKES(b.kes)}
          </p>
          <p className="mt-1.5 font-mono text-[10.5px] text-muted-foreground">
            {b.meta}
          </p>
          <div
            aria-hidden
            className={cn('absolute inset-x-0 bottom-0 h-[5px]', TONE_FILL[b.tone])}
          />
        </div>
      ))}
    </div>
  );
}

// ---------- Exposures ----------

function ExposureTable({
  rows,
  loading,
}: {
  rows: ExposureRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading top exposures…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No invoices over 30 days outstanding
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[100px_1.8fr_100px_1fr_1fr_1fr_100px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Invoice</span>
        <span>Client · project</span>
        <span>Issued</span>
        <span className="text-right">Amount</span>
        <span>Aging</span>
        <span>Last contact</span>
        <span className="text-right">Action</span>
      </div>
      <ul>
        {rows.map((row) => (
          <ExposureRowComponent key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function ExposureRowComponent({ row }: { row: ExposureRow }) {
  const tone = bucketToneFor(row.agingBucket);
  return (
    <li className="grid grid-cols-[100px_1.8fr_100px_1fr_1fr_1fr_100px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0">
      <span className="font-mono text-[12px] font-medium text-foreground">
        {row.invoiceNumber}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
          {row.clientName}
        </p>
        <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          {row.projectName}
        </p>
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {formatIssueDate(row.issueDate)}
      </span>
      <span className="text-right font-mono text-[14px] tabular-nums text-foreground">
        {formatCompactKES(row.amountKes)}
      </span>
      <span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.06em]',
            PILL_TONE[tone],
          )}
        >
          {row.agingLabel}
        </span>
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">—</span>
      <div className="text-right">
        <Button
          variant="outline"
          size="sm"
          disabled
          className="h-7 px-2 font-mono text-[10.5px]"
          title="Coming soon — invoice actions"
        >
          View
        </Button>
      </div>
    </li>
  );
}

function bucketToneFor(key: ExposureRow['agingBucket']): AgingTone {
  switch (key) {
    case '0-30':
      return 'success';
    case '31-45':
      return 'neutral';
    case '46-60':
      return 'warning';
    case '61-90':
    case '90-plus':
      return 'danger';
  }
}

function PlaceholderTab({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
