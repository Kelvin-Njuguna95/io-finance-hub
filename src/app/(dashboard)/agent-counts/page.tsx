'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { getCurrentYearMonth, formatYearMonth, formatDateTime } from '@/lib/format';
import { Save, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface AgentRow {
  project_id: string;
  project_name: string;
  agent_count: number | null;
  is_locked: boolean;
  record_id: string | null;
  updated_at: string | null;
}

export default function AgentCountsPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [editValues, setEditValues] = useState<Record<string, number>>({});
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    load();
  }, [selectedMonth]);

  async function load() {
    const supabase = createClient();

    const { data: projects } = await supabase.from('projects').select('id, name').eq('is_active', true).order('name');
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
    const count = editValues[projectId];
    if (count === undefined || count < 0) return;

    const supabase = createClient();
    const existing = rows.find((r) => r.project_id === projectId);

    if (existing?.record_id) {
      const { error } = await supabase.from('agent_counts').update({
        agent_count: count,
        entered_by: user?.id,
      }).eq('id', existing.record_id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from('agent_counts').insert({
        project_id: projectId,
        year_month: selectedMonth,
        agent_count: count,
        entered_by: user?.id,
      });
      if (error) { toast.error(error.message); return; }
    }

    toast.success(`${rows.find(r => r.project_id === projectId)?.project_name} updated to ${count} agents`);
    load();
  }

  async function handleSaveAll() {
    setSavingAll(true);
    const supabase = createClient();
    let saved = 0;

    for (const row of rows) {
      if (row.is_locked) continue;
      const count = editValues[row.project_id];
      if (count === undefined || count < 0) continue;
      // Only save if changed
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

  return (
    <div>
      <PageHeader title="Agent Counts" description="Update the number of agents per project as staffing changes">
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
        {hasChanges && (
          <Button size="sm" onClick={handleSaveAll} disabled={savingAll} className="gap-1">
            <Save className="h-4 w-4" /> {savingAll ? 'Saving...' : 'Save All Changes'}
          </Button>
        )}
      </PageHeader>

      <div className="p-6">
        <div className="mb-4 flex items-center gap-4">
          <p className="text-sm text-neutral-500">
            Total agents across all projects: <strong className="text-neutral-900 text-base">{totalAgents}</strong>
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="w-[140px]">Agent Count</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const changed = editValues[r.project_id] !== undefined && editValues[r.project_id] !== r.agent_count;
                  return (
                    <TableRow key={r.project_id} className={changed ? 'bg-blue-50/50' : ''}>
                      <TableCell className="font-medium">{r.project_name}</TableCell>
                      <TableCell>
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
                          disabled={r.is_locked}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell>
                        {r.is_locked ? (
                          <span className="text-xs text-neutral-500">Locked</span>
                        ) : changed ? (
                          <span className="text-xs text-blue-600 font-medium">Unsaved</span>
                        ) : r.agent_count !== null ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle className="h-3 w-3" /> Set
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-600">Not set</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-neutral-400">
                        {r.updated_at ? formatDateTime(r.updated_at) : '—'}
                      </TableCell>
                      <TableCell>
                        {!r.is_locked && changed && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSave(r.project_id)}
                            title="Save this project"
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
