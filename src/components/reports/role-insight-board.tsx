'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

interface RoleInsight {
  role: string;
  headline: string;
  items: string[];
}

export function RoleInsightBoard({ title = 'Role-Based Insights', insights }: { title?: string; insights: RoleInsight[] }) {
  const [userRole, setUserRole] = useState('');

  useEffect(() => {
    let mounted = true;
    async function loadRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) {
        if (mounted) setUserRole('');
        return;
      }
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
      if (mounted) setUserRole(profile?.role || '');
    }
    loadRole();
    return () => { mounted = false; };
  }, []);

  const normalizeRole = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const normalizedUserRole = normalizeRole(userRole);

  const filteredInsights = useMemo(() => {
    if (!insights.length) return [];

    const roleAliases: Record<string, string[]> = {
      project_manager: ['pm'],
      pm: ['pm'],
      team_leader: ['team_lead'],
      team_lead: ['team_lead'],
      tl: ['team_lead'],
      accountant: ['accountant'],
      finance_accountant: ['accountant'],
      cfo: ['cfo'],
      chief_financial_officer: ['cfo'],
    };

    const allowedInsightRoles = new Set(roleAliases[normalizedUserRole] || []);
    if (!allowedInsightRoles.size) return [];

    const normalizeInsightRole = (role: string) => {
      const normalized = normalizeRole(role);
      if (normalized === 'project_manager' || normalized === 'pm') return 'pm';
      if (normalized === 'team_leader' || normalized === 'team_lead' || normalized === 'tl') return 'team_lead';
      if (normalized === 'accountant' || normalized === 'finance_accountant') return 'accountant';
      if (normalized === 'cfo' || normalized === 'chief_financial_officer') return 'cfo';
      return normalized;
    };

    return insights.filter((insight) => allowedInsightRoles.has(normalizeInsightRole(insight.role)));
  }, [insights, normalizedUserRole]);

  if (!filteredInsights.length) return null;

  return (
    <Card className="io-card border-border bg-gradient-to-br from-muted/50 via-card to-muted/70">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {filteredInsights.map((insight) => (
            <div key={insight.role} className="rounded-xl border border-border bg-card/90 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{insight.role}</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{insight.headline}</p>
              <ul className="mt-3 space-y-1.5 text-xs text-foreground/80">
                {insight.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
