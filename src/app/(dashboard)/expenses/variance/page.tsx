'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
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
  budgeted: '#6366f1',
  actual: '#f59e0b',
  overspend: '#ef4444',
  underspend: '#22c55e',
  onTarget: '#6366f1',
};

const PIE_COLORS = ['#ef4444', '#22c55e', '#6366f1'];

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
    const key = keyFn(item) || 'Uncategorized';
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

export default function VarianceDashboardPage() {
  const { user } = useUser();
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);

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

  // Load accuracy trend (last 6 months)
  useEffect(() => {
    async function loadTrend() {
      const supabase = createClient();
      const trendMonths = Array.from({ length: 6 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }).reverse();

      const results: TrendPoint[] = [];

      for (const m of trendMonths) {
        const { data } = await supabase
          .from('pending_expenses')
          .select('budgeted_amount_kes, actual_amount_kes')
          .eq('year_month', m);

        const totalBudgeted = (data || []).reduce((s, r) => s + Number(r.budgeted_amount_kes), 0);
        const totalActual = (data || []).reduce((s, r) => s + Number(r.actual_amount_kes || 0), 0);
        const pct = totalBudgeted === 0 ? 0 : ((totalActual - totalBudgeted) / totalBudgeted) * 100;

        results.push({
          month: m,
          label: formatYearMonth(m),
          accuracyScore: Math.round(calcAccuracy(pct) * 100) / 100,
        });
      }

      setTrendData(results);
    }
    loadTrend();
  }, []);

  // Aggregations
  const byProject = aggregateBy(items, (i) => i.projects?.name ?? null);
  const byDepartment = aggregateBy(items, (i) => i.departments?.name ?? null);
  const byCategory = aggregateBy(items, (i) => i.category);

  // Company overview
  const totalBudgeted = items.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
  const totalActual = items.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const netVariance = totalActual - totalBudgeted;
  const overallPct = totalBudgeted === 0 ? 0 : (netVariance / totalBudgeted) * 100;
  const avgAccuracy = byProject.length > 0
    ? byProject.reduce((s, r) => s + r.accuracyScore, 0) / byProject.length
    : 0;
  const totalPending = items.filter((i) => i.status !== 'confirmed' && i.status !== 'voided').length;
  const totalVoided = items.filter((i) => i.status === 'voided').length;

  // Waterfall data for company overview
  const overspendTotal = Math.max(0, netVariance);
  const underspendTotal = Math.max(0, -netVariance);
  const waterfallData = [
    { name: 'Budgeted', value: totalBudgeted, fill: COLORS.budgeted },
    { name: 'Overspend', value: overspendTotal, fill: COLORS.overspend },
    { name: 'Underspend', value: underspendTotal, fill: COLORS.underspend },
    { name: 'Actual', value: totalActual, fill: COLORS.actual },
  ];

  // Variance type distribution for PieChart
  const overspendCount = items.filter((i) => {
    const pct = Number(i.variance_pct);
    return pct > 5;
  }).length;
  const underspendCount = items.filter((i) => {
    const pct = Number(i.variance_pct);
    return pct < -5;
  }).length;
  const onTargetCount = items.length - overspendCount - underspendCount;
  const pieData = [
    { name: 'Overspend', value: overspendCount },
    { name: 'Underspend', value: underspendCount },
    { name: 'On Target', value: onTargetCount },
  ].filter((d) => d.value > 0);

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
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
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

  return (
    <div>
      <PageHeader title="Variance Dashboard" description="Budget vs actual expense variance analysis">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((ym) => (
              <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {user?.role === 'cfo' && (
          <Button onClick={handleRecompute} disabled={recomputing} variant="outline">
            {recomputing ? 'Recomputing...' : 'Recompute Variances'}
          </Button>
        )}
      </PageHeader>

      <div className="p-6">
        <Tabs defaultValue="by-project">
          <TabsList>
            <TabsTrigger value="by-project">By Project</TabsTrigger>
            <TabsTrigger value="by-department">By Department</TabsTrigger>
            <TabsTrigger value="company">Company Overview</TabsTrigger>
            <TabsTrigger value="by-category">By Category</TabsTrigger>
          </TabsList>

          {/* Tab 1: By Project */}
          <TabsContent value="by-project" className="space-y-4">
            <Card className="io-card">
              <CardContent className="p-0">
                {renderVarianceTable(byProject)}
              </CardContent>
            </Card>
            {byProject.length > 0 && renderBarChart(byProject)}
          </TabsContent>

          {/* Tab 2: By Department */}
          <TabsContent value="by-department" className="space-y-4">
            <Card className="io-card">
              <CardContent className="p-0">
                {renderVarianceTable(byDepartment)}
              </CardContent>
            </Card>
            {byDepartment.length > 0 && renderBarChart(byDepartment)}
          </TabsContent>

          {/* Tab 3: Company Overview */}
          <TabsContent value="company" className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Budgeted</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold font-mono">{formatCurrency(totalBudgeted, 'KES')}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Actual</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold font-mono">{formatCurrency(totalActual, 'KES')}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Net Variance</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-lg font-semibold font-mono ${netVariance > 0 ? 'text-danger-soft-foreground' : netVariance < 0 ? 'text-success-soft-foreground' : ''}`}>
                    {formatCurrency(netVariance, 'KES')}
                  </p>
                  <p className="text-xs text-muted-foreground">{overallPct.toFixed(1)}%</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Avg Accuracy</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold font-mono">{avgAccuracy.toFixed(1)}%</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Items Pending</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold font-mono text-warning-soft-foreground">{totalPending}</p>
                </CardContent>
              </Card>
              <Card className="io-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Items Voided</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold font-mono text-danger-soft-foreground">{totalVoided}</p>
                </CardContent>
              </Card>
            </div>

            {/* Waterfall chart */}
            <Card className="io-card">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Variance Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={waterfallData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" width={100} />
                    <Tooltip formatter={(value) => [formatCurrency(Number(value), 'KES'), 'Amount']} />
                    <Bar dataKey="value" name="Amount">
                      {waterfallData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Accuracy Trend */}
              <Card className="io-card">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Accuracy Trend (Last 6 Months)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Accuracy']} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="accuracyScore"
                        name="Accuracy Score"
                        stroke={COLORS.budgeted}
                        strokeWidth={2}
                        dot={{ fill: COLORS.budgeted, r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Variance Type Distribution */}
              <Card className="io-card">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Variance Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {pieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          dataKey="value"
                          nameKey="name"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {pieData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-12">No items for this month</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tab 4: By Category */}
          <TabsContent value="by-category" className="space-y-4">
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
        </Tabs>
      </div>
    </div>
  );
}
