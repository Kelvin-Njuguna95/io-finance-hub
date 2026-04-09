'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
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

export default function RedFlagsPage() {
  const [flags, setFlags] = useState<RedFlag[]>([]);
  const [filter, setFilter] = useState<'active' | 'resolved'>('active');

  useEffect(() => { load(); }, [filter]);

  async function load() {
    const supabase = createClient();
    const { data } = await getRedFlags(supabase, filter === 'resolved');
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
            <CardContent className="py-8 text-center text-sm text-neutral-500">
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
                        <p className="text-xs text-neutral-500 mt-0.5">{flag.description}</p>
                      )}
                      <p className="text-xs text-neutral-400 mt-1">
                        {formatDateTime(flag.created_at)}
                        {flag.year_month && ` · ${flag.year_month}`}
                      </p>
                    </div>
                  </div>
                  {!flag.is_resolved && (
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
