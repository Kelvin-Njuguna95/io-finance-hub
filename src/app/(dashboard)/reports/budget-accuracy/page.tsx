'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getMonthRange, shortMonth, formatKesShort, CHART_COLORS, getProjectColor } from '@/lib/report-utils';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { Target, TrendingUp, AlertTriangle } from 'lucide-react';

interface AccuracyRow {
  month: string;
  project: string;
  budgeted: number;
  actual: number;
  variance: number;
  accuracy: number;
}

interface TrendPoint {
  label: string;
  [project: string]: number | string;
}

interface FreqData {
  project: string;
  overBudget: number;
  underBudget: number;
  onTarget: number;
}

export default function BudgetAccuracyPage() {
  const [rangeMonths, setRangeMonths] = useState(6);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [freqData, setFreqData] = useState<FreqData[]>([]);
  const [userRole, setUserRole] = useState('');

  const months = useMemo(() => getMonthRange(rangeMonths), [rangeMonths]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      let assignedProjects: string[] = [];
      let role = '';
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
        role = profile?.role || '';
        setUserRole(role);
        if (role === 'team_leader' || role === 'project_manager') {
          const { data: assigns } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', user.id);
          assignedProjects = (assigns || []).map((a: any) => a.project_id);
        }
      }
      const isRestricted = role === 'team_leader' || role === 'project_manager';

      const [projRes, budRes, expRes] = await Promise.all([
        supabase.from('projects').select('id, name').eq('is_active', true),
        supabase.from('budgets').select('id, project_id, year_month, pm_approved_total, budget_versions(total_amount_kes, status)').in('year_month', months),
        supabase.from('expenses').select('project_id, amount_kes, year_month').in('year_month', months).eq('expense_type', 'project_expense'),
      ]);

      const projects = (projRes.data || []).filter(p => !isRestricted || assignedProjects.includes(p.id));
      const budgets = (budRes.data || []).filter((b: any) => !isRestricted || assignedProjects.includes(b.project_id));
      const expenses = (expRes.data || []).filter((e: any) => !isRestricted || assignedProjects.includes(e.project_id));
      const projMap = new Map(projects.map(p => [p.id, p.name]));
      const projNameSet = new Set<string>();

      // Build expense by project+month
      const expByPM = new Map<string, number>();
      expenses.forEach((e: any) => {
        const key = `${e.project_id}|${e.year_month}`;
        expByPM.set(key, (expByPM.get(key) || 0) + Number(e.amount_kes));
      });

      // Build accuracy rows
      const allRows: AccuracyRow[] = [];
      const freqMap = new Map<string, { over: number; under: number; on: number }>();

      budgets.forEach((b: any) => {
        if (!b.project_id || !projMap.has(b.project_id)) return;
        const projName = projMap.get(b.project_id)!;
        projNameSet.add(projName);

        const approved = (b.budget_versions || []).find((v: any) => v.status === 'approved');
        const budgeted = b.pm_approved_total ? Number(b.pm_approved_total) : Number(approved?.total_amount_kes || 0);
        if (budgeted === 0) return;

        const actual = expByPM.get(`${b.project_id}|${b.year_month}`) || 0;
        const variance = actual - budgeted;
        const accuracy = Math.max(0, (1 - Math.abs(variance) / budgeted) * 100);

        allRows.push({ month: b.year_month, project: projName, budgeted, actual, variance, accuracy });

        // Frequency
        const freq = freqMap.get(projName) || { over: 0, under: 0, on: 0 };
        const variancePct = (variance / budgeted) * 100;
        if (variancePct > 5) freq.over++;
        else if (variancePct < -5) freq.under++;
        else freq.on++;
        freqMap.set(projName, freq);
      });

      allRows.sort((a, b) => b.month.localeCompare(a.month) || a.project.localeCompare(b.project));
      setRows(allRows);
      setProjectNames(Array.from(projNameSet));

      // Build trend data
      const trend: TrendPoint[] = months.map(m => {
        const pt: TrendPoint = { label: shortMonth(m) };
        projNameSet.forEach(name => {
          const row = allRows.find(r => r.month === m && r.project === name);
          pt[name] = row?.accuracy ?? 0;
        });
        return pt;
      });
      setTrendData(trend);

      // Freq data
      setFreqData(Array.from(freqMap.entries()).map(([project, f]) => ({
        project,
        overBudget: f.over,
        underBudget: f.under,
        onTarget: f.on,
      })));

      setLoading(false);
    }
    load();
  }, [rangeMonths]);

  const avgAccuracy = rows.length > 0 ? rows.reduce((s, r) => s + r.accuracy, 0) / rows.length : 0;
  const bestProject = rows.length > 0
    ? projectNames.reduce((best, name) => {
        const projRows = rows.filter(r => r.project === name);
        const avg = projRows.length > 0 ? projRows.reduce((s, r) => s + r.accuracy, 0) / projRows.length : 0;
        return avg > (best.avg || 0) ? { name, avg } : best;
      }, { name: '', avg: 0 })
    : { name: '-', avg: 0 };

  return (
    <div>
      <PageHeader title="Budget Accuracy" description="Budget forecasting accuracy tracking">
        <Select value={String(rangeMonths)} onValueChange={(v) => v && setRangeMonths(Number(v))}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Last 3 Months</SelectItem>
            <SelectItem value="6">Last 6 Months</SelectItem>
            <SelectItem value="12">Last 12 Months</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard title="Avg Accuracy" value={formatPercent(avgAccuracy)} subtitle={avgAccuracy >= 90 ? 'On target' : 'Below 90% target'} icon={Target} />
          <StatCard title="Best Forecaster" value={bestProject.name} subtitle={`${formatPercent(bestProject.avg)} avg accuracy`} icon={TrendingUp} />
          <StatCard title="Data Points" value={String(rows.length)} subtitle={`Across ${rangeMonths} months`} icon={AlertTriangle} />
        </div>

        {/* Accuracy Table */}
        <Card className="io-card">
          <CardHeader><CardTitle className="text-base">Accuracy by Project & Month</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Budgeted (KES)</TableHead>
                  <TableHead className="text-right">Actual (KES)</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="text-right">Accuracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-neutral-400">Loading...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-neutral-500">No budget data available</TableCell></TableRow>
                ) : rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{formatYearMonth(r.month)}</TableCell>
                    <TableCell className="font-medium">{r.project}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.budgeted, 'KES')}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.actual, 'KES')}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${r.variance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {r.variance > 0 ? '+' : ''}{formatCurrency(r.variance, 'KES')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={
                        r.accuracy >= 90 ? 'bg-emerald-100 text-emerald-700' :
                        r.accuracy >= 75 ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }>
                        {formatPercent(r.accuracy)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Accuracy Trend Chart */}
        {!loading && trendData.length > 0 && (
          <Card className="io-card">
            <CardHeader><CardTitle className="text-base">Accuracy Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                  <Legend />
                  <ReferenceLine y={90} stroke={CHART_COLORS.emerald} strokeDasharray="6 3" label={{ value: '90% Target', position: 'right', fontSize: 10 }} />
                  {projectNames.map(name => (
                    <Line key={name} type="monotone" dataKey={name} stroke={getProjectColor(name)} strokeWidth={2} dot={{ r: 4 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Over/Under Budget Frequency */}
        {!loading && freqData.length > 0 && (
          <Card className="io-card">
            <CardHeader><CardTitle className="text-base">Over vs Under Budget Frequency</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={freqData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="project" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="overBudget" name="Over Budget" fill={CHART_COLORS.red} stackId="freq" />
                  <Bar dataKey="onTarget" name="On Target (±5%)" fill={CHART_COLORS.emerald} stackId="freq" />
                  <Bar dataKey="underBudget" name="Under Budget" fill={CHART_COLORS.teal} stackId="freq" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
