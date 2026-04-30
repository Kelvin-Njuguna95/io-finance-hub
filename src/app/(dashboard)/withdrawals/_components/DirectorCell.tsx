// Visual spec: _design-system/withdrawals.html (.director-cell)
import { cn } from '@/lib/utils';

type DirectorCellProps = {
  name?: string | null;
  tag?: string | null;
  fallback?: string | null;
  className?: string;
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] || '') + (parts[parts.length - 1]![0] || '')).toUpperCase();
}

export function DirectorCell({ name, tag, fallback, className }: DirectorCellProps) {
  const displayName = name || fallback || '—';
  const initials = name ? initialsFor(name) : (fallback ? initialsFor(fallback) : '—');
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] font-mono text-[10.5px] font-medium text-[var(--ink)]"
      >
        {initials}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium leading-[1.2] text-foreground">
          {displayName}
        </div>
        {tag && (
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {tag}
          </div>
        )}
      </div>
    </div>
  );
}
