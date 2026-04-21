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
import { cn } from '@/lib/utils';
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { TlBudgetVsExpensesPanel } from '@/components/expenses/tl-budget-vs-expenses-panel';
import type { Project, Budget, BudgetVersion } from '@/types/database';

type HealthBand = 'healthy' | 'watch' | 'at_risk';

type HealthScoreRow = {
  project_id: string;
  score_band: HealthBand | string;
};

/**
 * Server-computed health-band visual mapping (see
 * project_health_scores.score_band in supabase/migrations/00016). Band
 * values are 'healthy' | 'watch' | 'at_risk'; no threshold logic runs
 * here — the server computes the band.
 *
 * Register per .impeccable.md: "normal is silent; abnormal tints."
 * Healthy intentionally uses neutral muted tone so a routine project
 * doesn't draw the eye. Only watch/at_risk light up.
 */
const HEALTH_BADGE: Record<HealthBand, { label: string; className: string }> = {
  healthy: {
    label: 'Healthy',
    className: 'bg-muted text-muted-foreground',
  },
  watch: {
    label: 'Watch',
    className: 'bg-warning-soft text-warning-soft-foreground',
  },
  at_risk: {
    label: 'At risk',
    className: 'bg-danger-soft text-danger-soft-foreground',
  },
};

interface Props {
  userId: string;
}

export function TeamLeaderDashboard({ userId }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [budgets, setBudgets] = useState<
    (Budget & { latest_version?: BudgetVersion })[]
  >([]);
  const [healthByProject, setHealthByProject] = useState<
    Record<string, HealthBand>
  >({});
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
        const periodMonth = `${currentMonth}-01`;
        const [projectsRes, budgetsRes, healthRes] = await Promise.all([
          supabase.from('projects').select('*').in('id', pids),
          supabase
            .from('budgets')
            .select('*, budget_versions(*)')
            .in('project_id', pids)
            .eq('year_month', currentMonth),
          // Per /shape Q2 edge-case approval: reading an existing
          // populated table is UI wiring, not data-layer work. Same
          // query shape as cfo-dashboard.tsx uses; scoped to PM's pids.
          supabase
            .from('project_health_scores')
            .select('project_id, score_band')
            .in('project_id', pids)
            .eq('period_month', periodMonth),
        ]);

        setProjects(projectsRes.data || []);
        setBudgets(budgetsRes.data || []);

        const healthMap: Record<string, HealthBand> = {};
        ((healthRes.data || []) as HealthScoreRow[]).forEach((row) => {
          if (
            row.score_band === 'healthy' ||
            row.score_band === 'watch' ||
            row.score_band === 'at_risk'
          ) {
            healthMap[row.project_id] = row.score_band;
          }
        });
        setHealthByProject(healthMap);
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
              {projects.map((project) => {
                const band = healthByProject[project.id];
                const badge = band ? HEALTH_BADGE[band] : null;
                return (
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
                    {badge ? (
                      <Badge
                        variant="secondary"
                        className={cn('shrink-0', badge.className)}
                      >
                        {badge.label}
                      </Badge>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground tabular-nums"
                        aria-label="No health score computed for this period"
                      >
                        —
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* Budget vs Confirmed Expenses — scoped to TL's projects */}
        <TlBudgetVsExpensesPanel projectIds={projectIds} />
      </div>
    </div>
  );
}
