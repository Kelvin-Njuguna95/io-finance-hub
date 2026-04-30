// Visual spec: _design-system/Misc Draws and Reports.html (.rep-pill)
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
  /** Optional inline trailing text on the pill itself, e.g. "Apr 02". */
  inlineDate?: string;
  className?: string;
};

const KIND_TONE: Record<MiscStatusKind, string> = {
  overdue: 'bg-danger-soft text-danger-soft-foreground',
  // .rep-pill.flagged uses oklch(0.92 0.10 25) / var(--danger) — stronger red than warning-soft.
  'flag-open': 'bg-[oklch(0.92_0.10_25)] text-[var(--danger)]',
  reviewed: 'bg-success-soft text-success-soft-foreground',
  'in-review': 'bg-info-soft text-info-soft-foreground',
  'not-submitted': 'bg-[var(--paper-3)] text-[var(--warm-grey-3)]',
  draft: 'bg-[var(--paper-3)] text-[var(--warm-grey-3)]',
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
      return 'Overdue';
    case 'flag-open':
      return `${count ?? 1} flag${(count ?? 1) === 1 ? '' : 's'} open`;
    case 'reviewed':
      return 'Reviewed';
    case 'in-review':
      return 'In review';
    case 'not-submitted':
      return 'Not submitted';
    case 'draft':
      return 'Draft';
  }
}

export function MiscStatusPill({ kind, count, inlineDate, className }: MiscStatusPillProps) {
  const Icon = KIND_ICON[kind];
  const label = defaultLabel(kind, count);

  return (
    <span
      className={cn(
        // .rep-pill: padding 4px 10px, mono 10.5px font-weight 600, letter-spacing 0.06em, uppercase, gap 6px
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase leading-none tracking-[0.06em]',
        KIND_TONE[kind],
        className,
      )}
    >
      <Icon className="size-[11px]" strokeWidth={2} aria-hidden />
      <span>
        {label}
        {inlineDate && <span className="ml-1 opacity-90">{inlineDate}</span>}
      </span>
    </span>
  );
}
