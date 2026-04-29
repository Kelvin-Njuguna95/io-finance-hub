'use client';

import { cn } from '@/lib/utils';

/**
 * Filter pill with a count badge — the small pill row used above lists
 * (budgets, expenses) for status filtering. Lifted from the inline
 * definition in budgets/page.tsx (Phase 3a) so list pages share the
 * primitive.
 */

export type FilterPillProps = {
  label: string;
  count: number;
  active: boolean;
  onClick(): void;
  className?: string;
};

export function FilterPill({
  label,
  count,
  active,
  onClick,
  className,
}: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:bg-muted/40',
        className,
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
          active ? 'bg-background/15 text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
