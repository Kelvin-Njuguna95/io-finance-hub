'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getCurrentYearMonth, formatYearMonth, formatDateTime } from '@/lib/format';
import { Save, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getUserErrorMessage } from '@/lib/errors';
import { canManageAgentCounts } from '@/lib/permissions';

import { cn } from '@/lib/utils';

interface AgentRow {
  project_id: string;
  project_name: string;
  agent_count: number | null;
  is_locked: boolean;
  record_id: string | null;
  updated_at: string | null;
}

const ROW_GRID = 'grid grid-cols-[1.6fr_140px_120px_1fr_60px] items-center gap-4';

export default function AgentCountsPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [savingAll, setSavingAll] = useState(false);
  const canManage = canManageAgentCounts(user?.role);

  useEffect(() => {
    load();
  }, [selectedMonth]);

  async function load() {
    const supabase = createClient();

    let projectsQuery = supabase.from('projects').select('id, name').eq('is_active', true).order('name');
    if (user?.role === 'team_leader') {
      const { data: assignments } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', user.id);
      const assignedProjectIds = (assignments || []).map((a: /* // */ any) => a.project_id);
      projectsQuery = projectsQuery.in('id', assignedProjectIds.length > 0 ? assignedProjectIds : ['00000000-0000-0000-0000-000000000000']);
    }

    const { data: projects } = await projectsQuery;
    const { data: counts } = await supabase.from('agent_counts').select('*').eq('year_month', selectedMonth);

    type CountRow = { id: string; project_id: string; agent_count: number; is_locked: boolean; updated_at: string };
    const countMap = new Map((counts as CountRow[] || []).map((c) => [c.project_id, c]));
    const result: AgentRow[] = (projects || []).map((p: { id: string; name: string }) => {
      const c = countMap.get(p.id);
      return {
        project_id: p.id,
        project_name: p.name,
        agent_count: c?.agent_count ?? null,
        is_locked: c?.is_locked ?? false,
        record_id: c?.id ?? null,
        updated_at: c?.updated_at ?? null,
      };
    });

    setRows(result);
    const vals: Record<string, number> = {};
    result.forEach((r) => {
      if (r.agent_count !== null) vals[r.project_id] = r.agent_count;
    });
    setEditValues(vals);
  }

  async function handleSave(projectId: string) {
    if (!canManage) return;
    const count = editValues[projectId];
    if (count === undefined || count < 0) return;

    const supabase = createClient();
    const existing = rows.find((r) => r.project_id === projectId);

    if (existing?.record_id) {
      const { error } = await supabase.from('agent_counts').update({
        agent_count: count,
        entered_by: user?.id,
      }).eq('id', existing.record_id);
      if (error) { toast.error(getUserErrorMessage()); return; }
    } else {
      const { error } = await supabase.from('agent_counts').insert({
        project_id: projectId,
        year_month: selectedMonth,
        agent_count: count,
        entered_by: user?.id,
      });
      if (error) { toast.error(getUserErrorMessage()); return; }
    }

    toast.success(`${rows.find(r => r.project_id === projectId)?.project_name} updated to ${count} agents`);
    load();
  }

  async function handleSaveAll() {
    if (!canManage) return;
    setSavingAll(true);
    const supabase = createClient();
    let saved = 0;

    for (const row of rows) {
      if (row.is_locked) continue;
      const count = editValues[row.project_id];
      if (count === undefined || count < 0) continue;
      if (count === row.agent_count) continue;

      if (row.record_id) {
        await supabase.from('agent_counts').update({
          agent_count: count,
          entered_by: user?.id,
        }).eq('id', row.record_id);
      } else {
        await supabase.from('agent_counts').insert({
          project_id: row.project_id,
          year_month: selectedMonth,
          agent_count: count,
          entered_by: user?.id,
        });
      }
      saved++;
    }

    if (saved > 0) {
      toast.success(`Updated ${saved} project(s)`);
      load();
    } else {
      toast.info('No changes to save');
    }
    setSavingAll(false);
  }

  const totalAgents = Object.values(editValues).reduce((s: number, v: number) => s + (v || 0), 0);
  const hasChanges = rows.some(r => {
    const current = editValues[r.project_id];
    return current !== undefined && current !== r.agent_count && !r.is_locked;
  });

  if (user && !canManage) {
    return (
      <div className="p-6">
        <PageTitle primary="Agent" accent="counts" subtitle="Access restricted" />
        <div className="mt-6 rounded-[var(--radius-lg)] border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Only CFO, Accountant, and Team Leader roles can manage agent counts.
        </div>
      </div>
    );
  }

  const monthSelect = (
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
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {monthSelect}
      {canManage && hasChanges && (
        <Button size="sm" onClick={handleSaveAll} disabled={savingAll} className="gap-1">
          <Save className="h-4 w-4" /> {savingAll ? 'Saving...' : 'Save All Changes'}
        </Button>
      )}
    </div>
  );

  const subtitle = `${formatYearMonth(selectedMonth)} · ${totalAgents} agent${totalAgents === 1 ? '' : 's'} across ${rows.length} project${rows.length === 1 ? '' : 's'}`;

  return (
    <div className="p-6">
      <PageTitle
        primary="Agent"
        accent="counts"
        subtitle={subtitle}
        action={headerActions}
      />

      <div className="mt-6">
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {/* List head */}
          <div
            className={cn(
              ROW_GRID,
              'border-b border-border bg-[var(--paper-2)] px-5 py-3',
              'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
            )}
          >
            <div>Project</div>
            <div>Agent count</div>
            <div>Status</div>
            <div>Last updated</div>
            <div />
          </div>

          {/* Rows */}
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No projects available for {formatYearMonth(selectedMonth)}.
            </div>
          ) : (
            rows.map((r) => {
              const changed = editValues[r.project_id] !== undefined && editValues[r.project_id] !== r.agent_count;
              return (
                <div
                  key={r.project_id}
                  className={cn(
                    ROW_GRID,
                    'border-b border-border-subtle px-5 py-3.5 transition-colors last:border-b-0',
                    changed && 'bg-info-soft/30',
                  )}
                >
                  {/* Project */}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-foreground">
                      {r.project_name}
                    </div>
                  </div>

                  {/* Agent count input */}
                  <div>
                    <Input
                      type="number"
                      min={0}
                      value={editValues[r.project_id] ?? ''}
                      onChange={(e) =>
                        setEditValues((v) => ({
                          ...v,
                          [r.project_id]: parseInt(e.target.value) || 0,
                        }))
                      }
                      disabled={r.is_locked || !canManage}
                      className="h-8 w-24 font-mono tabular-nums"
                    />
                  </div>

                  {/* Status */}
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.10em]">
                    {r.is_locked ? (
                      <span className="text-muted-foreground">Locked</span>
                    ) : changed ? (
                      <span className="text-info-soft-foreground">Unsaved</span>
                    ) : r.agent_count !== null ? (
                      <span className="inline-flex items-center gap-1 text-success-soft-foreground">
                        <CheckCircle className="size-3" /> Set
                      </span>
                    ) : (
                      <span className="text-warning-soft-foreground">Not set</span>
                    )}
                  </div>

                  {/* Last updated */}
                  <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {r.updated_at ? formatDateTime(r.updated_at) : '—'}
                  </div>

                  {/* Per-row save action */}
                  <div className="flex justify-end">
                    {!r.is_locked && changed && canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => handleSave(r.project_id)}
                        title="Save this project"
                      >
                        <Save className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Footer total */}
          {rows.length > 0 && (
            <div
              className={cn(
                ROW_GRID,
                'border-t border-border bg-[var(--paper-2)] px-5 py-3',
                'font-mono text-[11px] uppercase tracking-[0.14em]',
              )}
            >
              <div className="text-muted-foreground">Total · {rows.length} project{rows.length === 1 ? '' : 's'}</div>
              <div className="text-[14px] tabular-nums text-foreground">{totalAgents}</div>
              <div />
              <div />
              <div />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
