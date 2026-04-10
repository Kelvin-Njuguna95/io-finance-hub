'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/layout/section-card';
import { formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { ArrowRight, ListChecks } from 'lucide-react';
import Link from 'next/link';

interface PendingExpenseRow {
  id: string;
  description: string;
  category: string | null;
  project_id: string | null;
  budgeted_amount_kes: number;
  actual_amount_kes: number | null;
  status: string;
  projects?: { name: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending_auth: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  under_review: 'bg-blue-100 text-blue-700',
  modified: 'bg-purple-100 text-purple-700',
  voided: 'bg-red-100 text-red-700',
  carried_forward: 'bg-slate-100 text-slate-600',
};

const STATUS_LABEL: Record<string, string> = {
  pending_auth: 'Pending',
  confirmed: 'Confirmed',
  under_review: 'Under Review',
  modified: 'Modified',
  voided: 'Voided',
  carried_forward: 'Carried Fwd',
};

interface Props {
  /** If provided, only show items for this project */
  projectId?: string;
  /** Compact mode hides the table and just shows stats */
  compact?: boolean;
}

export function ExpenseQueuePanel({ projectId, compact }: Props) {
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      let query = supabase
        .from('pending_expenses')
        .select('id, description, category, project_id, budgeted_amount_kes, actual_amount_kes, status, projects(name)')
        .eq('year_month', currentMonth)
        .order('created_at');

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data } = await query;
      setItems((data as PendingExpenseRow[] | null) || []);
      setLoading(false);
    }
    load();
  }, [currentMonth, projectId]);

  if (loading || items.length === 0) return null;

  const pending = items.filter((i) => i.status === 'pending_auth');
  const confirmed = items.filter((i) => i.status === 'confirmed');
  const modified = items.filter((i) => i.status === 'modified');
  const voided = items.filter((i) => i.status === 'voided');
  const underReview = items.filter((i) => i.status === 'under_review');

  const totalBudgeted = items.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
  const totalConfirmed = confirmed.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const totalModified = modified.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const totalActualAll = totalConfirmed + totalModified;
  const progressPct = items.length > 0 ? Math.round(((confirmed.length + modified.length) / items.length) * 100) : 0;

  return (
    <SectionCard
      title={`Expense Queue — ${formatYearMonth(currentMonth)}`}
      description="Live view of pending, confirmed, and modified expenses for the period"
      icon={ListChecks}
      tone="warning"
      action={
        <Link href="/expenses/queue">
          <Button variant="ghost" size="sm" className="gap-1">
            View queue <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        </Link>
      }
      bodyClassName="p-4 space-y-4"
    >
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>{confirmed.length + modified.length} of {items.length} items processed</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md bg-amber-50 p-2.5 text-center">
            <p className="text-xl font-bold text-amber-700">{pending.length}</p>
            <p className="text-[11px] text-amber-600">Pending Auth</p>
          </div>
          <div className="rounded-md bg-emerald-50 p-2.5 text-center">
            <p className="text-xl font-bold text-emerald-700">{confirmed.length}</p>
            <p className="text-[11px] text-emerald-600">Confirmed</p>
          </div>
          <div className="rounded-md bg-indigo-50 p-2.5 text-center">
            <p className="text-xl font-bold text-indigo-700">{formatCurrency(totalBudgeted, 'KES')}</p>
            <p className="text-[11px] text-indigo-600">Budgeted Total</p>
          </div>
          <div className="rounded-md bg-slate-50 p-2.5 text-center">
            <p className={`text-xl font-bold ${totalActualAll > totalBudgeted ? 'text-red-600' : 'text-emerald-700'}`}>
              {formatCurrency(totalActualAll, 'KES')}
            </p>
            <p className="text-[11px] text-slate-500">Confirmed Spend</p>
          </div>
        </div>

        {/* Item list — only shown in non-compact mode */}
        {!compact && (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-md border p-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{item.description}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {item.projects?.name || 'Shared'} · {item.category || '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <div className="text-right">
                    <p className="font-mono text-xs">
                      {formatCurrency(Number(item.budgeted_amount_kes), 'KES')}
                    </p>
                    {item.actual_amount_kes != null && (
                      <p className={`font-mono text-xs ${Number(item.actual_amount_kes) > Number(item.budgeted_amount_kes) ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatCurrency(Number(item.actual_amount_kes), 'KES')}
                      </p>
                    )}
                  </div>
                  <Badge className={`${STATUS_COLOR[item.status] || 'bg-slate-100'} border-0 text-[10px]`}>
                    {STATUS_LABEL[item.status] || item.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Status summary chips — show in compact mode */}
        {compact && (voided.length > 0 || underReview.length > 0 || modified.length > 0) && (
          <div className="flex gap-2 flex-wrap">
            {modified.length > 0 && (
              <Badge className="bg-purple-100 text-purple-700 border-0">{modified.length} Modified</Badge>
            )}
            {underReview.length > 0 && (
              <Badge className="bg-blue-100 text-blue-700 border-0">{underReview.length} Under Review</Badge>
            )}
            {voided.length > 0 && (
              <Badge className="bg-red-100 text-red-700 border-0">{voided.length} Voided</Badge>
            )}
          </div>
        )}
    </SectionCard>
  );
}
