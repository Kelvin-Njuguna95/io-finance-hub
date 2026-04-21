'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, FileText, Plus, Users } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/layout/stat-card';
import { SectionCard } from '@/components/layout/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { TlBudgetVsExpensesPanel } from '@/components/expenses/tl-budget-vs-expenses-panel';
import type { Project, Budget, BudgetVersion } from '@/types/database';

interface Props {
  userId: string;
}

export function TeamLeaderDashboard({ userId }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<
    (Budget & { latest_version?: BudgetVersion })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const { data: assignments } = await supabase
        .from('user_project_assignments')
        .select('project_id')
        .eq('user_id', userId);

      const pids = (assignments || []).map(
        (a: { project_id: string }) => a.project_id,
      );
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
        eyebrow="Team Lead"
        description={formatYearMonth(currentMonth)}
        icon={Briefcase}
        tone="brand"
      >
        <Link href="/budgets/new">
          <Button size="sm" className="gap-1">
            <Plus className="size-4" aria-hidden />
            New Budget
          </Button>
        </Link>
      </PageHeader>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatCard
            title="Assigned Projects"
            value={String(projects.length)}
            icon={Briefcase}
            tone="brand"
            loading={loading}
          />
          <StatCard
            title="Budgets This Month"
            value={String(budgets.length)}
            icon={FileText}
            tone="brand"
            loading={loading}
          />
        </div>

        <SectionCard title="My Projects" icon={Users} tone="info">
          {projects.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              tone="neutral"
              title="No projects assigned"
              description="Ask an admin to assign you to a project."
            />
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {project.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {project.client_name}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      project.is_active
                        ? 'bg-success-soft text-success-soft-foreground'
                        : 'bg-muted text-muted-foreground'
                    }
                  >
                    {project.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Budget vs Confirmed Expenses — scoped to TL's projects */}
        <TlBudgetVsExpensesPanel projectIds={projectIds} />
      </div>
    </div>
  );
}
