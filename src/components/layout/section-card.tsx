import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * The shared "titled panel" used throughout the dashboard: icon tile +
 * title + optional description + right-aligned action slot + body.
 *
 * Replaces the copy-pasted Card/CardHeader/CardTitle/Link/Button pattern
 * used by the CFO/accountant/PM/TL dashboards and the misc panels.
 *
 * Not a layout component — content padding and spacing live inside the
 * children. This component owns the frame.
 */

export type SectionTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'violet'
  | 'teal'
  | 'neutral';

type SectionCardProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: SectionTone;
  /** Right-aligned header slot (links, buttons, dropdowns). */
  action?: React.ReactNode;
  /** Pill/badge slot shown next to the title (counts, severity). */
  titleAdornment?: React.ReactNode;
  children?: React.ReactNode;
  /** Optional `role` override; defaults to `region`. */
  role?: React.AriaRole;
  /** className applied to the outer section. */
  className?: string;
  /** className applied to the header row. */
  headerClassName?: string;
  /** className applied to the body wrapper. */
  bodyClassName?: string;
};

const TONE_TILE: Record<SectionTone, string> = {
  brand:
    'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 dark:bg-primary/15',
  success:
    'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25',
  warning:
    'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/35',
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

export function SectionCard({
  title,
  description,
  icon: Icon,
  tone = 'brand',
  action,
  titleAdornment,
  children,
  role = 'region',
  className,
  headerClassName,
  bodyClassName,
}: SectionCardProps) {
  const labelId = React.useId();

  return (
    <section
      role={role}
      aria-labelledby={labelId}
      className={cn(
        'rounded-xl border border-border bg-card shadow-elev-1',
        'transition-shadow duration-[var(--dur-base)] ease-[cubic-bezier(0.2,0,0,1)]',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4',
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl',
                TONE_TILE[tone],
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id={labelId}
                className="text-[0.9375rem] font-semibold leading-tight tracking-tight text-foreground"
              >
                {title}
              </h2>
              {titleAdornment}
            </div>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </header>
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
