import { cn } from '@/lib/utils';

/**
 * Activity timeline for the budget detail page. Renders a vertical list
 * matching _design-system/budget-detail.html's `.timeline` block, with a
 * muted footnote pointing to the audit trail since coverage is partial
 * (D3 — only 4 of 10 budget API routes emit audit_logs today).
 */

export type BudgetActivityEvent = {
  /** ISO timestamp for ordering and display. */
  at: string;
  /** Display name of the actor; "System" for null user_id. */
  who: string;
  /** Short verb phrase (e.g. "approved budget", "submitted v3"). */
  verb: string;
  /** Optional inline reference (e.g. invoice ID). */
  ref?: string;
  refLabel?: string;
  /** Optional numeric callout (e.g. "KES 1,250,000"). */
  num?: string;
  /** Optional trailing fragment (e.g. " · trainer overtime"). */
  detail?: string;
};

type ActivityTimelineProps = {
  events: BudgetActivityEvent[];
  className?: string;
};

const NAIROBI_TZ = 'Africa/Nairobi';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${day} · ${time}`;
}

export function ActivityTimeline({ events, className }: ActivityTimelineProps) {
  if (events.length === 0) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card px-5 py-6',
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No recorded activity for this budget yet.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Earlier events may exist in the audit trail.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-5 py-5',
        className,
      )}
    >
      <ol className="space-y-4">
        {events.map((event, idx) => (
          <li
            key={`${event.at}-${idx}`}
            className="grid grid-cols-[120px_1fr] gap-4 border-b border-border/50 pb-4 last:border-b-0 last:pb-0"
          >
            <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-muted-foreground">
              {formatWhen(event.at)}
            </span>
            <p className="text-[13px] leading-snug text-foreground">
              <span className="font-medium">{event.who}</span>{' '}
              <span className="text-muted-foreground">{event.verb}</span>
              {event.ref && (
                <>
                  {' '}
                  <span className="font-mono text-[12px] text-foreground">
                    {event.refLabel ?? event.ref}
                  </span>
                </>
              )}
              {event.num && (
                <>
                  {' · '}
                  <span className="font-mono tabular-nums text-foreground">
                    {event.num}
                  </span>
                </>
              )}
              {event.detail && (
                <span className="text-muted-foreground">{event.detail}</span>
              )}
              .
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Earlier events may exist in the audit trail.
      </p>
    </div>
  );
}
