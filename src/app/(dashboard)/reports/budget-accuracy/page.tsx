'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExecutiveInsightPanel, ExecutiveKpiCard, formatExecutivePercent } from '@/components/reports/executive-kit';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { getMonthRange, shortMonth, formatKesShort, CHART_COLORS, getProjectColor } from '@/lib/report-utils';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { FileDown } from 'lucide-react';
import { exportSimpleReportPdf } from '@/lib/pdf-export';

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
          assignedProjects = (assigns || []).map((a: /* // */ any) => a.project_id);
        }
      }
      const isRestricted = role === 'team_leader' || role === 'project_manager';

      const [projRes, varianceRes] = await Promise.all([
        supabase.from('projects').select('id, name').eq('is_active', true),
        supabase.from('variance_summary_by_project').select('project_id, project_name, year_month, budget_kes, actual_kes, variance_kes').in('year_month', months),
      ]);

      const projects = (projRes.data || []).filter(p => !isRestricted || assignedProjects.includes(p.id));
      const variances = (varianceRes.data || []).filter((v: { project_id: string }) => !isRestricted || assignedProjects.includes(v.project_id));
      const projMap = new Map<string, string>(projects.map((p: { id: string; name: string }) => [p.id, p.name]));
      const projNameSet = new Set<string>();

      // Build accuracy rows
      const allRows: AccuracyRow[] = [];
      const freqMap = new Map<string, { over: number; under: number; on: number }>();

      variances.forEach((b: { project_id: string; project_name: string; year_month: string; budget_kes: number | null; actual_kes: number | null }) => {
        if (!b.project_id || !projMap.has(b.project_id)) return;
        const projName = b.project_name || projMap.get(b.project_id)!;
        projNameSet.add(projName);
        const budgeted = Number(b.budget_kes || 0);
        if (budgeted === 0) return;
        const actual = Number(b.actual_kes || 0);
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

  async function exportPdf() {
    await exportSimpleReportPdf(
      'Budget Accuracy Report',
      `${rangeMonths}-month window`,
      rows.slice(0, 120).map((r) => `${r.month} | ${r.project} | budget ${r.budgeted.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | actual ${r.actual.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | accuracy ${r.accuracy.toFixed(1)}%`),
      `IO_Budget_Accuracy_${rangeMonths}m.pdf`,
    );
  }

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
        <Button variant="outline" size="sm" onClick={exportPdf}>
          <FileDown className="h-4 w-4 mr-1" /> Export PDF
        </Button>
      </PageHeader>

      <div className="p-6 space-y-6">
        <ExecutiveInsightPanel lines={[
          `Forecast accuracy is ${formatExecutivePercent(avgAccuracy)} — ${Math.abs(avgAccuracy - 90).toFixed(1)} pts above the 90% governance threshold.`,
          `${rows.filter((r) => r.accuracy < 75).length} points need immediate forecast review.`,
          `Best forecaster is ${bestProject.name || 'N/A'}.`,
        ]} />

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ExecutiveKpiCard label="Avg Accuracy" value={formatExecutivePercent(avgAccuracy)} trend={avgAccuracy >= 90 ? 'Above Target' : 'Below Target'} positive={avgAccuracy >= 90} />
          <ExecutiveKpiCard label="Best Forecaster" value={bestProject.name || 'N/A'} trend={formatExecutivePercent(bestProject.avg)} />
          <ExecutiveKpiCard label="Data Points" value={`${rows.length}`} trend={`${rangeMonths} month window`} />
          <ExecutiveKpiCard label="Target" value="90%" trend="Governance threshold" />
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
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Please wait</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No budget data available</TableCell></TableRow>
                ) : rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{formatYearMonth(r.month)}</TableCell>
                    <TableCell className="font-medium">{r.project}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.budgeted, 'KES')}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(r.actual, 'KES')}</TableCell>
                    <TableCell className={`text-right font-mono text-sm ${r.variance > 0 ? 'text-danger-soft-foreground' : 'text-success-soft-foreground'}`}>
                      {r.variance > 0 ? '+' : ''}{formatCurrency(r.variance, 'KES')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className={
                        r.accuracy >= 90 ? 'bg-success-soft text-success-soft-foreground' :
                        r.accuracy >= 75 ? 'bg-warning-soft text-warning-soft-foreground' :
                        'bg-danger-soft text-danger-soft-foreground'
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
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.80 0 0 / 0.15)" />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.80 0 0 / 0.15)" />
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
