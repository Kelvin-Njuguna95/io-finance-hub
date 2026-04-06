'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercent, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import type { ProjectProfitability } from '@/types/database';

export default function ProfitabilityPage() {
  const [data, setData] = useState<(ProjectProfitability & { project_name?: string })[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from('project_profitability')
        .select('*, projects(name)')
        .eq('year_month', selectedMonth)
        .order('distributable_profit_usd', { ascending: false });

      setData(
        (rows || []).map((r: Record<string, unknown>) => ({
          ...r,
          project_name: (r.projects as Record<string, unknown>)?.name as string | undefined,
        })) as (ProjectProfitability & { project_name?: string })[]
      );
    }
    load();
  }, [selectedMonth]);

  return (
    <div>
      <PageHeader title="Project Profitability" description="Per-project P&L breakdown">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date(); d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return <SelectItem key={ym} value={ym}>{formatYearMonth(ym)}</SelectItem>;
            })}
          </SelectContent>
        </Select>
      </PageHeader>

      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Direct Costs</TableHead>
                  <TableHead className="text-right">Overhead</TableHead>
                  <TableHead className="text-right">Distributable</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-neutral-500">
                      No profitability data for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.project_name}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(r.revenue_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-600">
                        {formatCurrency(r.direct_expenses_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-red-600">
                        {formatCurrency(r.allocated_overhead_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {formatCurrency(r.distributable_profit_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatPercent(r.margin_pct)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
