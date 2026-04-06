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
import { getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

interface AgentRow {
  project_id: string;
  project_name: string;
  agent_count: number | null;
  is_locked: boolean;
  record_id: string | null;
}

export default function AgentCountsPage() {
  const { user } = useUser();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentYearMonth());
  const [editValues, setEditValues] = useState<Record<string, number>>({});

  useEffect(() => {
    load();
  }, [selectedMonth]);

  async function load() {
    const supabase = createClient();

    // Get projects the user can see
    const { data: projects } = await supabase.from('projects').select('id, name').eq('is_active', true);
    const { data: counts } = await supabase.from('agent_counts').select('*').eq('year_month', selectedMonth);

    const countMap = new Map((counts || []).map((c) => [c.project_id, c]));
    const result: AgentRow[] = (projects || []).map((p) => {
      const c = countMap.get(p.id);
      return {
        project_id: p.id,
        project_name: p.name,
        agent_count: c?.agent_count ?? null,
        is_locked: c?.is_locked ?? false,
        record_id: c?.id ?? null,
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
      await supabase.from('agent_counts').update({
        agent_count: count,
        entered_by: user?.id,
      }).eq('id', existing.record_id);
    } else {
      await supabase.from('agent_counts').insert({
        project_id: projectId,
        year_month: selectedMonth,
        agent_count: count,
        entered_by: user?.id,
      });
    }

    toast.success('Agent count saved');
    load();
  }

  const totalAgents = Object.values(editValues).reduce((s, v) => s + (v || 0), 0);

  return (
    <div>
      <PageHeader title="Agent Counts" description="Per-project agent counts for overhead allocation">
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
        <p className="mb-4 text-sm text-neutral-500">
          Total agents: <strong>{totalAgents}</strong>
        </p>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="w-[150px]">Agent Count</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.project_id}>
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
                      ) : r.agent_count !== null ? (
                        <span className="text-xs text-green-600">Set</span>
                      ) : (
                        <span className="text-xs text-yellow-600">Missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {!r.is_locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSave(r.project_id)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
