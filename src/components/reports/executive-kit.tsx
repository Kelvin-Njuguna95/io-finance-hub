'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';

export function formatCompactCurrency(amount: number, currency: 'KES' | 'USD' = 'KES') {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  const symbol = currency === 'KES' ? 'KES ' : '$';

  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(1)}`;
}

export function formatExecutivePercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function statusTone(status: 'On Track' | 'Watch' | 'Action Needed') {
  if (status === 'On Track') return 'bg-success-soft text-success-soft-foreground border-emerald-200';
  if (status === 'Watch') return 'bg-warning-soft text-warning-soft-foreground border-warning/30';
  return 'bg-danger-soft text-danger-soft-foreground border-danger/30';
}

export function ChartStatusBadge({ status }: { status: 'On Track' | 'Watch' | 'Action Needed' }) {
  return <Badge className={`border ${statusTone(status)}`}>{status}</Badge>;
}

export function ExecutiveKpiCard({ label, value, trend, positive = true }: { label: string; value: string; trend: string; positive?: boolean }) {
  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="bg-primary rounded-t-xl pb-2">
        <CardTitle className="text-xs uppercase tracking-wider text-primary-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <p className="font-mono text-3xl font-bold tabular-nums text-foreground">{value}</p>
        <Badge className={`mt-3 ${positive ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'}`}>{trend}</Badge>
      </CardContent>
    </Card>
  );
}

export function ExecutiveInsightPanel({ title = 'Executive Insights', lines }: { title?: string; lines: string[] }) {
  const [open, setOpen] = useState(false);
  const clean = useMemo(() => lines.filter(Boolean), [lines]);
  if (!clean.length) return null;

  return (
    <Card className="border-border">
      <button className="w-full text-left" onClick={() => setOpen((v) => !v)} type="button">
        <CardHeader className="flex-row items-center justify-between space-y-0 bg-muted/50 rounded-t-xl">
          <CardTitle className="text-sm text-foreground/90">{title}</CardTitle>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </CardHeader>
      </button>
      {open && (
        <CardContent className="pt-4">
          <ul className="space-y-2">
            {clean.map((line) => (
              <li key={line} className="text-sm text-foreground/90">• {line}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
