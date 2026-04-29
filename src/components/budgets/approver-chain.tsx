import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Approver-chain sidebar widget for the budget detail page. Renders one
 * row per role in the chain with avatar, name, role line, status pill.
 */

export type ApproverChainStatus =
  | 'pending'
  | 'opened'
  | 'approved'
  | 'rejected'
  | 'sent_back';

export type ApproverChainEntry = {
  role: string;
  name?: string;
  status: ApproverChainStatus;
  /** Display-only: e.g. "PM · author · 28 Mar". Falls back to role+at. */
  description?: string;
  at?: string;
};

type ApproverChainProps = {
  chain: ApproverChainEntry[];
  className?: string;
};

const NAIROBI_TZ = 'Africa/Nairobi';

const STATUS_TONE: Record<ApproverChainStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  opened: 'bg-info-soft text-info-soft-foreground',
  approved: 'bg-success-soft text-success-soft-foreground',
  rejected: 'bg-danger-soft text-danger-soft-foreground',
  sent_back: 'bg-warning-soft text-warning-soft-foreground',
};

const STATUS_LABEL: Record<ApproverChainStatus, string> = {
  pending: 'Pending',
  opened: 'Opened',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back',
};

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '—';
}

function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: NAIROBI_TZ,
    day: '2-digit',
    month: 'short',
  }).format(d);
}

export function ApproverChain({ chain, className }: ApproverChainProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card px-5 py-5',
        className,
      )}
    >
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
        Approver chain
      </p>
      <ul className="mt-4 space-y-4">
        {chain.map((entry, idx) => {
          const date = shortDate(entry.at);
          const description =
            entry.description ??
            `${entry.role}${date ? ` · ${date}` : ''}`;
          return (
            <li key={`${entry.role}-${idx}`} className="flex items-center gap-3">
              <Avatar size="sm" className="size-8 bg-muted">
                <AvatarFallback className="text-[11px] font-medium uppercase">
                  {entry.name ? initials(entry.name) : '·'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {entry.name ?? '—'}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {description}
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em]',
                  STATUS_TONE[entry.status],
                )}
              >
                {STATUS_LABEL[entry.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
