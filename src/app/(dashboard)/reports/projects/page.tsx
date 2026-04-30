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

function marginToneClass(marginPct: number): string {
  if (marginPct >= 15) return 'text-success-soft-foreground';
  if (marginPct >= 5) return 'text-foreground';
  if (marginPct >= 0) return 'text-[var(--warm-grey-3)]';
  return 'text-[var(--danger)]';
}

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

  const totalAgents = useMemo(
    () =>
      profitability.projects.reduce(
        (s, r) => s + (r.headcount ?? 0),
        0,
      ),
    [profitability.projects],
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
                title="Coming soon — PDF export"
              >
                <Download className="size-4" /> Export PDF
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* KPI strip */}
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

        {/* Per-project comparison table */}
        <section className="space-y-4">
          <header>
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Per-project · {summary.monthLabel}
            </p>
            <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
              Project comparison{' '}
              <em className="not-italic italic text-[var(--gold-lo)]">
                by net margin
              </em>
            </h3>
            <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
              Sorted by fully-loaded margin descending. Direct cost plus
              allocated overhead. Revenue per agent shown on the right.
            </p>
          </header>

          <ComparisonTable
            rows={profitability.projects}
            loading={profitability.loading}
            selectedMonth={selectedMonth}
          />

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

function ComparisonTable({
  rows,
  loading,
  selectedMonth,
}: {
  rows: ProfitabilityRow[];
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
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No projects with revenue or expenses for {formatYearMonth(selectedMonth)}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Project</span>
        <span className="text-right">Revenue</span>
        <span className="text-right">Cost</span>
        <span className="text-right">Net profit</span>
        <span className="text-right">Net margin</span>
        <span className="text-right">Agents</span>
        <span className="text-right">Rev / agent</span>
      </div>
      <ul>
        {rows.map((row) => (
          <ComparisonRow key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function ComparisonRow({ row }: { row: ProfitabilityRow }) {
  const revPerAgent =
    row.headcount !== undefined && row.headcount > 0
      ? row.revenueKes / row.headcount
      : null;
  const profitTone =
    row.grossProfitKes >= 0 ? 'text-foreground' : 'text-[var(--danger)]';
  return (
    <li className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr_1fr] items-center gap-4 border-b border-border/60 px-6 py-4 transition-colors hover:bg-muted/30 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
          <span
            aria-hidden
            className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-[var(--paper-2)] font-mono text-[10.5px] tabular-nums text-muted-foreground"
          >
            {row.marginRank}
          </span>
          {row.name}
        </p>
        {row.allocatedOverheadKes > 0 && (
          <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
            {formatCompactKES(row.directCostKes)} direct +{' '}
            {formatCompactKES(row.allocatedOverheadKes)} overhead
          </p>
        )}
      </div>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {formatCompactKES(row.revenueKes)}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {formatCompactKES(row.totalCostKes)}
      </span>
      <span
        className={cn(
          'text-right font-mono text-[13px] tabular-nums',
          profitTone,
        )}
      >
        {formatCompactKES(row.grossProfitKes)}
      </span>
      <span
        className={cn(
          'text-right font-mono text-[13px] tabular-nums',
          marginToneClass(row.marginPct),
        )}
      >
        {row.marginPct.toFixed(1)}%
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {row.headcount !== undefined ? (
          <>
            {row.headcount}
            {row.headcountSharePct !== null && (
              <span className="ml-1 text-muted-foreground">
                ({row.headcountSharePct.toFixed(0)}%)
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {revPerAgent !== null ? (
          formatCompactKES(revPerAgent)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </span>
    </li>
  );
}
