// Visual spec: _design-system/Misc Draws and Reports.html (.feed > .ev > .marker)
import {
  CheckCircle2,
  Flag,
  FilePlus,
  Send,
  Plus,
  ArrowUpRight,
  Banknote,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type TimelineEventKind =
  | 'drafted'
  | 'submitted'
  | 'reviewed'
  | 'flagged'
  | 'top-up-requested'
  | 'top-up-approved'
  | 'standing'
  | 'flag-opened';

export type TimelineEvent = {
  id: string;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
  timestamp: string;
};

const KIND_ICON: Record<TimelineEventKind, LucideIcon> = {
  drafted: FilePlus,
  submitted: Send,
  reviewed: CheckCircle2,
  flagged: Flag,
  'top-up-requested': Plus,
  'top-up-approved': ArrowUpRight,
  standing: Banknote,
  'flag-opened': Flag,
};

// .marker variants from the mockup: default (paper-3), gold (gold-soft), success, danger
type MarkerTone = 'default' | 'gold' | 'success' | 'danger';

const KIND_TONE: Record<TimelineEventKind, MarkerTone> = {
  drafted: 'default',
  submitted: 'gold',
  reviewed: 'success',
  flagged: 'danger',
  'top-up-requested': 'default',
  'top-up-approved': 'gold',
  standing: 'default',
  'flag-opened': 'danger',
};

const TONE_CLASS: Record<MarkerTone, string> = {
  default: 'bg-[var(--paper-3)] text-muted-foreground',
  gold: 'bg-[var(--gold-soft)] text-[oklch(0.42_0.10_75)]',
  success: 'bg-success-soft text-success-soft-foreground',
  danger: 'bg-danger-soft text-danger-soft-foreground',
};

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(',', ' ·');
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
  return (
    <div className={cn('', className)}>
      <div className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Report activity
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="flex flex-col gap-3.5">
          {events.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const toneClass = TONE_CLASS[KIND_TONE[e.kind]];
            return (
              <li key={e.id} className="grid grid-cols-[24px_1fr] gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-[22px] items-center justify-center rounded-full',
                    toneClass,
                  )}
                >
                  <Icon className="size-[11px]" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-normal leading-[1.45] text-foreground">
                    {e.title}
                  </p>
                  {e.detail && (
                    <p className="mt-0.5 text-[11px] italic text-muted-foreground">{e.detail}</p>
                  )}
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.10em] text-muted-foreground">
                    {formatStamp(e.timestamp)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
