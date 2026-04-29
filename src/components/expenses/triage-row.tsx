'use client';

import { Check, Clock, MessageCircle, Paperclip, Repeat, TrendingUp, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { PendingExpenseRow } from '@/hooks/use-expense-queue';

const NAIROBI_TZ = 'Africa/Nairobi';

export type TriageRowActions = {
  onApprove(): void;
  onAskForChanges(): void;
  onReject(): void;
};

type TriageRowProps = {
  row: PendingExpenseRow;
  selected: boolean;
  onToggleSelect(): void;
  isYourTurn: boolean;
  actions?: TriageRowActions;
  processing: boolean;
};

function compactExpenseId(createdAt: string, id: string): string {
  // EXP-{MM}-{DD}-{last4}
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return id.slice(0, 8).toUpperCase();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `EXP-${mm}-${dd}-${tail}`;
}

function submittedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function ageDisplay(hours: number): { num: string; unit: string; tone: 'default' | 'warn' | 'danger' } {
  if (hours < 24) {
    return { num: String(Math.max(0, Math.round(hours))), unit: 'hours', tone: 'default' };
  }
  if (hours < 48) {
    const days = Math.floor(hours / 24);
    const rem = Math.max(0, Math.round(hours - days * 24));
    return { num: `${days}d`, unit: rem > 0 ? `${rem} hrs` : 'over', tone: 'warn' };
  }
  if (hours < 72) {
    const days = Math.floor(hours / 24);
    const rem = Math.max(0, Math.round(hours - days * 24));
    return { num: `${days}d`, unit: rem > 0 ? `${rem} hrs` : 'over', tone: 'warn' };
  }
  const days = Math.floor(hours / 24);
  return { num: `${days}d`, unit: 'over SLA', tone: 'danger' };
}

const STAGE_LABEL: Record<string, string> = {
  pending_auth: 'Awaiting decision',
  under_review: 'Under review',
  modified: 'Modified · awaiting confirm',
  confirmed: 'Confirmed',
  voided: 'Voided',
  carried_forward: 'Carried forward',
};

function statusToWith(status: string): string {
  if (status === 'under_review') return 'Reviewer';
  if (status === 'modified') return 'Pending re-confirm';
  return 'Decider';
}

export const TRIAGE_GRID =
  'grid-cols-[28px_48px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_78px_130px_220px]';

export function TriageRow({
  row,
  selected,
  onToggleSelect,
  isYourTurn,
  actions,
  processing,
}: TriageRowProps) {
  const eyebrow = compactExpenseId(row.createdAt, row.id);
  const submittedAt = submittedAtLabel(row.createdAt);
  const age = ageDisplay(row.ageHours);
  const utilizationPct = Math.max(0, Math.min(100, row.budgetUtilizationPct));
  const projectionAddPct = Math.max(0, row.budgetProjectedPct - utilizationPct);
  const projectionVisualPct = Math.min(100 - utilizationPct, projectionAddPct);

  return (
    <div
      className={cn(
        'grid items-center gap-3 border-b border-border-subtle px-5 py-4 last:border-b-0',
        'transition-colors',
        isYourTurn
          ? 'border-l-[3px] border-l-[var(--gold)] bg-[linear-gradient(90deg,var(--gold-soft)_0%,transparent_60%)] hover:bg-[linear-gradient(90deg,var(--gold-soft)_0%,var(--paper-2)_60%)]'
          : 'border-l-[3px] border-l-transparent hover:bg-[var(--paper-2)]',
        TRIAGE_GRID,
      )}
    >
      {/* Col 0 — checkbox */}
      <div className="flex items-center justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Select expense"
        />
      </div>

      {/* Col 1 — submitter avatar */}
      <span
        aria-hidden
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-full font-mono text-[11px] font-medium',
          isYourTurn
            ? 'bg-[var(--gold)] text-foreground'
            : 'bg-[var(--paper-3)] text-[var(--warm-grey-3)]',
        )}
      >
        {row.submitterInitials}
      </span>

      {/* Col 2 — main */}
      <div className="min-w-0 pr-3">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
          <span>{eyebrow}</span>
          <span className="text-[var(--paper-4)]">·</span>
          <span>Submitted {submittedAt}</span>
        </p>
        <p className="mt-1 truncate text-[14px] font-medium leading-snug text-foreground">
          {row.description}
        </p>
        <p className="mt-1 truncate text-[12px] text-[var(--warm-grey-3)]">
          {row.category && (
            <>
              <span className="font-medium text-foreground">{row.category}</span>
              {' · '}
            </>
          )}
          {STAGE_LABEL[row.status] ?? row.status}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.budgetIsOver && (
            <Chip tone="danger">
              <TrendingUp className="size-3" strokeWidth={2} />
              Lifts line to {Math.round(row.budgetProjectedPct)}%
            </Chip>
          )}
          {!row.budgetIsOver && row.wouldPushOver && (
            <Chip tone="warn">
              <TrendingUp className="size-3" strokeWidth={2} />
              Pushes line to {Math.round(row.budgetProjectedPct)}%
            </Chip>
          )}
          {row.isOverSla && (
            <Chip tone="danger">
              <Clock className="size-3" strokeWidth={2} />
              Over SLA
            </Chip>
          )}
          {row.status === 'modified' && (
            <Chip tone="info">
              <Repeat className="size-3" strokeWidth={2} />
              Modified
            </Chip>
          )}
          {row.actualAmountKes != null && row.status !== 'pending_auth' && (
            <Chip tone="info">
              <Paperclip className="size-3" strokeWidth={2} />
              Actual recorded
            </Chip>
          )}
        </div>
      </div>

      {/* Col 3 — project */}
      <div className="min-w-0 pr-3">
        <p className="truncate text-[12.5px] font-medium leading-tight text-foreground">
          {row.projectName ?? row.departmentName ?? 'Shared'}
        </p>
        <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
          {row.projectName
            ? 'Project'
            : row.departmentName
              ? 'Department'
              : 'Shared cost'}
        </p>
      </div>

      {/* Col 4 — budget impact */}
      <div className="min-w-0 pr-3">
        <span className="font-mono text-[11px] font-medium tracking-[0.04em] text-foreground">
          {row.budgetLabel}
        </span>
        <div className="relative mt-2 h-1.5 overflow-visible rounded-full bg-[var(--paper-3)]">
          <span
            className={cn(
              'absolute left-0 top-0 bottom-0 rounded-full',
              row.budgetIsOver
                ? 'bg-[var(--danger)]'
                : utilizationPct < 50
                  ? 'bg-[var(--success)]'
                  : 'bg-[var(--gold)]',
            )}
            style={{ width: `${utilizationPct}%` }}
          />
          {projectionVisualPct > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-0 bottom-0 rounded-r-full',
                row.budgetIsOver || row.wouldPushOver
                  ? 'bg-[var(--danger)] opacity-70'
                  : 'bg-[var(--gold-hi)] opacity-70',
              )}
              style={{
                left: `${utilizationPct}%`,
                width: `${projectionVisualPct}%`,
              }}
            />
          )}
          <span
            aria-hidden
            className="absolute -top-0.5 right-0 -bottom-0.5 w-[1.5px] rounded-[1px] bg-foreground"
          />
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.10em]">
          <span className="text-foreground">{Math.round(utilizationPct)}% used</span>
          <span className="text-muted-foreground">→</span>
          <span
            className={cn(
              row.budgetIsOver || row.wouldPushOver
                ? 'text-[var(--danger)]'
                : 'text-success-soft-foreground',
            )}
          >
            +{(row.budgetProjectedPct - utilizationPct).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Col 5 — age */}
      <div
        className={cn(
          'text-center font-mono leading-tight',
          age.tone === 'warn' && 'text-[var(--gold-lo)]',
          age.tone === 'danger' && 'text-[var(--danger)]',
        )}
      >
        <span className="block text-[18px] font-medium tabular-nums">
          {age.num}
        </span>
        <span className="mt-1 block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {age.unit}
        </span>
      </div>

      {/* Col 6 — amount + stage */}
      <div className="text-right font-mono leading-tight">
        <div>
          <span className="mr-1 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            KES
          </span>
          <span className="text-[17px] font-medium tabular-nums text-foreground">
            {row.budgetedAmountKes.toLocaleString('en-KE', {
              maximumFractionDigits: 0,
            })}
          </span>
        </div>
        <span className="mt-1.5 block text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          {row.status === 'pending_auth' ? (
            <>
              Next: <strong className="font-medium text-foreground">Confirm</strong>
            </>
          ) : (
            <>
              At:{' '}
              <strong className="font-medium text-foreground">
                {row.status === 'under_review' ? 'Review' : 'Awaiting confirm'}
              </strong>
            </>
          )}
        </span>
      </div>

      {/* Col 7 — actions or pending-stage */}
      <div className="flex justify-end">
        {isYourTurn && actions ? (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="icon"
              aria-label="Reject"
              className="size-9 hover:border-[var(--danger-soft)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
              disabled={processing}
              onClick={(e) => {
                e.stopPropagation();
                actions.onReject();
              }}
            >
              <X className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Ask for changes"
              className="size-9"
              disabled={processing}
              onClick={(e) => {
                e.stopPropagation();
                actions.onAskForChanges();
              }}
            >
              <MessageCircle className="size-4" />
            </Button>
            <Button
              size="sm"
              className={cn(
                'h-9 gap-1.5 border border-foreground bg-foreground px-3.5 text-background hover:bg-[var(--ink-2)]',
              )}
              disabled={processing}
              onClick={(e) => {
                e.stopPropagation();
                actions.onApprove();
              }}
            >
              <Check className="size-4 text-[var(--gold)]" strokeWidth={2} />
              Approve
            </Button>
          </div>
        ) : (
          <div className="text-right font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
            with{' '}
            <span className="font-medium text-foreground">
              {statusToWith(row.status)}
            </span>
            <span className="mt-1 block">since {submittedAt}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: 'default' | 'danger' | 'warn' | 'info';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.08em]',
        tone === 'danger' &&
          'border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--danger)]',
        tone === 'warn' &&
          'border-[var(--gold)] bg-[var(--gold-soft)] text-[oklch(0.40_0.10_75)]',
        tone === 'info' &&
          'border-[var(--info-soft)] bg-[var(--info-soft)] text-[var(--info-soft-foreground)]',
        tone === 'default' &&
          'border-border-subtle bg-[var(--paper-2)] text-[var(--warm-grey-3)]',
      )}
    >
      {children}
    </span>
  );
}
