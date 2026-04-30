import {
  CheckCircle2,
  Flag,
  FileText,
  Send,
  Plus,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type TimelineEventKind =
  | 'drafted'
  | 'submitted'
  | 'reviewed'
  | 'flagged'
  | 'top-up-requested'
  | 'flag-opened';

export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
  timestamp: string;
};

const KIND_ICON: Record<TimelineEventKind, LucideIcon> = {
  drafted: FileText,
  submitted: Send,
  reviewed: CheckCircle2,
  flagged: Flag,
  'top-up-requested': Plus,
  'flag-opened': AlertTriangle,
};

const KIND_TONE: Record<TimelineEventKind, string> = {
  drafted: 'bg-muted text-muted-foreground ring-border',
  submitted: 'bg-info-soft text-info-soft-foreground ring-info/25',
  reviewed: 'bg-success-soft text-success-soft-foreground ring-success/25',
  flagged: 'bg-warning-soft text-warning-soft-foreground ring-warning/35',
  'top-up-requested': 'bg-muted text-foreground/70 ring-border',
  'flag-opened': 'bg-danger-soft text-danger-soft-foreground ring-danger/25',
};

function formatRelative(iso: string): string {
  const now = new Date();
  const t = new Date(iso);
  const diffMs = now.getTime() - t.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
  }).format(t);
}

function formatAbsolute(iso: string): string {
  const t = new Date(iso);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(t);
}

type ReportActivityTimelineProps = {
  events: ReadonlyArray<TimelineEvent>;
  emptyLabel?: string;
  className?: string;
};

export function ReportActivityTimeline({
  events,
  emptyLabel = 'No activity yet.',
  className,
}: ReportActivityTimelineProps) {
  if (events.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
        <h4 className="font-display text-[14px] font-medium text-foreground">Report activity</h4>
        <p className="mt-2 text-xs text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <h4 className="font-display text-[14px] font-medium text-foreground">Report activity</h4>
      <ol className="mt-3 space-y-3">
        {events.map((e, i) => {
          const Icon = KIND_ICON[e.kind];
          const tone = KIND_TONE[e.kind];
          const isLast = i === events.length - 1;
          return (
            <li key={e.id} className="relative flex gap-3">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-3 top-6 -ml-[0.5px] h-[calc(100%-12px)] w-px bg-border"
                />
              )}
              <span
                className={cn(
                  'relative z-[1] inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
                  tone,
                )}
              >
                <Icon className="size-3" strokeWidth={2.25} aria-hidden />
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <p className="text-[13px] leading-tight text-foreground">{e.title}</p>
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                    title={formatAbsolute(e.timestamp)}
                  >
                    {formatRelative(e.timestamp)}
                  </span>
                </div>
                {e.detail && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
