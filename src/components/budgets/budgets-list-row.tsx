'use client';

import { MoreHorizontal } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';
import { ROLE_LABELS } from '@/types/database';
import type { UserRole } from '@/types/database';
import { PeriodPill } from './period-pill';
import { UtilisationBar } from './utilisation-bar';
import type { BudgetListRow } from '@/hooks/use-budgets-list';

export type BudgetsListRowActions = {
  canWithdraw: boolean;
  canDelete: boolean;
  canCfoApprove: boolean;
  canPopulateExpenses: boolean;
  onWithdraw(): void;
  onDelete(): void;
  onCfoApprove(): void;
  onPopulateExpenses(): void;
};

type BudgetsListRowProps = {
  row: BudgetListRow;
  hasSibling: boolean;
  actions: BudgetsListRowActions;
  onClick(): void;
};

const NAIROBI_TZ = 'Africa/Nairobi';

function compactId(yearMonth: string, id: string): string {
  const [y, m] = yearMonth.split('-');
  const tail = id.replace(/-/g, '').slice(-4).toUpperCase();
  return `BUD-${y}${m}-${tail}`;
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '—';
}

function statusVerb(status: string): string {
  if (status === 'approved') return 'approved';
  if (status === 'pm_approved') return 'PM approved';
  if (status === 'rejected' || status === 'pm_rejected') return 'rejected';
  if (status === 'returned_to_tl') return 'returned';
  if (status === 'draft') return 'drafted';
  return 'submitted';
}

function whenText(at: string | null): string {
  if (!at) return '—';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
}

const TONE_CLASS: Record<'success' | 'warning' | 'danger' | 'muted' | 'info', string> = {
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
  muted: 'bg-muted text-foreground/80',
  info: 'bg-info-soft text-info-soft-foreground',
};

function displayStatus(
  status: string,
  approved: number,
  spent: number,
): { label: string; tone: keyof typeof TONE_CLASS } {
  if (approved > 0 && spent > approved) return { label: 'Over', tone: 'danger' };
  if (status === 'approved') return { label: 'Approved', tone: 'success' };
  if (status === 'pm_approved') return { label: 'PM approved', tone: 'success' };
  if (status === 'rejected' || status === 'pm_rejected')
    return { label: 'Rejected', tone: 'danger' };
  if (status === 'returned_to_tl') return { label: 'Returned', tone: 'warning' };
  if (status === 'draft') return { label: 'Draft', tone: 'muted' };
  return { label: 'Pending', tone: 'warning' };
}

function roleLabelShort(role: string): string {
  if (role === 'project_manager') return 'PM';
  if (role === 'team_leader') return 'TL';
  if (role === 'cfo') return 'CFO';
  return ROLE_LABELS[role as UserRole] ?? role;
}

export const BUDGETS_LIST_GRID =
  'grid-cols-[1.4fr_1.2fr_0.9fr_0.9fr_220px_96px_36px]';

export function BudgetsListRow({
  row,
  hasSibling,
  actions,
  onClick,
}: BudgetsListRowProps) {
  const status = displayStatus(row.latestStatus, row.approvedKes, row.spentKes);
  const eyebrow = compactId(row.yearMonth, row.id);
  const versionLine =
    row.currentVersion === 1 ? 'v1 · first submission' : `v${row.currentVersion} · revised`;

  const hasAnyAction =
    actions.canWithdraw ||
    actions.canDelete ||
    actions.canCfoApprove ||
    actions.canPopulateExpenses;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'grid items-center gap-4 border-b border-border/60 px-4 py-3.5 text-left transition-colors',
        'hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none',
        'cursor-pointer',
        BUDGETS_LIST_GRID,
      )}
    >
      {/* Col 1 — Budget id + scope name */}
      <div className="min-w-0">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
          {eyebrow}
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {row.scopeName}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {row.isProjectScope ? 'Project budget' : 'Department budget'}
          {hasSibling && (
            <span className="ml-1.5 inline-flex items-center rounded-[var(--radius-sm)] bg-warning-soft px-1.5 py-px text-[9.5px] font-medium uppercase tracking-[0.08em] text-warning-soft-foreground">
              dual
            </span>
          )}
        </p>
      </div>

      {/* Col 2 — scope detail */}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground">
          {row.scopeName}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {row.isProjectScope ? 'Project · KES' : 'Shared · KES'}
        </p>
      </div>

      {/* Col 3 — owner */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar size="sm" className="size-7 bg-muted">
          <AvatarFallback className="text-[10px] font-medium uppercase">
            {initials(row.createdByName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground">
            {row.createdByName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {roleLabelShort(row.submittedByRole)} · {statusVerb(row.latestStatus)} {whenText(row.submittedAt)}
          </p>
        </div>
      </div>

      {/* Col 4 — period */}
      <div className="min-w-0">
        <PeriodPill yearMonth={row.yearMonth} />
        <p className="mt-1.5 text-[11px] text-muted-foreground">{versionLine}</p>
      </div>

      {/* Col 5 — approved + utilisation */}
      <div className="min-w-0 text-right">
        <p className="font-mono text-[14px] font-medium tabular-nums text-foreground">
          {formatCompactKES(row.approvedKes)}
        </p>
        <UtilisationBar
          approvedKes={row.approvedKes}
          spentKes={row.spentKes}
          className="mt-1.5"
        />
      </div>

      {/* Col 6 — status pill */}
      <div className="flex justify-end">
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-[var(--radius-sm)] px-2 text-[11px] font-medium uppercase tracking-[0.06em]',
            TONE_CLASS[status.tone],
          )}
        >
          {status.label}
        </span>
      </div>

      {/* Col 7 — overflow actions */}
      <div className="flex justify-end">
        {hasAnyAction ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Budget actions"
                  className="size-7"
                  onClick={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              {actions.canCfoApprove && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onCfoApprove();
                  }}
                >
                  Approve
                </DropdownMenuItem>
              )}
              {actions.canPopulateExpenses && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onPopulateExpenses();
                  }}
                >
                  Populate expenses
                </DropdownMenuItem>
              )}
              {actions.canWithdraw && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onWithdraw();
                  }}
                >
                  Withdraw to draft
                </DropdownMenuItem>
              )}
              {actions.canDelete && (
                <DropdownMenuItem
                  className="text-danger-soft-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.onDelete();
                  }}
                >
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span aria-hidden className="block size-7" />
        )}
      </div>
    </div>
  );
}
