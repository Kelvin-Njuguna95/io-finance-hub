'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatCompactKES, formatCurrency, getCurrentYearMonth, formatYearMonth } from '@/lib/format';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

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

const STATUS_TONE: Record<string, string> = {
  pending_auth: 'bg-warning-soft text-warning-soft-foreground',
  confirmed: 'bg-success-soft text-success-soft-foreground',
  under_review: 'bg-info-soft text-info-soft-foreground',
  modified: 'bg-[var(--gold-soft)] text-[oklch(0.42_0.10_75)]',
  voided: 'bg-danger-soft text-danger-soft-foreground',
  carried_forward: 'bg-[var(--paper-3)] text-foreground',
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
  /** Compact mode hides the item list and just shows stats */
  compact?: boolean;
}

export function ExpenseQueuePanel({ projectId, compact }: Props) {
  const [items, setItems] = useState<PendingExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const currentMonth = getCurrentYearMonth();
  const monthLabel = formatYearMonth(currentMonth);

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

  const processedCount = confirmed.length + modified.length;
  const totalBudgeted = items.reduce((s, i) => s + Number(i.budgeted_amount_kes), 0);
  const totalConfirmed = confirmed.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const totalModified = modified.reduce((s, i) => s + Number(i.actual_amount_kes || 0), 0);
  const totalActualAll = totalConfirmed + totalModified;
  const overBudget = totalActualAll > totalBudgeted;
  const progressPct = items.length > 0 ? Math.round((processedCount / items.length) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
      {/* List-frame header */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--paper-2)] px-5 py-3">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Expense queue
          <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
          <span className="text-foreground">{monthLabel}</span>
          <span aria-hidden className="mx-1 text-[var(--paper-4)]">·</span>
          <span className="text-foreground">
            {processedCount} of {items.length} processed
          </span>
        </span>
        <Link
          href="/expenses/queue"
          className="inline-flex items-center gap-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.10em] text-muted-foreground transition-colors hover:text-foreground"
        >
          View queue <ArrowRight className="size-3" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      <div className="space-y-4 px-5 py-5">
        {/* Progress bar — same vocabulary as /misc itemisation bar */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
              Processed
            </span>
            <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
              {progressPct}%
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--paper-3)]">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                progressPct >= 100
                  ? 'bg-[var(--success)]'
                  : progressPct >= 50
                    ? 'bg-[var(--success)]'
                    : progressPct > 0
                      ? 'bg-[var(--gold)]'
                      : 'bg-[var(--paper-4)]',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* 4-tile inset grid — paper-2 cells with mono uppercase eyebrows, tone-mapped values */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-sm)] bg-[var(--border-subtle)] sm:grid-cols-4">
          <Tile
            label="Pending auth"
            value={String(pending.length)}
            tone={pending.length > 0 ? 'warn' : 'default'}
          />
          <Tile
            label="Confirmed"
            value={String(confirmed.length)}
            tone={confirmed.length > 0 ? 'success' : 'default'}
          />
          <Tile
            label="Budgeted total"
            value={formatCompactKES(totalBudgeted)}
            tone="default"
          />
          <Tile
            label="Confirmed spend"
            value={formatCompactKES(totalActualAll)}
            tone={overBudget ? 'danger' : totalActualAll > 0 ? 'success' : 'default'}
          />
        </div>

        {/* Item list — non-compact mode */}
        {!compact && (
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-subtle">
            <div className="max-h-[300px] divide-y divide-border-subtle overflow-y-auto">
              {items.map((item) => {
                const tone = STATUS_TONE[item.status] || 'bg-[var(--paper-3)] text-foreground';
                const label = STATUS_LABEL[item.status] || item.status;
                const overItem =
                  item.actual_amount_kes != null &&
                  Number(item.actual_amount_kes) > Number(item.budgeted_amount_kes);
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{item.description}</p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
                        {item.projects?.name || 'Shared'} · {item.category || '—'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="font-mono text-[12px] tabular-nums text-foreground">
                          {formatCurrency(Number(item.budgeted_amount_kes), 'KES')}
                        </p>
                        {item.actual_amount_kes != null && (
                          <p
                            className={cn(
                              'font-mono text-[11px] tabular-nums',
                              overItem
                                ? 'text-[var(--danger)]'
                                : 'text-success-soft-foreground',
                            )}
                          >
                            {formatCurrency(Number(item.actual_amount_kes), 'KES')}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em]',
                          tone,
                        )}
                      >
                        {label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Compact-mode status chips */}
        {compact && (voided.length > 0 || underReview.length > 0 || modified.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {modified.length > 0 && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                  STATUS_TONE.modified,
                )}
              >
                {modified.length} modified
              </span>
            )}
            {underReview.length > 0 && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                  STATUS_TONE.under_review,
                )}
              >
                {underReview.length} under review
              </span>
            )}
            {voided.length > 0 && (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]',
                  STATUS_TONE.voided,
                )}
              >
                {voided.length} voided
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'warn' | 'success' | 'danger';
}) {
  const wrap =
    tone === 'warn'
      ? 'bg-warning-soft'
      : tone === 'success'
        ? 'bg-success-soft'
        : tone === 'danger'
          ? 'bg-danger-soft'
          : 'bg-card';
  const valueClass =
    tone === 'warn'
      ? 'text-warning-soft-foreground'
      : tone === 'success'
        ? 'text-success-soft-foreground'
        : tone === 'danger'
          ? 'text-[var(--danger)]'
          : 'text-foreground';
  return (
    <div className={cn('flex flex-col gap-1 px-3 py-2.5', wrap)}>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono text-[16px] font-medium tabular-nums', valueClass)}>
        {value}
      </span>
    </div>
  );
}
