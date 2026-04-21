import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Small uppercase label above the title (e.g. "Finance · Reports"). */
  eyebrow?: string;
  /** Optional icon rendered in a tinted tile on the left. */
  icon?: LucideIcon;
  /** Tone for the icon tile + eyebrow accent. */
  tone?:
    | 'brand'
    | 'success'
    | 'warning'
    | 'danger'
    | 'info';
  /** Pills rendered below the title — month chips, status, counts. */
  meta?: React.ReactNode;
  /** Right-aligned actions (buttons, selects). */
  children?: React.ReactNode;
  className?: string;
};

const TONE_STYLES: Record<NonNullable<PageHeaderProps['tone']>, string> = {
  brand:
    'bg-primary/10 text-primary ring-1 ring-inset ring-primary/15',
  success:
    'bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/20',
  warning:
    'bg-warning-soft text-warning-soft-foreground ring-1 ring-inset ring-warning/30',
  danger:
    'bg-danger-soft text-danger-soft-foreground ring-1 ring-inset ring-danger/20',
  info:
    'bg-info-soft text-info-soft-foreground ring-1 ring-inset ring-info/20',
};

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  tone = 'brand',
  meta,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-border/70 bg-background px-6 py-5',
        'md:flex-row md:items-center md:justify-between md:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg',
              TONE_STYLES[tone],
            )}
          >
            <Icon strokeWidth={1.75} className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
          {meta && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {meta}
            </div>
          )}
        </div>
      </div>
      {children && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      )}
    </header>
  );
}
