'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Download, FileSignature, History } from 'lucide-react';
import { toast } from 'sonner';

import { useUser } from '@/hooks/use-user';
import {
  useProfitShare,
  type DirectorShare,
  type ProfitShareHistoryRow,
  type ProfitShareStatus,
} from '@/hooks/use-profit-share';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PredatedPayoutDialog,
  type PredatedDirectorOption,
  type PredatedProjectOption,
} from '@/components/profit-share/predated-payout-dialog';
import { createClient } from '@/lib/supabase/client';
import {
  formatCompactKES,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo']);

const STATUS_LABEL: Record<ProfitShareStatus, string> = {
  approved: 'Approved',
  pending_review: 'Pending review',
  disputed: 'Disputed',
  draft: 'Draft',
};

const STATUS_TONE: Record<ProfitShareStatus, string> = {
  approved: 'bg-success-soft text-success-soft-foreground',
  pending_review: 'bg-warning-soft text-warning-soft-foreground',
  disputed: 'bg-danger-soft text-danger-soft-foreground',
  draft: 'bg-[var(--paper-3)] text-foreground',
};

function formatDeltaPct(pct: number | null): string {
  if (pct === null) return '—';
  const sign = pct >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export default function ProfitSharePage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  // Route-level role gate — CFO ONLY (most sensitive financial surface).
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Profit Share is restricted to CFO');
      router.push('/');
    }
  }, [user?.role, router]);

  const ps = useProfitShare(selectedMonth);
  const summary = ps.summary;

  // Predated-payout dialog (PRED-3). Loads its own director + project
  // option lists — useProfitShare exposes DirectorShare aggregates
  // (rolled up by tag), not the user_id list the dialog needs.
  const canRecordPredated =
    user?.role === 'cfo' || user?.role === 'accountant';
  const [predatedDialogOpen, setPredatedDialogOpen] = useState(false);
  const [predatedDirectors, setPredatedDirectors] = useState<
    PredatedDirectorOption[]
  >([]);
  const [predatedProjects, setPredatedProjects] = useState<
    PredatedProjectOption[]
  >([]);

  useEffect(() => {
    if (!canRecordPredated) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      // Distinct director_user_ids from projects (active OR inactive),
      // then resolve to user names. Predated payouts can target a
      // historical director who's no longer assigned.
      const [{ data: projectRows }, { data: usersRows }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, is_active, director_user_id')
          .order('name'),
        supabase.from('users').select('id, full_name'),
      ]);
      if (cancelled) return;
      const userMap = new Map<string, string>();
      for (const u of usersRows ?? []) {
        if (u.id) userMap.set(u.id, u.full_name ?? 'Unknown');
      }
      const directorIds = new Set<string>();
      const projectOpts: PredatedProjectOption[] = [];
      for (const p of projectRows ?? []) {
        if (p.director_user_id) directorIds.add(p.director_user_id);
        projectOpts.push({
          id: p.id,
          name: p.name ?? 'Unnamed project',
          is_active: !!p.is_active,
        });
      }
      const directorOpts: PredatedDirectorOption[] = Array.from(directorIds)
        .filter((id) => userMap.has(id))
        .map((id) => ({ id, full_name: userMap.get(id)! }));
      setPredatedDirectors(directorOpts);
      setPredatedProjects(projectOpts);
    })();
    return () => {
      cancelled = true;
    };
  }, [canRecordPredated]);

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }),
    [],
  );

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Director"
          accent="distribution"
          subtitle={
            ps.loading
              ? `${formatYearMonth(selectedMonth)} · loading…`
              : `${formatYearMonth(selectedMonth)} · 70/30 split · ${formatCompactKES(summary.totalDistributablePoolKes)} pool across ${summary.directorCount} ${summary.directorCount === 1 ? 'director' : 'directors'} · ${STATUS_LABEL[summary.distributionStatus].toLowerCase()}`
          }
          action={
            <div className="flex items-center gap-2">
              <Select
                value={selectedMonth}
                onValueChange={(v) => v && setSelectedMonth(v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((ym) => (
                    <SelectItem key={ym} value={ym}>
                      {formatYearMonth(ym)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canRecordPredated && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setPredatedDialogOpen(true)}
                  title="Record a director payout that occurred before the app was adopted"
                >
                  <History className="size-4" /> Record predated
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — export ledger"
              >
                <Download className="size-4" /> Export ledger
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — approve distribution"
              >
                <FileSignature className="size-4" /> Approve distribution
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* Hero pool card */}
        <PoolCard
          loading={ps.loading}
          totalNetProfitKes={summary.totalNetProfitKes}
          totalPoolKes={summary.totalDistributablePoolKes}
          totalCompanyKes={summary.totalCompanyShareKes}
          status={summary.distributionStatus}
          fromMaterialisedTable={summary.fromMaterialisedTable}
          monthLabel={summary.periodLabel}
        />

        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Recipients"
            value={summary.directorCount > 0 ? `${summary.directorCount}` : '—'}
            subtitle={
              summary.directorCount === 0
                ? 'No projects with profit'
                : `${summary.directorCount} of 5 directors received a share`
            }
            loading={ps.loading}
            tone="brand"
          />
          <StatCard
            title="Largest share"
            value={
              summary.largestShare
                ? formatCompactKES(summary.largestShare.shareKes)
                : '—'
            }
            subtitle={
              summary.largestShare
                ? `${summary.largestShare.directorName} · ${summary.largestShare.sharePct.toFixed(1)}% of pool`
                : 'No directors with share'
            }
            loading={ps.loading}
            tone="success"
          />
          <StatCard
            title="Smallest share"
            value={
              summary.smallestShare
                ? formatCompactKES(summary.smallestShare.shareKes)
                : '—'
            }
            subtitle={
              summary.smallestShare
                ? `${summary.smallestShare.directorName} · ${summary.smallestShare.sharePct.toFixed(1)}% of pool`
                : 'No directors with share'
            }
            loading={ps.loading}
            tone="brand"
          />
          <StatCard
            title="vs prior period"
            value={formatDeltaPct(summary.priorPeriodDeltaPct)}
            subtitle={
              summary.priorPeriodDeltaPct === null
                ? 'No prior records to compare'
                : `${formatCompactKES(summary.totalDistributablePoolKes)} this period`
            }
            loading={ps.loading}
            tone={
              summary.priorPeriodDeltaPct !== null && summary.priorPeriodDeltaPct >= 0
                ? 'success'
                : 'danger'
            }
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="allocation">
          <TabsList>
            <TabsTrigger value="allocation">Allocation</TabsTrigger>
            <TabsTrigger value="history">History · 8 months</TabsTrigger>
          </TabsList>

          <TabsContent value="allocation" className="pt-4">
            <AllocationTab
              directors={ps.directors}
              poolKes={summary.totalDistributablePoolKes}
              companyKes={summary.totalCompanyShareKes}
              loading={ps.loading}
            />
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <HistoryTable rows={ps.history} loading={ps.loading} />
          </TabsContent>
        </Tabs>
      </div>

      {canRecordPredated && (
        <PredatedPayoutDialog
          open={predatedDialogOpen}
          onOpenChange={setPredatedDialogOpen}
          directors={predatedDirectors}
          projects={predatedProjects}
          onSuccess={() => ps.refresh?.()}
        />
      )}
    </div>
  );
}

// ---------- Pool card ----------

function PoolCard({
  loading,
  totalNetProfitKes,
  totalPoolKes,
  totalCompanyKes,
  status,
  fromMaterialisedTable,
  monthLabel,
}: {
  loading: boolean;
  totalNetProfitKes: number;
  totalPoolKes: number;
  totalCompanyKes: number;
  status: ProfitShareStatus;
  fromMaterialisedTable: boolean;
  monthLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-foreground bg-foreground p-6 text-background">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--gold)]">
            Distributable pool · {monthLabel}
          </p>
          <h2
            className="mt-1 font-display text-[36px] font-normal leading-[1.05] tracking-tight tabular-nums"
            style={{ fontVariationSettings: '"opsz" 72' }}
          >
            {loading ? '—' : formatCompactKES(totalPoolKes)}
          </h2>
          <p className="mt-2 max-w-2xl text-[12.5px] text-background/65">
            70% of net profit allocated by project director_tag. 30%
            retained by company. Net profit ={' '}
            {loading ? '—' : formatCompactKES(totalNetProfitKes)} (revenue from
            lagged view, fully-loaded cost).
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]',
            STATUS_TONE[status],
          )}
        >
          <CheckCircle2 className="size-3.5" /> {STATUS_LABEL[status]}
        </span>
      </div>
      {!fromMaterialisedTable && !loading && totalPoolKes > 0 && (
        <p className="mt-4 max-w-2xl text-[11px] text-background/55">
          Pool computed from current data — profit_share_records will land
          on month closure / recompute.
        </p>
      )}
      {/* 70/30 split bar */}
      <div className="mt-5">
        <div className="flex h-3 overflow-hidden rounded-full bg-background/15">
          <span
            aria-hidden
            className="bg-[var(--gold)]"
            style={{ width: '70%' }}
          />
          <span
            aria-hidden
            className="bg-background/55"
            style={{ width: '30%' }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] tracking-[0.06em] text-background/65">
          <span>
            <span className="font-semibold text-[var(--gold)]">70%</span>{' '}
            directors · {loading ? '—' : formatCompactKES(totalPoolKes)}
          </span>
          <span>
            <span className="font-semibold text-background">30%</span> company ·{' '}
            {loading ? '—' : formatCompactKES(totalCompanyKes)}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------- Allocation tab ----------

function AllocationTab({
  directors,
  poolKes,
  companyKes,
  loading,
}: {
  directors: DirectorShare[];
  poolKes: number;
  companyKes: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading allocation…
      </div>
    );
  }
  if (directors.every((d) => d.shareKes === 0)) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No distributable profit this period — directors share 70% of net
        profit when net profit is positive.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1.6fr] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          <span>Director</span>
          <span className="text-right">Share</span>
          <span className="text-right">% of pool</span>
          <span className="text-right">Projects</span>
          <span>Pool position</span>
        </div>
        <ul>
          {directors.map((d) => (
            <DirectorRow key={d.directorTag} d={d} />
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-3 font-mono text-[11px] text-muted-foreground">
        Pool {formatCompactKES(poolKes)} = sum of director shares ·{' '}
        {formatCompactKES(companyKes)} retained by company
      </div>
    </div>
  );
}

function DirectorRow({ d }: { d: DirectorShare }) {
  const isLeader = d.sharePct >= 25;
  return (
    <li className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1.6fr] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
          {d.directorName}
        </p>
        <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          {d.directorTag}
          {d.projectCount > 0 && (
            <>
              {' · '}
              {d.projectNames.slice(0, 2).join(' · ')}
              {d.projectNames.length > 2 && ` +${d.projectNames.length - 2}`}
            </>
          )}
        </p>
      </div>
      <span
        className={cn(
          'text-right font-mono text-[14px] tabular-nums',
          d.shareKes > 0 ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {formatCompactKES(d.shareKes)}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {d.sharePct.toFixed(1)}%
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {d.projectCount}
      </span>
      <div className="flex items-center gap-2">
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--paper-3)]">
          <div
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-0',
              isLeader ? 'bg-[var(--gold)]' : 'bg-foreground/70',
            )}
            style={{ width: `${Math.min(100, d.sharePct)}%` }}
          />
        </div>
      </div>
    </li>
  );
}

// ---------- History tab ----------

function HistoryTable({
  rows,
  loading,
}: {
  rows: ProfitShareHistoryRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading history…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No history available
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[140px_1fr_1fr_1fr_140px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Period</span>
        <span className="text-right">Net profit</span>
        <span className="text-right">Distributable · 70%</span>
        <span className="text-right">Company · 30%</span>
        <span>Status</span>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.yearMonth}
            className="grid grid-cols-[140px_1fr_1fr_1fr_140px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-foreground">
              {r.label}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.totalNetProfitKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {formatCompactKES(r.distributableKes)}
            </span>
            <span className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
              {formatCompactKES(r.totalNetProfitKes - r.distributableKes)}
            </span>
            <span>
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.06em]',
                  STATUS_TONE[r.status],
                )}
              >
                {STATUS_LABEL[r.status]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
