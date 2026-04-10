import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Empty state. Minimal, tokenized, composable. Use inside any panel body
 * where there is no data to show.
 */

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Visual tone for the icon tile. */
  tone?:
    | 'brand'
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
    | 'violet'
    | 'teal'
    | 'neutral';
};

const TONE_STYLES: Record<NonNullable<EmptyStateProps['tone']>, string> = {
  brand:
    'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 dark:bg-primary/15',
  success:
    'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
  warning:
    'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/30',
  danger:
    'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/25',
  info:
    'bg-info-soft text-info-soft-foreground ring-1 ring-inset ring-info/25',
  violet:
    'bg-violet-soft text-violet-soft-foreground ring-1 ring-inset ring-violet/25',
  teal:
    'bg-teal-soft text-teal-soft-foreground ring-1 ring-inset ring-teal/25',
  neutral:
    'bg-muted text-muted-foreground ring-1 ring-inset ring-border',
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center',
        className,
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className={cn(
            'flex size-11 items-center justify-center rounded-xl',
            TONE_STYLES[tone],
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
