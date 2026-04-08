'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { FileText, Users, Plus } from 'lucide-react';
import Link from 'next/link';
import { TlBudgetVsExpensesPanel } from '@/components/expenses/tl-budget-vs-expenses-panel';
import type { Project, Budget, BudgetVersion } from '@/types/database';

interface Props {
  userId: string;
}

export function TeamLeaderDashboard({ userId }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<(Budget & { latest_version?: BudgetVersion })[]>([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      // Get assigned projects
      const { data: assignments } = await supabase
        .from('user_project_assignments')
        .select('project_id')
        .eq('user_id', userId);

      const pids = (assignments || []).map((a: { project_id: string }) => a.project_id);
      setProjectIds(pids);

      if (pids.length > 0) {
        const [projectsRes, budgetsRes] = await Promise.all([
          supabase.from('projects').select('*').in('id', pids),
          supabase
            .from('budgets')
            .select('*, budget_versions(*)')
            .in('project_id', pids)
            .eq('year_month', currentMonth),
        ]);

        setProjects(projectsRes.data || []);
        setBudgets(budgetsRes.data || []);
      }

      setLoading(false);
    }

    loadData();
  }, [userId, currentMonth]);

  return (
    <div>
      <PageHeader
        title="My Projects"
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
            title="Assigned Projects"
            value={String(projects.length)}
            icon={FileText}
          />
          <StatCard
            title="Budgets This Month"
            value={String(budgets.length)}
            icon={Users}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">My Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-neutral-500 py-4 text-center">
                No projects assigned
              </p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="text-xs text-neutral-500">{project.client_name}</p>
                    </div>
                    <Badge variant={project.is_active ? 'default' : 'secondary'}>
                      {project.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Budget vs Confirmed Expenses — scoped to TL's projects */}
        <TlBudgetVsExpensesPanel projectIds={projectIds} />
      </div>
    </div>
  );
}
