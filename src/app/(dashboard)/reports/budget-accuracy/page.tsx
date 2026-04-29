'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Download } from 'lucide-react';
import { toast } from 'sonner';

import { useUser } from '@/hooks/use-user';
import {
  useBudgetAccuracy,
  type BudgetAccuracyRow,
  type Grade,
  type GradeHistoryRow,
  type OwnerScorecardRow,
} from '@/hooks/use-budget-accuracy';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatCompactKES,
  formatYearMonth,
  getCurrentYearMonth,
} from '@/lib/format';
import { cn } from '@/lib/utils';

const ALLOWED_ROLES = new Set(['cfo', 'accountant']);
const TOLERANCE_PCT = 8;

const GRADE_TONE: Record<Grade, string> = {
  A: 'bg-success-soft text-success-soft-foreground',
  'A-': 'bg-success-soft text-success-soft-foreground',
  B: 'bg-[var(--paper-3)] text-foreground',
  'B-': 'bg-[var(--paper-3)] text-foreground',
  C: 'bg-warning-soft text-warning-soft-foreground',
  D: 'bg-danger-soft text-danger-soft-foreground',
};

const HEADLINE_TONE: Record<Grade, 'good' | 'neutral' | 'bad'> = {
  A: 'good',
  'A-': 'good',
  B: 'neutral',
  'B-': 'neutral',
  C: 'bad',
  D: 'bad',
};

function formatVariancePct(pct: number): string {
  const sign = pct >= 0 ? '+ ' : '− ';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export default function BudgetAccuracyPage() {
  const { user } = useUser();
  const router = useRouter();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  // Route-level role gate.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Budget Accuracy is restricted to CFO and accountants');
      router.push('/');
    }
  }, [user?.role, router]);

  const accuracy = useBudgetAccuracy(selectedMonth);
  const summary = accuracy.summary;

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
          primary="Budget"
          accent="accuracy"
          subtitle={
            accuracy.loading
              ? `${formatYearMonth(selectedMonth)} · loading…`
              : summary.budgetCount === 0
                ? `${formatYearMonth(selectedMonth)} · no expense_variances rows for this month`
                : `${formatYearMonth(selectedMonth)} · ${summary.budgetCount} ${
                    summary.budgetCount === 1 ? 'budget' : 'budgets'
                  } · ${summary.portfolioAccuracyPct.toFixed(1)}% portfolio accuracy · grade ${summary.portfolioGrade} · tolerance ±${TOLERANCE_PCT}%`
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
              <Button
                variant="default"
                size="sm"
                disabled
                className="gap-1"
                title="Coming soon — owner notifications"
              >
                <Award className="size-4" /> Issue grades
              </Button>
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow={`Portfolio accuracy · ${summary.monthLabel}`}
            value={`${summary.portfolioAccuracyPct.toFixed(1)}%`}
            tone={HEADLINE_TONE[summary.portfolioGrade]}
            sub={
              summary.budgetCount === 0
                ? 'No budgets reported this month'
                : `Grade ${summary.portfolioGrade} · ${summary.portfolioPoints} pts · streak ${summary.streakMonths}mo`
            }
            loading={accuracy.loading}
          />
          <StatCard
            title="Most accurate"
            value={summary.mostAccurate?.name ?? '—'}
            subtitle={
              summary.mostAccurate
                ? `${formatVariancePct(summary.mostAccurate.variancePct)} · grade ${summary.mostAccurate.grade}`
                : 'No budgets'
            }
            loading={accuracy.loading}
            tone="success"
          />
          <StatCard
            title="Largest miss"
            value={summary.largestMiss?.name ?? '—'}
            subtitle={
              summary.largestMiss
                ? `${formatVariancePct(summary.largestMiss.variancePct)} · grade ${summary.largestMiss.grade}`
                : 'No budgets'
            }
            loading={accuracy.loading}
            tone="danger"
          />
          <StatCard
            title="Streak"
            value={
              summary.streakMonths === 0
                ? '0'
                : `${summary.streakMonths}mo`
            }
            subtitle={`Inside ±${TOLERANCE_PCT}% portfolio band`}
            loading={accuracy.loading}
            tone="brand"
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="by-project">
          <TabsList>
            <TabsTrigger value="by-project">
              By project{' '}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {accuracy.projects.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="owner-scorecard">Owner scorecard</TabsTrigger>
            <TabsTrigger value="grade-history">12-month grade history</TabsTrigger>
          </TabsList>

          <TabsContent value="by-project" className="pt-4">
            <ByProjectTable rows={accuracy.projects} loading={accuracy.loading} />
          </TabsContent>

          <TabsContent value="owner-scorecard" className="pt-4">
            <OwnerScorecardTable
              rows={accuracy.ownerScorecard}
              loading={accuracy.loading}
            />
          </TabsContent>

          <TabsContent value="grade-history" className="pt-4">
            <GradeHistoryTable
              rows={accuracy.gradeHistory}
              loading={accuracy.loading}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- By project tab ----------

function ByProjectTable({
  rows,
  loading,
}: {
  rows: BudgetAccuracyRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading per-project accuracy…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No expense_variances rows for the selected month
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.6fr_120px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Project · owner</span>
        <span className="text-right">Plan</span>
        <span className="text-right">Actual</span>
        <span className="text-right">Variance</span>
        <span>Accuracy · ±{TOLERANCE_PCT}% band</span>
        <span className="text-center">Grade</span>
      </div>
      <ul>
        {rows.map((row) => (
          <ByProjectRow key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function ByProjectRow({ row }: { row: BudgetAccuracyRow }) {
  const varianceTone =
    Math.abs(row.variancePct) <= TOLERANCE_PCT
      ? 'text-success-soft-foreground'
      : 'text-[var(--danger)]';

  const ownerLine = row.isShared
    ? `${row.ownerName} · shared`
    : row.streakMonths > 0
      ? `${row.ownerName} · streak ${row.streakMonths}mo`
      : row.ownerName;

  return (
    <li className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1.6fr_120px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
          {row.name}
        </p>
        <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          {ownerLine}
        </p>
      </div>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {formatCompactKES(row.planKes)}
      </span>
      <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
        {formatCompactKES(row.actualKes)}
      </span>
      <span
        className={cn(
          'text-right font-mono text-[13px] tabular-nums',
          varianceTone,
        )}
      >
        {formatVariancePct(row.variancePct)}
      </span>
      <AccuracyBar variancePct={row.variancePct} />
      <div className="flex justify-center">
        <GradeChip grade={row.grade} points={row.gradePoints} />
      </div>
    </li>
  );
}

/**
 * Inline accuracy bar primitive.
 *
 * Layers:
 *   1. Track — paper-3 background, full width.
 *   2. Center axis — ink hairline at 50% (zero variance).
 *   3. Tolerance band — soft success tint covering ±TOLERANCE_PCT% around centre.
 *   4. Pin — 4px-wide marker at the actual variance position. Coloured
 *      by tone (success when inside band, danger when outside, ink for
 *      negative-but-inside-band).
 *
 * Coordinate system: variance% in [-50, +50] maps linearly to [0%, 100%].
 * Values outside that range are clamped.
 */
function AccuracyBar({ variancePct }: { variancePct: number }) {
  const SCALE = 50; // pct extremes that map to bar edges
  const clamped = Math.max(-SCALE, Math.min(SCALE, variancePct));
  const pinLeft = ((clamped + SCALE) / (SCALE * 2)) * 100;
  const bandHalfPct = (TOLERANCE_PCT / SCALE) * 50;
  const bandLeft = 50 - bandHalfPct;
  const bandRight = 50 + bandHalfPct;
  const insideBand = Math.abs(variancePct) <= TOLERANCE_PCT;
  const overShot = variancePct > TOLERANCE_PCT;

  const pinClass = insideBand
    ? 'bg-[var(--success,oklch(0.55_0.13_145))]'
    : overShot
      ? 'bg-[var(--danger)]'
      : 'bg-foreground';

  return (
    <div
      className="relative h-7 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--paper-3)]"
      role="presentation"
    >
      {/* Tolerance band */}
      <div
        aria-hidden
        className="absolute inset-y-0 bg-[oklch(0.95_0.04_140)]"
        style={{ left: `${bandLeft}%`, right: `${100 - bandRight}%` }}
      />
      {/* Center axis */}
      <div
        aria-hidden
        className="absolute inset-y-0 w-px bg-foreground/40"
        style={{ left: '50%' }}
      />
      {/* Pin */}
      <div
        aria-hidden
        className={cn('absolute -top-0.5 -bottom-0.5 w-1 rounded-[2px]', pinClass)}
        style={{ left: `calc(${pinLeft}% - 2px)` }}
        title={`${formatVariancePct(variancePct)} variance`}
      />
    </div>
  );
}

function GradeChip({
  grade,
  points,
  size = 'lg',
}: {
  grade: Grade;
  points?: number;
  size?: 'sm' | 'lg';
}) {
  const dim =
    size === 'lg'
      ? 'size-14 font-display text-[20px]'
      : 'size-8 font-display text-[12px]';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-full font-semibold leading-none',
        GRADE_TONE[grade],
        dim,
      )}
      aria-label={`Grade ${grade}${points !== undefined ? `, ${points} points` : ''}`}
    >
      <span>{grade}</span>
      {points !== undefined && size === 'lg' && (
        <span className="mt-0.5 font-mono text-[9px] font-medium tracking-[0.1em]">
          {points} PTS
        </span>
      )}
    </div>
  );
}

// ---------- Owner scorecard tab ----------

function OwnerScorecardTable({
  rows,
  loading,
}: {
  rows: OwnerScorecardRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading owner scorecard…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No owner data in the trailing 6 months
      </div>
    );
  }

  const monthLabels = rows[0].monthlyGrades.map((g) => g.label);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div
        className="grid gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
        style={{ gridTemplateColumns: '1.6fr repeat(6, 1fr) 1fr' }}
      >
        <span>Owner</span>
        {monthLabels.map((m) => (
          <span key={m} className="text-center">
            {m}
          </span>
        ))}
        <span className="text-right">Average</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li
            key={row.ownerId}
            className="grid items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
            style={{ gridTemplateColumns: '1.6fr repeat(6, 1fr) 1fr' }}
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium leading-tight text-foreground">
                {row.ownerName}
              </p>
              {row.scope && (
                <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                  {row.scope}
                </p>
              )}
            </div>
            {row.monthlyGrades.map((g) => (
              <div key={g.month} className="flex justify-center">
                {g.grade ? (
                  <GradeChip grade={g.grade} size="sm" />
                ) : (
                  <span className="font-mono text-[11px] text-[var(--paper-4)]">
                    —
                  </span>
                )}
              </div>
            ))}
            <span
              className={cn(
                'text-right font-mono text-[14px] font-semibold tabular-nums',
                row.averageGrade === 'A' || row.averageGrade === 'A-'
                  ? 'text-success-soft-foreground'
                  : row.averageGrade === 'D'
                    ? 'text-[var(--danger)]'
                    : 'text-foreground',
              )}
            >
              {row.averageGrade} · {row.averagePoints} pts
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 12-month grade history tab ----------

function GradeHistoryTable({
  rows,
  loading,
}: {
  rows: GradeHistoryRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        Loading grade history…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        No grade history available
      </div>
    );
  }

  // Max bucket count across all months — used to scale the distribution bars
  // so the largest cohort fills the row visually.
  const maxBucket = rows.reduce((max, r) => {
    const localMax = Math.max(
      r.gradeDistribution.A,
      r.gradeDistribution['A-'],
      r.gradeDistribution.B,
      r.gradeDistribution['B-'],
      r.gradeDistribution.C,
      r.gradeDistribution.D,
    );
    return Math.max(max, localMax);
  }, 1);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="grid grid-cols-[120px_140px_1fr_120px] gap-4 border-b border-border bg-muted/30 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span>Month</span>
        <span>Portfolio grade</span>
        <span>Distribution</span>
        <span className="text-right">Accuracy</span>
      </div>
      <ul>
        {rows.map((row) => (
          <li
            key={row.month}
            className="grid grid-cols-[120px_140px_1fr_120px] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-foreground">
              {row.label}
            </span>
            <div className="flex items-center gap-2">
              <GradeChip grade={row.portfolioGrade} size="sm" />
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {row.portfolioPoints} pts
              </span>
            </div>
            <DistributionBars
              distribution={row.gradeDistribution}
              maxBucket={maxBucket}
            />
            <span className="text-right font-mono text-[13px] tabular-nums text-foreground">
              {row.portfolioAccuracyPct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DISTRIBUTION_GRADES: Grade[] = ['A', 'A-', 'B', 'B-', 'C', 'D'];

const DIST_FILL: Record<Grade, string> = {
  A: 'bg-[oklch(0.55_0.13_145)]',
  'A-': 'bg-[oklch(0.65_0.10_145)]',
  B: 'bg-foreground/70',
  'B-': 'bg-foreground/45',
  C: 'bg-[var(--gold)]',
  D: 'bg-[var(--danger)]',
};

function DistributionBars({
  distribution,
  maxBucket,
}: {
  distribution: Record<Grade, number>;
  maxBucket: number;
}) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {DISTRIBUTION_GRADES.map((g) => {
        const count = distribution[g];
        const heightPct = maxBucket > 0 ? (count / maxBucket) * 100 : 0;
        return (
          <div key={g} className="flex flex-col items-center gap-1">
            <div className="relative h-8 w-full overflow-hidden rounded-sm bg-[var(--paper-3)]">
              <div
                className={cn(
                  'absolute inset-x-0 bottom-0',
                  DIST_FILL[g],
                )}
                style={{ height: `${heightPct}%` }}
                aria-hidden
              />
            </div>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {g}·{count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
