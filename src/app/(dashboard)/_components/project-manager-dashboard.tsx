'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { Building2, FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Department } from '@/types/database';

interface Props {
  userId: string;
}

export function ProjectManagerDashboard({ userId }: Props) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [budgetCount, setBudgetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const { data: assignments } = await supabase
        .from('user_department_assignments')
        .select('department_id')
        .eq('user_id', userId);

      const deptIds = (assignments || []).map((a) => a.department_id);

      if (deptIds.length > 0) {
        const [deptsRes, budgetsRes] = await Promise.all([
          supabase.from('departments').select('*').in('id', deptIds),
          supabase
            .from('budgets')
            .select('id', { count: 'exact', head: true })
            .in('department_id', deptIds)
            .eq('year_month', currentMonth),
        ]);

        setDepartments(deptsRes.data || []);
        setBudgetCount(budgetsRes.count || 0);
      }

      setLoading(false);
    }

    loadData();
  }, [userId, currentMonth]);

  return (
    <div>
      <PageHeader
        title="My Departments"
        description={formatYearMonth(currentMonth)}
      >
        <Link href="/budgets/new">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" /> New Budget
          </Button>
        </Link>
      </PageHeader>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            title="Assigned Departments"
            value={String(departments.length)}
            icon={Building2}
          />
          <StatCard
            title="Budgets This Month"
            value={String(budgetCount)}
            icon={FileText}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Departments</CardTitle>
          </CardHeader>
          <CardContent>
            {departments.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">
                No departments assigned
              </p>
            ) : (
              <div className="space-y-2">
                {departments.map((dept) => (
                  <div
                    key={dept.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <p className="text-sm font-medium">{dept.name}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
