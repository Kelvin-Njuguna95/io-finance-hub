'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RoleInsight {
  role: string;
  headline: string;
  items: string[];
}

export function RoleInsightBoard({ title = 'Role-Based Insights', insights }: { title?: string; insights: RoleInsight[] }) {
  if (!insights.length) return null;

  return (
    <Card className="io-card border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/70">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {insights.map((insight) => (
            <div key={insight.role} className="rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{insight.role}</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{insight.headline}</p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-600">
                {insight.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
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
