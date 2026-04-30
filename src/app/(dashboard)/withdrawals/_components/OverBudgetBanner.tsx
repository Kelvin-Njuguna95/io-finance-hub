// Visual spec: _design-system/withdrawals.html (.recon-banner shell, repurposed
// for over-budget detection — we don't have bank-vs-ledger reconciliation data)
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

type OverBudgetBannerProps = {
  overByKes: number;
  approvedBudgetKes: number;
  drawnKes: number;
  className?: string;
};

export function OverBudgetBanner({
  overByKes,
  approvedBudgetKes,
  drawnKes,
  className,
}: OverBudgetBannerProps) {
  return (
    <div
      className={cn(
        // .recon-banner shell: card bg, red 3px left rail, 4-col grid on desktop
        'grid items-center gap-7 rounded-[var(--radius-lg)] border border-border bg-card px-6 py-5',
        'border-l-[3px] border-l-[var(--danger)]',
        'lg:grid-cols-[1.4fr_1fr_1fr_auto]',
        className,
      )}
    >
      {/* Left: eyebrow + headline + body */}
      <div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--danger)]">
          <AlertTriangle className="size-3" strokeWidth={2} aria-hidden />
          Over-budget detected
        </span>
        <h2
          className="mt-2 font-display text-[19px] font-medium leading-[1.25] tracking-[-0.01em] text-foreground"
          style={{ fontVariationSettings: '"opsz" 32' }}
        >
          Withdrawals exceed approved budgets by{' '}
          <em className="font-normal italic" style={{ color: 'var(--gold-lo)' }}>
            {formatCompactKES(overByKes)}
          </em>
        </h2>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          Resolve the variance before recording further withdrawals — recall a budget or escalate to CFO review.
        </p>
      </div>

      {/* Middle: ledger pair */}
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Approved budgets
        </span>
        <span className="font-mono text-[22px] font-medium leading-none tabular-nums tracking-tight text-foreground">
          {formatCompactKES(approvedBudgetKes)}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Drawn so far
        </span>
        <span className="font-mono text-[22px] font-medium leading-none tabular-nums tracking-tight text-[var(--danger)]">
          {formatCompactKES(drawnKes)}
        </span>
      </div>

      {/* Right: actions */}
      <div className="flex flex-col gap-2">
        <Link href="/budgets">
          <Button size="sm" className="w-full">View budgets</Button>
        </Link>
        <Button size="sm" variant="ghost" className="w-full" disabled>
          Recall budget
        </Button>
      </div>
    </div>
  );
}
