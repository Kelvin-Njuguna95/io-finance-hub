'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useVariance } from '@/hooks/use-variance';
import { PageTitle } from '@/components/layout/page-title';
import { StatCard } from '@/components/layout/stat-card';
import { HeadlineStatCard } from '@/components/finance/headline-stat-card';
import { VarianceBullet } from '@/components/finance/variance-bullet';
import { VarianceDriversList } from '@/components/finance/variance-drivers-list';
import { VarianceDivergenceChart } from '@/components/finance/variance-divergence-chart';
import { VarianceWaterfall } from '@/components/finance/variance-waterfall';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatCurrency,
  formatCompactKES,
  getCurrentYearMonth,
  formatYearMonth,
} from '@/lib/format';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';

// ---- Types ----

interface PendingExpenseRow {
  id: string;
  budget_id: string;
  project_id: string | null;
  department_id: string | null;
  year_month: string;
  description: string;
  category: string | null;
  budgeted_amount_kes: number;
  actual_amount_kes: number | null;
  variance_kes: number;
  variance_pct: number;
  status: string;
  projects: { name: string } | null;
  departments: { name: string } | null;
}

interface AggregatedRow {
  name: string;
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number;
  confirmed: number;
  pending: number;
  voided: number;
  accuracyScore: number;
}

interface TrendPoint {
  month: string;
  label: string;
  accuracyScore: number;
}

// ---- Constants ----

const COLORS = {
  budgeted: 'oklch(0.64 0.19 290)',
  actual: 'oklch(0.80 0.16 78)',
  overspend: 'oklch(0.63 0.23 25)',
  underspend: 'oklch(0.68 0.16 158)',
  onTarget: 'oklch(0.64 0.19 290)',
};

const PIE_COLORS = ['oklch(0.63 0.23 25)', 'oklch(0.68 0.16 158)', 'oklch(0.64 0.19 290)'];

// ---- Helpers ----

function varianceBadge(pct: number) {
  const abs = Math.abs(pct);
  if (abs <= 5) return <Badge variant="secondary" className="bg-success-soft text-success-soft-foreground">On Target</Badge>;
  if (abs <= 15) return <Badge variant="secondary" className="bg-warning-soft text-warning-soft-foreground">Warning</Badge>;
  return <Badge variant="secondary" className="bg-danger-soft text-danger-soft-foreground">{pct > 0 ? 'Overspend' : 'Underspend'}</Badge>;
}

function calcAccuracy(variancePct: number): number {
  return Math.max(0, 100 - Math.abs(variancePct));
}

function aggregateBy(
  items: PendingExpenseRow[],
  keyFn: (item: PendingExpenseRow) => string | null,
): AggregatedRow[] {
  const map = new Map<string, {
    budgeted: number;
    actual: number;
    confirmed: number;
    pending: number;
    voided: number;
  }>();

  for (const item of items) {
    const key = keyFn(item) || 'Shared Expenses';
    const existing = map.get(key) || { budgeted: 0, actual: 0, confirmed: 0, pending: 0, voided: 0 };
    existing.budgeted += Number(item.budgeted_amount_kes);
    existing.actual += Number(item.actual_amount_kes || 0);
    if (item.status === 'confirmed') existing.confirmed++;
    else if (item.status === 'voided') existing.voided++;
    else existing.pending++;
    map.set(key, existing);
  }

  return Array.from(map.entries()).map(([name, data]) => {
    const variance = data.actual - data.budgeted;
    const variancePct = data.budgeted === 0 ? 0 : (variance / data.budgeted) * 100;
    return {
      name,
      budgeted: data.budgeted,
      actual: data.actual,
      variance,
      variancePct: Math.round(variancePct * 100) / 100,
      confirmed: data.confirmed,
      pending: data.pending,
      voided: data.voided,
      accuracyScore: Math.round(calcAccuracy(variancePct) * 100) / 100,
    };
  });
}

// ---- Component ----

const ALLOWED_ROLES = new Set(['cfo', 'accountant', 'project_manager']);

export default function VarianceDashboardPage() {
  const { user } = useUser();
  const router = useRouter();
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  // Route-level role gate (D5 amended): allow CFO, accountant, PM. Redirect
  // TL and dept-head with a toast. PM access is unscoped — no project filter.
  useEffect(() => {
    if (!user?.role) return;
    if (!ALLOWED_ROLES.has(user.role)) {
      toast.error('Variance dashboard is restricted');
      router.push('/expenses');
    }
  }, [user?.role, router]);

  const variance = useVariance(selectedMonth);

  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Load data for selected month
  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase
        .from('pending_expenses')
        .select('*, projects(name), departments(name)')
        .eq('year_month', selectedMonth);

      if (error) {
        toast.error('Failed to load variance data');
        setLoading(false);
        return;
      }

      setItems((data || []) as unknown as PendingExpenseRow[]);
      setLoading(false);
    }
    load();
  }, [selectedMonth]);

  // Aggregations — kept for the legacy By Project / By Category tab
  // content that ships unchanged this commit (Commit 3 replaces them).
  const projectItems = items.filter((i) => i.project_id !== null);

  const byProject = aggregateBy(projectItems, (i) => i.projects?.name ?? null);
  const byCategory = aggregateBy(items, (i) => i.category);

  // ---- Legacy Company Overview derivations removed in Commit 2 ----
  // The 6-card KPI block, accuracy trend, and Recharts variance pie are
  // gone. The page-level KPI strip (Commit 1) and VarianceWaterfall
  // (this commit) replace them. Keep the placeholder filter so the
  // rest of this section still type-checks.
  // Recompute handler (CFO only)
  async function handleRecompute() {
    setRecomputing(true);
    try {
      const supabase = createClient();

      // Fetch all pending_expenses for this month and recompute aggregated variances
      const { data: pendingItems, error: fetchError } = await supabase
        .from('pending_expenses')
        .select('project_id, department_id, category, budgeted_amount_kes, actual_amount_kes, status')
        .eq('year_month', selectedMonth);

      if (fetchError) throw fetchError;

      // Group by project_id + department_id + category
      const groups = new Map<string, {
        project_id: string | null;
        department_id: string | null;
        category: string | null;
        budgeted: number;
        actual: number;
        confirmed: number;
        pending: number;
        voided: number;
        modified: number;
      }>();

      for (const item of pendingItems || []) {
        const key = `${item.project_id || ''}_${item.department_id || ''}_${item.category || ''}`;
        const g = groups.get(key) || {
          project_id: item.project_id,
          department_id: item.department_id,
          category: item.category,
          budgeted: 0, actual: 0, confirmed: 0, pending: 0, voided: 0, modified: 0,
        };
        g.budgeted += Number(item.budgeted_amount_kes);
        g.actual += Number(item.actual_amount_kes || 0);
        if (item.status === 'confirmed') g.confirmed++;
        else if (item.status === 'voided') g.voided++;
        else if (item.status === 'modified') g.modified++;
        else g.pending++;
        groups.set(key, g);
      }

      // Upsert into expense_variances
      for (const g of groups.values()) {
        const variancePct = g.budgeted === 0 ? 0 : ((g.actual - g.budgeted) / g.budgeted) * 100;
        const accuracy = Math.round(calcAccuracy(variancePct) * 100) / 100;

        await supabase.from('expense_variances').upsert({
          year_month: selectedMonth,
          project_id: g.project_id,
          department_id: g.department_id,
          category: g.category,
          budgeted_total_kes: g.budgeted,
          actual_total_kes: g.actual,
          confirmed_count: g.confirmed,
          pending_count: g.pending,
          voided_count: g.voided,
          modified_count: g.modified,
          accuracy_score: accuracy,
          computed_at: new Date().toISOString(),
        }, {
          onConflict: 'year_month,project_id,department_id,category',
        });
      }

      toast.success('Variances recomputed successfully');

      // Reload data
      const { data: refreshed } = await supabase
        .from('pending_expenses')
        .select('*, projects(name), departments(name)')
        .eq('year_month', selectedMonth);

      setItems((refreshed || []) as unknown as PendingExpenseRow[]);
    } catch {
      toast.error('Failed to recompute variances');
    } finally {
      setRecomputing(false);
    }
  }

  // ---- Renderers ----

  function renderVarianceTable(rows: AggregatedRow[]) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Budgeted (KES)</TableHead>
            <TableHead className="text-right">Actual (KES)</TableHead>
            <TableHead className="text-right">Variance (KES)</TableHead>
            <TableHead className="text-right">Variance %</TableHead>
            <TableHead className="text-center">Status Items</TableHead>
            <TableHead className="text-right">Accuracy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Please wait</TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No data for {formatYearMonth(selectedMonth)}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(r.budgeted, 'KES')}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatCurrency(r.actual, 'KES')}
                </TableCell>
                <TableCell className={`text-right font-mono text-sm ${r.variance > 0 ? 'text-danger-soft-foreground' : r.variance < 0 ? 'text-success-soft-foreground' : ''}`}>
                  {formatCurrency(r.variance, 'KES')}
                </TableCell>
                <TableCell className="text-right">
                  {varianceBadge(r.variancePct)}
                  <span className="ml-1 text-xs text-muted-foreground">{r.variancePct.toFixed(1)}%</span>
                </TableCell>
                <TableCell className="text-center space-x-1">
                  <Badge variant="secondary" className="bg-success-soft text-success-soft-foreground text-xs">{r.confirmed}</Badge>
                  <Badge variant="secondary" className="bg-warning-soft text-warning-soft-foreground text-xs">{r.pending}</Badge>
                  <Badge variant="secondary" className="bg-danger-soft text-danger-soft-foreground text-xs">{r.voided}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {r.accuracyScore.toFixed(1)}%
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    );
  }

  function renderBarChart(data: AggregatedRow[]) {
    return (
      <Card className="io-card mt-4">
        <CardContent className="p-4">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={60} />
              <YAxis tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => [formatCurrency(Number(value), 'KES'), '']} />
              <Legend />
              <Bar dataKey="budgeted" name="Budgeted" fill={COLORS.budgeted} />
              <Bar dataKey="actual" name="Actual" fill={COLORS.actual} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  }

  // ---- KPI strip data (sourced from useVariance.summary) ----
  const summary = variance.summary;
  const headlineTone: 'bad' | 'good' | 'neutral' =
    summary.netVarianceKes > 0 ? 'bad' : summary.netVarianceKes < 0 ? 'good' : 'neutral';
  const headlineSign = summary.netVarianceKes >= 0 ? '+ ' : '− ';
  const headlineValue = `KES ${headlineSign}${Math.abs(summary.netVarianceKes).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Variance"
          accent="dashboard"
          subtitle={`${formatYearMonth(selectedMonth)} · month-to-date · ${summary.totalActiveBudgets} active budgets · ${summary.overToleranceCount} over tolerance · tracking against ${formatCompactKES(summary.planKes)} approved plan`}
          action={
            <div className="flex items-center gap-2">
              <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
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
              {user?.role === 'cfo' && (
                <Button
                  onClick={handleRecompute}
                  disabled={recomputing}
                  variant="outline"
                  size="sm"
                >
                  {recomputing ? 'Recomputing…' : 'Recompute variances'}
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="space-y-6 p-6">
        {/* New 4-card KPI strip */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HeadlineStatCard
            eyebrow={`Net variance · ${summary.monthLabel}`}
            value={headlineValue}
            tone={headlineTone}
            sub={
              summary.netVariancePct === 0 ? (
                <>0% variance · all budgets in tolerance</>
              ) : (
                <>
                  {summary.netVariancePct >= 0 ? '+ ' : '− '}
                  {Math.abs(summary.netVariancePct).toFixed(2)}% {summary.netVarianceKes >= 0 ? 'over' : 'under'} plan
                  {summary.concentrationTopN > 0 && summary.concentrationShare > 0 && (
                    <>
                      {' · '}
                      {summary.concentrationTopN} budgets driving {summary.concentrationShare.toFixed(0)}% of overage
                    </>
                  )}
                </>
              )
            }
            loading={variance.loading}
          />
          <StatCard
            title="Spent vs plan"
            value={formatCompactKES(summary.spentKes)}
            subtitle={`of ${formatCompactKES(summary.planKes)} planned · ${summary.periodElapsedPct.toFixed(0)}% of period elapsed`}
            loading={variance.loading}
            tone="brand"
          />
          <StatCard
            title="Over tolerance"
            value={
              summary.overToleranceCount === 1 ? '1 budget' : `${summary.overToleranceCount} budgets`
            }
            subtitle={
              summary.overToleranceCount === 0
                ? 'All within tolerance'
                : summary.overToleranceCluster
                  ? `5% threshold · ${summary.overToleranceCluster}`
                  : '5% threshold breached'
            }
            loading={variance.loading}
            tone={summary.overToleranceCount > 0 ? 'danger' : 'success'}
          />
          <StatCard
            title="Underspending"
            value={
              summary.underspendingCount === 1 ? '1 budget' : `${summary.underspendingCount} budgets`
            }
            subtitle={
              summary.underspendingCount === 0
                ? 'No projected savings'
                : summary.underspendingLeader
                  ? `− ${formatCompactKES(summary.underspendingProjectedSavingsKes)} projected · ${summary.underspendingLeader} leading`
                  : `− ${formatCompactKES(summary.underspendingProjectedSavingsKes)} projected savings`
            }
            loading={variance.loading}
            tone={summary.underspendingCount > 0 ? 'success' : 'info'}
          />
        </div>

        {/* Two-up: divergence chart (1.5fr) + drivers list (1fr top 7) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <section className="rounded-lg border border-border bg-card p-6">
            <header className="mb-4">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Daily burn · {variance.monthLabel} MTD
              </p>
              <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                Actual is tracking{' '}
                <em
                  className="not-italic italic"
                  style={{ color: 'var(--gold-lo)' }}
                >
                  {summary.netVariancePct >= 0 ? 'above plan' : 'below plan'}
                </em>{' '}
                month-to-date
              </h3>
              <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
                Plan is the linear daily target derived from approved budgets. Actual is daily realized confirmed spend. Shaded band is variance — red where actual exceeds plan, green where under.
              </p>
            </header>
            <VarianceDivergenceChart
              dailyBurn={variance.dailyBurn}
              daysInMonth={variance.daysInMonth}
              todayDayIndex={variance.todayDayIndex}
              planTotalKes={variance.approvedBudgetTotalKes}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <header className="mb-4">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Variance drivers · {variance.monthLabel} MTD
              </p>
              <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                Top 7 by impact
              </h3>
              <p className="mt-1 text-[12px] text-[var(--warm-grey-3)]">
                Categories ranked by absolute KES contribution to net variance.
              </p>
            </header>
            <VarianceDriversList drivers={variance.drivers} limit={7} />
          </section>
        </div>

        <Tabs defaultValue="by-budget">
          <TabsList>
            <TabsTrigger value="by-budget">
              By budget
              <span className="ml-2 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] tabular-nums">
                {variance.byBudget.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="by-project">
              By project
              <span className="ml-2 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] tabular-nums">
                {variance.byProject.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="by-category">
              By category
              <span className="ml-2 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] tabular-nums">
                {variance.byCategory.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="drivers">
              Drivers
              <span className="ml-2 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full bg-danger-soft px-1 font-mono text-[10px] tabular-nums text-danger-soft-foreground">
                {variance.drivers.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: By Budget — bullet table per D1 */}
          <TabsContent value="by-budget" className="space-y-3 pt-4">
            <header className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  By budget · {variance.monthLabel} MTD
                </p>
                <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                  Plan vs <em className="not-italic italic text-[var(--gold-lo)]">actual</em> across active budgets
                </h3>
              </div>
            </header>

            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="grid grid-cols-[1.6fr_1fr_1fr_2fr_120px] items-center gap-5 border-b border-border bg-muted/40 px-6 py-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <span>Budget · scope</span>
                <span className="text-right">Plan</span>
                <span className="text-right">Actual MTD</span>
                <span>Burn vs plan</span>
                <span className="text-right">Variance</span>
              </div>
              {variance.loading ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  Loading…
                </div>
              ) : variance.byBudget.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No active budgets for {formatYearMonth(selectedMonth)}
                </div>
              ) : (
                variance.byBudget.map((row) => {
                  const isOver = row.varianceKes > 0;
                  const isUnder = row.varianceKes < 0 && Math.abs(row.variancePct) > 2;
                  const sign = row.varianceKes >= 0 ? '+ ' : '− ';
                  const subText = row.isOverTolerance
                    ? `${Math.round(row.actualKes / Math.max(row.planKes, 1) * 100)}% · over 5% tol`
                    : isUnder
                      ? `${Math.round(Math.abs(row.variancePct))}% · ahead`
                      : Math.abs(row.variancePct) < 1
                        ? 'on plan'
                        : `${Math.round(row.actualKes / Math.max(row.planKes, 1) * 100)}% · within tol`;
                  return (
                    <div
                      key={row.id}
                      className="grid grid-cols-[1.6fr_1fr_1fr_2fr_120px] items-center gap-5 border-b border-border-subtle px-6 py-4 last:border-b-0 hover:bg-[var(--paper-2)]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium leading-tight text-foreground">
                          {row.label}
                        </p>
                        <p className="mt-1 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                          {row.meta ?? '—'}
                        </p>
                      </div>
                      <span className="text-right font-mono text-[14px] tabular-nums text-foreground">
                        {formatCompactKES(row.planKes)}
                      </span>
                      <span
                        className={`text-right font-mono text-[14px] tabular-nums ${isOver ? 'text-[var(--danger)]' : 'text-foreground'}`}
                      >
                        {formatCompactKES(row.actualKes)}
                      </span>
                      <VarianceBullet
                        planKes={row.planKes}
                        actualKes={row.actualKes}
                        periodElapsedPct={variance.periodElapsedPct}
                      />
                      <div className="text-right">
                        <p
                          className={`font-mono text-[14px] tabular-nums ${
                            isOver
                              ? 'text-[var(--danger)]'
                              : isUnder
                                ? 'text-success-soft-foreground'
                                : 'text-foreground'
                          }`}
                        >
                          {sign}
                          {formatCompactKES(Math.abs(row.varianceKes)).replace('KES ', '')}
                        </p>
                        <p
                          className={`mt-1 font-mono text-[10.5px] uppercase tracking-[0.10em] ${
                            row.isOverTolerance
                              ? 'text-[var(--danger)]'
                              : isUnder
                                ? 'text-success-soft-foreground'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {subText}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* Tab 2: By Project — content unchanged from prior page (Commit 3 replaces) */}
          <TabsContent value="by-project" className="space-y-4 pt-4">
            <Card className="io-card">
              <CardContent className="p-0">
                {renderVarianceTable(byProject)}
              </CardContent>
            </Card>
            {byProject.length > 0 && renderBarChart(byProject)}
          </TabsContent>

          {/* Tab 3: By Category — content unchanged from prior page (Commit 3 replaces) */}
          <TabsContent value="by-category" className="space-y-4 pt-4">
            <Card className="io-card">
              <CardContent className="p-0">
                {renderVarianceTable(byCategory)}
              </CardContent>
            </Card>
            {byCategory.length > 0 && (
              <Card className="io-card">
                <CardContent className="p-4">
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={byCategory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(value) => [formatCurrency(Number(value), 'KES'), '']} />
                      <Legend />
                      <Bar dataKey="budgeted" name="Budgeted" stackId="a" fill={COLORS.budgeted} />
                      <Bar dataKey="actual" name="Actual" stackId="b" fill={COLORS.actual} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab 4: Drivers — expanded list */}
          <TabsContent value="drivers" className="space-y-3 pt-4">
            <header className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Variance drivers · {variance.monthLabel} MTD
                </p>
                <h3 className="mt-1 font-display text-[18px] font-medium leading-tight text-foreground">
                  All drivers, ranked
                </h3>
              </div>
            </header>
            <section className="rounded-lg border border-border bg-card p-6">
              <VarianceDriversList drivers={variance.drivers} />
            </section>
          </TabsContent>
        </Tabs>

        {/* Waterfall — plan to actual */}
        <section>
          <header className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Net variance · {variance.monthLabel} MTD
              </p>
              <h3 className="mt-1 font-display text-[20px] font-medium leading-tight text-foreground">
                How we got <em className="not-italic italic text-[var(--gold-lo)]">here</em> — plan to actual waterfall
              </h3>
            </div>
          </header>
          <VarianceWaterfall data={variance.waterfall} />
        </section>
      </div>
    </div>
  );
}
