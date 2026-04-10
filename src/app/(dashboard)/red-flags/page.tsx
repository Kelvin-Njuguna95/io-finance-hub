'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, capitalize } from '@/lib/format';
import { Check } from 'lucide-react';
import type { RedFlag } from '@/types/database';
import { toast } from 'sonner';
import { getStatusBadgeClass } from '@/lib/status';
import { getRedFlags } from '@/lib/queries/red-flags';
import { canResolveRedFlags, canViewRedFlags } from '@/lib/permissions';

export default function RedFlagsPage() {
  const { user } = useUser();
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');
  const canView = canViewRedFlags(user?.role);
  const canResolve = canResolveRedFlags(user?.role);

  useEffect(() => { load(); }, [filter, user?.id, user?.role]);

  async function load() {
    if (!canView) {
      setFlags([]);
      return;
    }
    const supabase = createClient();
    const { data } = await getRedFlags(supabase, filter === 'resolved');

    if (user?.role === 'project_manager') {
      const { data: assigned } = await supabase.from('user_project_assignments').select('project_id').eq('user_id', user.id);
      const projectIds = new Set((assigned || []).map((a: /* // */ any) => a.project_id));
      setFlags((data || []).filter((flag) => flag.project_id && projectIds.has(flag.project_id)));
      return;
    }

    if (user?.role === 'accountant') {
      const financialTypes = new Set(['profit_share', 'budget_variance', 'forecast_variance']);
      setFlags((data || []).filter((flag) => !financialTypes.has(flag.flag_type)));
      return;
    }

    setFlags(data || []);
  }

  async function resolve(id: string) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('red_flags').update({
      is_resolved: true,
      resolved_by: user?.id,
      resolved_at: new Date().toISOString(),
    }).eq('id', id);
    toast.success('Flag resolved');
    load();
  }

  if (user && !canView) {
    return (
      <div>
        <PageHeader title="Red Flags" description="Access restricted" />
        <div className="p-6">
          <p className="text-sm text-muted-foreground">Your role does not have access to red flags.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Red Flags" description="Financial alerts requiring attention" />

      <div className="p-6 space-y-4">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as 'active' | 'resolved')}>
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>
        </Tabs>

        {flags.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No {filter} red flags
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {flags.map((flag) => (
              <Card key={flag.id}>
                <CardContent className="flex items-start justify-between p-4">
                  <div className="flex items-start gap-3">
                    <Badge variant="secondary" className={getStatusBadgeClass(flag.severity)}>
                      {flag.severity}
                    </Badge>
                    <div>
                      <p className="text-sm font-medium">{flag.title}</p>
                      {flag.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateTime(flag.created_at)}
                        {flag.year_month && ` · ${flag.year_month}`}
                      </p>
                    </div>
                  </div>
                  {!flag.is_resolved && canResolve && (
                    <Button variant="ghost" size="sm" onClick={() => resolve(flag.id)} className="gap-1">
                      <Check className="h-3 w-3" /> Resolve Flag
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
