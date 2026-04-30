// Visual spec: _design-system/withdrawals.html (.method-pill)
import { Landmark } from 'lucide-react';

import { cn } from '@/lib/utils';

type MethodPillProps = {
  bureau?: string | null;
  className?: string;
};

export function MethodPill({ bureau, className }: MethodPillProps) {
  return (
    <span
      className={cn(
        // .method-pill: bg paper-2, border-subtle, mono 11px tracking 0.06em uppercase, py 4 px 10
        'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-subtle bg-[var(--paper-2)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-foreground',
        className,
      )}
    >
      <Landmark className="size-3 text-[var(--gold-lo)]" strokeWidth={1.75} aria-hidden />
      <span>Bank</span>
      {bureau && (
        <>
          <span aria-hidden className="text-muted-foreground">·</span>
          <span className="normal-case tracking-normal text-muted-foreground">{bureau}</span>
        </>
      )}
    </span>
  );
}
