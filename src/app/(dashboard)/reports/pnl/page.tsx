'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowRight, CheckCircle2, Download, FilePlus } from 'lucide-react';
import { toast } from 'sonner';

import { useUser } from '@/hooks/use-user';
import {
  usePLReports,
  type AnnualReport,
  type CurrentPeriodSummary,
  type MonthlyReport,
  type PLStatus,
  type QuarterlyReport,
} from '@/hooks/use-pl-reports';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCompactKES } from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);

const STATUS_LABEL: Record<PLStatus, string> = {
  signed: 'Signed off',
  in_review: 'In review',
  draft: 'Draft · live',
};

const STATUS_TONE: Record<PLStatus, string> = {
  signed: 'bg-success-soft text-success-soft-foreground',
  in_review: 'bg-warning-soft text-warning-soft-foreground',
  draft: 'bg-[var(--paper-3)] text-foreground',
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export default function PLReportsPage() {
  const { user } = useUser();
  const router = useRouter();

  // Route-level role gate.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('P&L Reports is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const pl = usePLReports();
  const summary = pl.summary;

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="P&L"
          accent="archive"
          subtitle={
            pl.loading
              ? 'Loading reports archive…'
              : `${summary.archivedCount} archived · ${summary.signedOffThisFiscalCount} signed off this fiscal · quarterly & annual rollups`
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
                title="Coming soon — generate report"
              >
                <FilePlus className="size-4" /> Generate report
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {pl.error && !pl.loading && (
          <div className="flex items-start gap-3 rounded-lg border border-danger-soft bg-danger-soft px-5 py-4 text-danger-soft-foreground">
            <AlertCircle className="mt-0.5 size-5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Couldn&apos;t load P&amp;L reports.</p>
              <p className="mt-1 font-mono text-[11px] opacity-80">
                {pl.error.message}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 font-mono text-[10.5px]"
              onClick={() => void pl.refresh()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Featured: current period */}
        <CurrentPeriodSection
          loading={pl.loading}
          current={summary.current}
        />

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Archived statements"
            value={`${summary.archivedCount}`}
            subtitle="Signed off · monthly snapshots"
            loading={pl.loading}
            tone="brand"
          />
          <StatCard
            title="Signed this fiscal"
            value={`${summary.signedOffThisFiscalCount}`}
            subtitle="Calendar-year-to-date"
            loading={pl.loading}
            tone="success"
          />
          <StatCard
            title="Current period revenue"
            value={
              summary.current
                ? formatCompactKES(summary.current.revenueMtdKes)
                : '—'
            }
            subtitle={
              summary.current
                ? summary.current.isLive
                  ? 'MTD · live (open month)'
                  : 'MTD · signed snapshot'
                : 'No current period'
            }
            loading={pl.loading}
            tone="brand"
          />
          <StatCard
            title="Current period margin"
            value={
              summary.current
                ? `${summary.current.marginPct.toFixed(1)}%`
                : '—'
            }
            subtitle={
              summary.current
                ? `${formatCompactKES(summary.current.netProfitKes)} net profit${
                    summary.current.isLive ? ' · live' : ''
                  }`
                : 'No current period'
            }
            loading={pl.loading}
            tone={
              summary.current && summary.current.marginPct >= 10
                ? 'success'
                : 'danger'
            }
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="monthly">
          <TabsList>
            <TabsTrigger value="monthly">
              Monthly{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {pl.monthly.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="quarterly">
              Quarterly{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {pl.quarterly.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="annual">
              Annual{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {pl.annual.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="drafts">
              Drafts{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {pl.drafts.length}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monthly" className="pt-4">
            <MonthlyTable rows={pl.monthly} loading={pl.loading} />
          </TabsContent>

          <TabsContent value="quarterly" className="pt-4">
            <QuarterlyTable rows={pl.quarterly} loading={pl.loading} />
          </TabsContent>

          <TabsContent value="annual" className="pt-4">
            <AnnualTable rows={pl.annual} loading={pl.loading} />
          </TabsContent>

          <TabsContent value="drafts" className="pt-4">
            <MonthlyTable rows={pl.drafts} loading={pl.loading} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- Featured current period section ----------

function CurrentPeriodSection({
  loading,
  current,
}: {
  loading: boolean;
  current: PLReportsCurrentParam;
}) {
  return (
    <section>
      <header className="mb-3">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          In progress
        </p>
        <h2 className="mt-1 font-display text-[20px] font-medium leading-tight text-foreground">
          Current period{current ? <> · <em className="not-italic italic text-[var(--gold-lo)]">{current.label}</em></> : ''}
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr_1fr]">
        <CurrentPeriodInkCard loading={loading} current={current} />
        <ProjectionCard
          title="By project"
          accent="snapshot"
          description="Per-project P&L for active projects. Includes overhead allocation by headcount."
          href="/reports/profitability"
          countLabel="Active projects"
        />
        <ProjectionCard
          title="By department"
          accent="snapshot"
          description="Department-scoped expenses against shared overhead."
          href="/reports/budget-vs-actual"
          countLabel="Operations · IT · sales · …"
        />
      </div>
    </section>
  );
}

type PLReportsCurrentParam = CurrentPeriodSummary | null;

function CurrentPeriodInkCard({
  loading,
  current,
}: {
  loading: boolean;
  current: PLReportsCurrentParam;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-foreground bg-foreground p-6 text-background">
        <Skeleton className="h-3 w-40 bg-background/20" />
        <Skeleton className="mt-3 h-6 w-56 bg-background/20" />
        <div className="mt-5 grid grid-cols-2 gap-3 border-y border-background/10 py-4">
          <Skeleton className="h-10 w-full bg-background/15" />
          <Skeleton className="h-10 w-full bg-background/15" />
          <Skeleton className="h-10 w-full bg-background/15" />
          <Skeleton className="h-10 w-full bg-background/15" />
        </div>
      </div>
    );
  }
  if (!current) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-8 text-sm text-muted-foreground">
        No current period to display yet.
      </div>
    );
  }
  if (current.error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-danger-soft bg-danger-soft px-6 py-8 text-danger-soft-foreground">
        <AlertCircle className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="text-sm font-medium">
            Couldn&apos;t compute the current period ({current.label}).
          </p>
          <p className="mt-1 font-mono text-[11px] opacity-80">
            {current.error}
          </p>
        </div>
      </div>
    );
  }
  const topLabel = current.isLive
    ? `Draft · ${current.label} · MTD`
    : `Signed off · ${current.label}`;
  return (
    <div className="rounded-lg border border-foreground bg-foreground p-6 text-background">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--gold)]">
          {topLabel}
        </p>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]',
            STATUS_TONE[current.status],
          )}
        >
          {STATUS_LABEL[current.status]}
        </span>
      </div>
      <h3
        className="mt-2 font-display text-[22px] font-normal leading-[1.15] tracking-tight text-background"
        style={{ fontVariationSettings: '"opsz" 32' }}
      >
        Monthly P&L ·{' '}
        <em className="not-italic italic text-[var(--gold)]">
          {current.label}
        </em>
        {current.isLive && (
          <em className="ml-2 align-middle font-display text-[12.5px] not-italic italic text-background/55">
            (live · open month)
          </em>
        )}
      </h3>
      <div className="mt-5 grid grid-cols-2 gap-3 border-y border-background/10 py-4">
        <Metric label="Revenue MTD" value={formatCompactKES(current.revenueMtdKes)} />
        <Metric
          label="Net profit"
          value={formatCompactKES(current.netProfitKes)}
          gold
        />
        <Metric label="Margin" value={`${current.marginPct.toFixed(1)}%`} />
        <Metric label="Status" value={STATUS_LABEL[current.status]} />
      </div>
      <div className="mt-4 flex items-center justify-end">
        <Link
          href="/reports/monthly-pl"
          className="inline-flex h-9 items-center gap-1 rounded-md bg-[var(--gold)] px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--gold)]/90"
        >
          Open draft <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  gold,
}: {
  label: string;
  value: string;
  gold?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-background/55">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-[18px] font-medium tabular-nums tracking-tight',
          gold ? 'text-[var(--gold)]' : 'text-background',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ProjectionCard({
  title,
  accent,
  description,
  href,
  countLabel,
}: {
  title: string;
  accent: string;
  description: string;
  href: string;
  countLabel: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-6">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Drill-down
      </p>
      <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
        {title}{' '}
        <em className="not-italic italic text-[var(--gold-lo)]">{accent}</em>
      </h3>
      <p className="mt-2 flex-1 text-[12.5px] leading-snug text-[var(--warm-grey-3)]">
        {description}
      </p>
      <div className="mt-4 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
          {countLabel}
        </span>
        <Link
          href={href}
          className="inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          Open
        </Link>
      </div>
    </div>
  );
}

// ---------- Tables ----------

function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-6 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <ul>
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-28" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusPill({ status }: { status: PLStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.06em]',
        STATUS_TONE[status],
      )}
    >
      {status === 'signed' && <CheckCircle2 className="size-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function MonthlyTable({
  rows,
  loading,
}: {
  rows: MonthlyReport[];
  loading: boolean;
}) {
  if (loading) {
    return <TableSkeleton />;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Nothing to show in this view yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[220px_1fr_1fr_1fr_1fr_1.4fr_110px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Period</span>
        <span>Status</span>
        <span className="text-right">Revenue</span>
        <span className="text-right">Net profit</span>
        <span className="text-right">Margin</span>
        <span>Signed off by</span>
        <span className="text-right">Actions</span>
      </div>
      <ul>
        {rows.map((r) =>
          r.error ? (
            <li
              key={r.yearMonth}
              className="grid grid-cols-[220px_1fr_1fr_1fr_1fr_1.4fr_110px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
            >
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
                  {r.reportId}
                </div>
                <div className="text-[14px] font-medium text-foreground">
                  {r.label}
                </div>
              </div>
              <span className="col-span-6 inline-flex items-center gap-1.5 text-[13px] text-danger-soft-foreground">
                <AlertCircle className="size-4 shrink-0" />
                Couldn&apos;t compute this month — {r.error}
              </span>
            </li>
          ) : (
          <li
            key={r.yearMonth}
            className="grid grid-cols-[220px_1fr_1fr_1fr_1fr_1.4fr_110px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
                {r.reportId}
              </div>
              <div className="text-[14px] font-medium text-foreground">
                {r.label}
              </div>
            </div>
            <span>
              <StatusPill status={r.status} />
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.revenueKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.netProfitKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {r.marginPct.toFixed(1)}%
            </span>
            <span className="min-w-0">
              {r.signedOffByName ? (
                <>
                  <div className="truncate text-[13px] text-foreground">
                    {r.signedOffByName}
                  </div>
                  {r.signedOffAt && (
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {formatTimestamp(r.signedOffAt)}
                    </div>
                  )}
                </>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">—</span>
              )}
            </span>
            <div className="text-right">
              <Button
                variant="outline"
                size="sm"
                disabled
                className="h-7 px-2 font-mono text-[10.5px]"
                title="Coming soon — open report"
              >
                Open
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuarterlyTable({
  rows,
  loading,
}: {
  rows: QuarterlyReport[];
  loading: boolean;
}) {
  if (loading) {
    return <TableSkeleton rows={4} />;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No quarterly data
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[180px_1fr_1fr_1fr_1fr_120px_110px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Quarter</span>
        <span>Status</span>
        <span className="text-right">Revenue</span>
        <span className="text-right">Net profit</span>
        <span className="text-right">Margin</span>
        <span>Months</span>
        <span className="text-right">Actions</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.yearQuarter}
            className="grid grid-cols-[180px_1fr_1fr_1fr_1fr_120px_110px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
                PL · {r.yearQuarter}
              </div>
              <div className="text-[14px] font-medium text-foreground">
                {r.label}
              </div>
            </div>
            <span>
              <StatusPill status={r.status} />
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.revenueKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.netProfitKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {r.marginPct.toFixed(1)}%
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.monthCount} {r.monthCount === 1 ? 'month' : 'months'}
            </span>
            <div className="text-right">
              <Button
                variant="outline"
                size="sm"
                disabled
                className="h-7 px-2 font-mono text-[10.5px]"
                title="Coming soon"
              >
                Open
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnnualTable({
  rows,
  loading,
}: {
  rows: AnnualReport[];
  loading: boolean;
}) {
  if (loading) {
    return <TableSkeleton rows={3} />;
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No annual data
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[180px_1fr_1fr_1fr_1fr_120px_110px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Year</span>
        <span>Status</span>
        <span className="text-right">Revenue</span>
        <span className="text-right">Net profit</span>
        <span className="text-right">Margin</span>
        <span>Months</span>
        <span className="text-right">Actions</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.year}
            className="grid grid-cols-[180px_1fr_1fr_1fr_1fr_120px_110px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground">
                PL · {r.year}
              </div>
              <div className="text-[14px] font-medium text-foreground">
                {r.label}
              </div>
            </div>
            <span>
              <StatusPill status={r.status} />
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.revenueKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.netProfitKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {r.marginPct.toFixed(1)}%
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {r.monthCount} {r.monthCount === 1 ? 'month' : 'months'}
            </span>
            <div className="text-right">
              <Button
                variant="outline"
                size="sm"
                disabled
                className="h-7 px-2 font-mono text-[10.5px]"
                title="Coming soon"
              >
                Open
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
