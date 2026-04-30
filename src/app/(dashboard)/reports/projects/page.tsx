'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

import { useUser } from '@/hooks/use-user';
import {
  useProfitability,
  type ProfitabilityRow,
} from '@/hooks/use-profitability';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatCompactKES,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);

type MetricDirection = 'high' | 'low' | 'none';

type MetricRow = {
  key: string;
  label: string;
  direction: MetricDirection;
  // Returns the numeric value used for ranking (null = excluded from ranking)
  // and the formatted display string for the cell.
  cell: (row: ProfitabilityRow) => { value: number | null; display: string };
};

const METRIC_ROWS: MetricRow[] = [
  {
    key: 'revenue',
    label: 'Revenue',
    direction: 'high',
    cell: (row) => ({
      value: row.revenueKes,
      display: formatCompactKES(row.revenueKes),
    }),
  },
  {
    key: 'direct-cost',
    label: 'Direct cost',
    direction: 'low',
    cell: (row) => ({
      value: row.directCostKes,
      display: formatCompactKES(row.directCostKes),
    }),
  },
  {
    key: 'allocated-overhead',
    label: 'Allocated overhead',
    direction: 'low',
    cell: (row) => ({
      value: row.allocatedOverheadKes > 0 ? row.allocatedOverheadKes : null,
      display:
        row.allocatedOverheadKes > 0
          ? formatCompactKES(row.allocatedOverheadKes)
          : '—',
    }),
  },
  {
    key: 'total-cost',
    label: 'Total cost',
    direction: 'low',
    cell: (row) => ({
      value: row.totalCostKes,
      display: formatCompactKES(row.totalCostKes),
    }),
  },
  {
    key: 'net-margin',
    label: 'Net margin',
    direction: 'high',
    cell: (row) => ({
      value: row.marginPct,
      display: `${row.marginPct.toFixed(1)}%`,
    }),
  },
  {
    key: 'rev-per-agent',
    label: 'Rev / agent / month',
    direction: 'high',
    cell: (row) => {
      const hc = row.headcount ?? 0;
      if (hc <= 0) return { value: null, display: '—' };
      const v = row.revenueKes / hc;
      return { value: v, display: formatCompactKES(v) };
    },
  },
  {
    key: 'cost-per-agent',
    label: 'Cost / agent / month',
    direction: 'low',
    cell: (row) => {
      const hc = row.headcount ?? 0;
      if (hc <= 0) return { value: null, display: '—' };
      const v = row.totalCostKes / hc;
      return { value: v, display: formatCompactKES(v) };
    },
  },
  {
    key: 'headcount',
    label: 'Headcount',
    direction: 'none',
    cell: (row) => {
      const hc = row.headcount ?? 0;
      return {
        value: hc > 0 ? hc : null,
        display: hc > 0 ? `${hc} agents` : '—',
      };
    },
  },
];

export default function ProjectComparisonPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  // Route-level role gate — same as Profitability.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Project Comparison is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const profitability = useProfitability(selectedMonth);
  const summary = profitability.summary;

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }),
    [],
  );

  // Sort projects by net margin descending so the strongest is first.
  const sortedProjects = useMemo(
    () =>
      [...profitability.projects].sort((a, b) => b.marginPct - a.marginPct),
    [profitability.projects],
  );

  const projectCount = sortedProjects.length;

  const totalAgents = useMemo(
    () => sortedProjects.reduce((s, r) => s + (r.headcount ?? 0), 0),
    [sortedProjects],
  );

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Project"
          accent="comparison"
          subtitle={
            profitability.loading
              ? `${formatYearMonth(selectedMonth)} · loading…`
              : `${formatYearMonth(selectedMonth)} · ${summary.projectCount} ${
                  summary.projectCount === 1 ? 'project' : 'projects'
                } · ${formatCompactKES(summary.totalRevenueKes)} revenue · ${summary.blendedMarginPct.toFixed(1)}% blended net margin`
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
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon"
              >
                <Download className="size-4" /> Export PDF
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow={`Total revenue · ${summary.monthLabel}`}
            value={formatCompactKES(summary.totalRevenueKes)}
            tone="neutral"
            sub={
              summary.projectCount === 0
                ? 'No active projects'
                : `${summary.projectCount} active ${summary.projectCount === 1 ? 'project' : 'projects'}`
            }
            loading={profitability.loading}
          />
          <StatCard
            title="Total cost · fully-loaded"
            value={formatCompactKES(summary.totalCostKes)}
            subtitle={`${formatCompactKES(summary.totalDirectCostKes)} direct + ${formatCompactKES(summary.totalAllocatedOverheadKes)} allocated overhead`}
            loading={profitability.loading}
            tone="brand"
          />
          <StatCard
            title="Net profit"
            value={formatCompactKES(summary.totalGrossProfitKes)}
            subtitle={`${summary.blendedMarginPct.toFixed(1)}% blended net margin`}
            loading={profitability.loading}
            tone={summary.totalGrossProfitKes >= 0 ? 'success' : 'danger'}
          />
          <StatCard
            title="Total agents"
            value={totalAgents > 0 ? `${totalAgents}` : '—'}
            subtitle={
              summary.projectCount === 0
                ? 'No project pool'
                : `${summary.projectCount} project pool`
            }
            loading={profitability.loading}
            tone="brand"
          />
        </div>

        <section className="space-y-4">
          <header>
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Reports · Side-by-side benchmark
            </p>
            <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
              Side-by-side{' '}
              <em className="not-italic italic text-[var(--gold-lo)]">
                benchmark
              </em>
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
              {projectCount} {projectCount === 1 ? 'project' : 'projects'} ·
              green chip = best in metric · red text = worst. Sorted by net
              margin descending.
            </p>
          </header>

          <BenchmarkGrid
            projects={sortedProjects}
            loading={profitability.loading}
            selectedMonth={selectedMonth}
          />

          {!profitability.loading && projectCount === 1 && (
            <p className="text-[12px] text-muted-foreground">
              Best/worst comparison needs 2+ projects.
            </p>
          )}
          {!profitability.loading && summary.unallocatedOverheadKes > 0 && (
            <p className="text-[12px] text-muted-foreground">
              {formatCompactKES(summary.unallocatedOverheadKes)} overhead
              unallocated — projects without agent counts excluded from the
              allocation pool.
            </p>
          )}
          {!profitability.loading &&
            summary.totalSharedExpensesKes > 0 &&
            !summary.allocationFromMaterializedTable && (
              <p className="text-[12px] text-muted-foreground">
                Allocation computed from agent_counts (materialised allocation
                not yet available for this month).
              </p>
            )}
        </section>
      </div>
    </div>
  );
}

function BenchmarkGrid({
  projects,
  loading,
  selectedMonth,
}: {
  projects: ProfitabilityRow[];
  loading: boolean;
  selectedMonth: string;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading project comparison…
      </div>
    );
  }
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No projects with revenue or expenses for {formatYearMonth(selectedMonth)}
      </div>
    );
  }

  const projectCount = projects.length;
  const enableHighlight = projectCount >= 2;
  const gridTemplate = `220px repeat(${projectCount}, minmax(180px, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
        {/* Header row — corner cell + project columns */}
        <div className="border-b border-border bg-[var(--paper-2)] px-5 py-4 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Metric
        </div>
        {projects.map((p) => (
          <div
            key={p.id}
            className="flex flex-col gap-1 border-b border-l border-border bg-foreground px-5 py-4 text-background"
          >
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--gold-lo)]">
              Project · {p.headcount ?? 0} agents
            </span>
            <span className="font-display text-[16px] font-medium leading-tight">
              {p.name}
            </span>
          </div>
        ))}

        {/* Metric rows */}
        {METRIC_ROWS.map((metric, rowIdx) => {
          const cells = projects.map((p) => metric.cell(p));
          const ranked = cells
            .map((c, i) => ({ value: c.value, idx: i }))
            .filter(
              (c): c is { value: number; idx: number } => c.value !== null,
            );

          let bestIdx: number | null = null;
          let worstIdx: number | null = null;
          if (
            enableHighlight &&
            metric.direction !== 'none' &&
            ranked.length >= 2
          ) {
            const sorted = [...ranked].sort((a, b) =>
              metric.direction === 'high'
                ? b.value - a.value
                : a.value - b.value,
            );
            // Only highlight when best and worst differ (avoid tagging ties).
            if (sorted[0].value !== sorted[sorted.length - 1].value) {
              bestIdx = sorted[0].idx;
              worstIdx = sorted[sorted.length - 1].idx;
            }
          }

          const isLastRow = rowIdx === METRIC_ROWS.length - 1;

          return (
            <div key={metric.key} className="contents">
              <div
                className={cn(
                  'flex items-center bg-[var(--paper-2)] px-5 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground',
                  !isLastRow && 'border-b border-border/60',
                )}
              >
                {metric.label}
              </div>
              {projects.map((p, i) => {
                const cell = cells[i];
                const isBest = bestIdx === i;
                const isWorst = worstIdx === i;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'relative flex items-center justify-end border-l border-border/60 px-5 py-3',
                      !isLastRow && 'border-b border-border/60',
                      isBest && 'bg-success-soft',
                    )}
                  >
                    {isBest && (
                      <span className="absolute right-2 top-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em] text-success-soft-foreground">
                        BEST
                      </span>
                    )}
                    <span
                      className={cn(
                        'font-mono text-[13px] tabular-nums',
                        isWorst
                          ? 'text-[var(--danger)]'
                          : 'text-foreground',
                      )}
                    >
                      {cell.display}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
