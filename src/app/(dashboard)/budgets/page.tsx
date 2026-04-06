'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, getCurrentYearMonth, formatYearMonth, capitalize } from '@/lib/format';
import { Plus, Eye } from 'lucide-react';
import Link from 'next/link';

interface BudgetRow {
  id: string;
  year_month: string;
  current_version: number;
  project_name?: string;
  department_name?: string;
  latest_status: string;
  total_usd: number;
  total_kes: number;
  created_by_name: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-blue-100 text-blue-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function BudgetsPage() {
  const { user } = useUser();
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const { data } = await supabase
        .from('budgets')
        .select(`
          id, year_month, current_version, project_id, department_id,
          created_by,
          projects(name),
          departments(name),
          budget_versions(status, total_amount_usd, total_amount_kes, version_number)
        `)
        .eq('year_month', selectedMonth)
        .order('created_at', { ascending: false });

      const rows: BudgetRow[] = (data || []).map((b: Record<string, unknown>) => {
        const versions = (b.budget_versions as Record<string, unknown>[]) || [];
        const latest = versions.find((v: Record<string, unknown>) => v.version_number === b.current_version) || versions[0];
        return {
          id: b.id as string,
          year_month: b.year_month as string,
          current_version: b.current_version as number,
          project_name: (b.projects as Record<string, unknown>)?.name as string | undefined,
          department_name: (b.departments as Record<string, unknown>)?.name as string | undefined,
          latest_status: (latest?.status as string) || 'draft',
          total_usd: Number(latest?.total_amount_usd || 0),
          total_kes: Number(latest?.total_amount_kes || 0),
          created_by_name: b.created_by as string,
        };
      });

      setBudgets(rows);
      setLoading(false);
    }

    load();
  }, [selectedMonth]);

  const canCreate = user?.role === 'team_leader' || user?.role === 'project_manager' || user?.role === 'cfo';

  return (
    <div>
      <PageHeader title="Budgets" description="Manage project and department budgets">
        <Select value={selectedMonth} onValueChange={(v) => v && setSelectedMonth(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              return (
                <SelectItem key={ym} value={ym}>
                  {formatYearMonth(ym)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {canCreate && (
          <Link href="/budgets/new">
            <Button size="sm" className="gap-1">
              <Plus className="h-4 w-4" /> New Budget
            </Button>
          </Link>
        )}
      </PageHeader>

      <div className="p-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scope</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount (USD)</TableHead>
                  <TableHead className="text-right">Amount (KES)</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-neutral-500">
                      No budgets found for {formatYearMonth(selectedMonth)}
                    </TableCell>
                  </TableRow>
                ) : (
                  budgets.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {b.project_name || b.department_name || '—'}
                      </TableCell>
                      <TableCell>v{b.current_version}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColors[b.latest_status]}>
                          {capitalize(b.latest_status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(b.total_usd, 'USD')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatCurrency(b.total_kes, 'KES')}
                      </TableCell>
                      <TableCell>
                        <Link href={`/budgets/${b.id}`}>
                          <Button variant="ghost" size="icon">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
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
