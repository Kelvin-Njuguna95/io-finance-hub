'use client';

import { AlertCircle, Paperclip } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Inline receipt-state indicator on expense rows.
 *
 * "Receipt ref entered" → success tone with paperclip.
 * "No receipt · {N}h"   → danger tone with alert icon (N is hours since
 *                          the expense was created; pass undefined to
 *                          drop the time tail).
 */

type ReceiptIndicatorProps = {
  hasReference: boolean;
  hoursSinceCreated?: number;
  className?: string;
};

function formatAge(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ReceiptIndicator({
  hasReference,
  hoursSinceCreated,
  className,
}: ReceiptIndicatorProps) {
  if (hasReference) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.10em] text-success-soft-foreground',
          className,
        )}
      >
        <Paperclip className="size-[11px]" strokeWidth={1.75} aria-hidden />
        Receipt ref entered
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.10em] text-danger',
        className,
      )}
    >
      <AlertCircle className="size-[11px]" strokeWidth={1.75} aria-hidden />
      No receipt
      {typeof hoursSinceCreated === 'number' && (
        <span className="text-[var(--paper-4)]">·</span>
      )}
      {typeof hoursSinceCreated === 'number' && (
        <span>{formatAge(hoursSinceCreated)}</span>
      )}
    </span>
  );
}
