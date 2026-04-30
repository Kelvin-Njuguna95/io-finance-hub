import { CheckCircle2, Clock, Flag, AlertTriangle, FileText, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type MiscStatusKind =
  | 'overdue'
  | 'flag-open'
  | 'reviewed'
  | 'in-review'
  | 'not-submitted'
  | 'draft';

type MiscStatusPillProps = {
  kind: MiscStatusKind;
  count?: number;
  subtext?: string;
  className?: string;
};

const KIND_TONE: Record<MiscStatusKind, string> = {
  overdue: 'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/25',
  'flag-open': 'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/35',
  reviewed: 'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
  'in-review': 'bg-info-soft text-info-soft-foreground ring-1 ring-inset ring-info/25',
  'not-submitted': 'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
  draft: 'bg-muted text-foreground/70 ring-1 ring-inset ring-border',
};

const KIND_ICON: Record<MiscStatusKind, LucideIcon> = {
  overdue: AlertTriangle,
  'flag-open': Flag,
  reviewed: CheckCircle2,
  'in-review': Clock,
  'not-submitted': FileText,
  draft: FileText,
};

function defaultLabel(kind: MiscStatusKind, count?: number): string {
  switch (kind) {
    case 'overdue':
      return 'OVERDUE';
    case 'flag-open':
      return `${count ?? 1} FLAG${(count ?? 1) === 1 ? '' : 'S'} OPEN`;
    case 'reviewed':
      return 'REVIEWED';
    case 'in-review':
      return 'IN REVIEW';
    case 'not-submitted':
      return 'NOT SUBMITTED';
    case 'draft':
      return 'DRAFT';
  }
}

export function MiscStatusPill({ kind, count, subtext, className }: MiscStatusPillProps) {
  const Icon = KIND_ICON[kind];
  const label = defaultLabel(kind, count);

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
          KIND_TONE[kind],
        )}
      >
        <Icon className="size-3" strokeWidth={2.25} aria-hidden />
        {label}
      </span>
      {subtext && (
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          {subtext}
        </span>
      )}
    </div>
  );
}
