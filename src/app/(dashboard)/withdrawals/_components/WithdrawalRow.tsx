// Visual spec: _design-system/withdrawals.html (.list-row.lr-wd)
// 7-col grid: Date / Description / Director-or-Project / Type / Bureau / Amount / Actions
import { cn } from '@/lib/utils';
import { formatCompactKES, formatCurrency } from '@/lib/format';
import type { Withdrawal } from '@/types/database';

import { DateCell } from './DateCell';
import { DirectorCell } from './DirectorCell';
import { MethodPill } from './MethodPill';

const ROW_GRID =
  'grid grid-cols-[100px_1.7fr_0.9fr_0.9fr_1fr_180px_60px] items-center gap-4';

export function WithdrawalRowHead() {
  return (
    <div
      className={cn(
        ROW_GRID,
        'border-b border-border bg-[var(--paper-2)] px-5 py-3',
        'font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground',
      )}
    >
      <div>Date</div>
      <div>Request</div>
      <div>Director · Project</div>
      <div>Type</div>
      <div>Method</div>
      <div className="text-right">Amount</div>
      <div />
    </div>
  );
}

type WithdrawalWithJoin = Withdrawal & { projects?: { name?: string | null } | null };

type WithdrawalRowProps = {
  withdrawal: WithdrawalWithJoin;
  actions?: React.ReactNode;
  className?: string;
};

function TypePill({ kind }: { kind: 'director_payout' | 'operations' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]',
        kind === 'director_payout'
          ? 'bg-[var(--gold-soft)] text-[oklch(0.40_0.10_75)]'
          : 'bg-[var(--paper-3)] text-foreground',
      )}
    >
      {kind === 'director_payout' ? 'Director Payout' : 'Operations'}
    </span>
  );
}

function rateLabel(rate: number | string | null | undefined): string | null {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function WithdrawalRow({ withdrawal: w, actions, className }: WithdrawalRowProps) {
  const isDirectorPayout = w.withdrawal_type === 'director_payout';
  const projectName = w.projects?.name || null;
  const rateText = rateLabel(w.exchange_rate);
  const description = (() => {
    if (isDirectorPayout) {
      return w.director_name
        ? `${w.director_name} — Profit Share Payout`
        : 'Director Profit Share Payout';
    }
    return w.notes?.trim() || projectName || 'Company Operations';
  })();
  const subDescription = (() => {
    if (isDirectorPayout) {
      const seq = w.partial_payout_sequence != null ? ` · partial #${w.partial_payout_sequence}` : '';
      const ptype = w.payout_type === 'full' ? 'Full payout' : w.payout_type === 'partial' ? 'Partial payout' : 'Payout';
      return `${ptype}${seq}`;
    }
    if (w.notes && projectName) return projectName;
    return w.reference_id ? `Ref ${w.reference_id}` : null;
  })();

  return (
    <div className={cn(ROW_GRID, 'border-b border-border-subtle px-5 py-4 last:border-b-0', className)}>
      {/* 1. Date */}
      <DateCell date={w.withdrawal_date} />

      {/* 2. Description */}
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-foreground">{description}</div>
        {subDescription && (
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{subDescription}</div>
        )}
      </div>

      {/* 3. Director-or-Project */}
      <div className="min-w-0">
        {isDirectorPayout ? (
          <DirectorCell name={w.director_name} tag={w.director_tag} fallback={w.director_tag} />
        ) : (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">
              {projectName || 'Company Ops'}
            </div>
            {w.director_tag && (
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {w.director_tag}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Type */}
      <div>
        <TypePill kind={isDirectorPayout ? 'director_payout' : 'operations'} />
      </div>

      {/* 5. Method (bureau) */}
      <div className="min-w-0">
        <MethodPill bureau={w.forex_bureau} />
      </div>

      {/* 6. Amount */}
      <div className="text-right">
        <div className="font-mono text-[14px] font-medium tabular-nums text-foreground">
          {formatCurrency(Number(w.amount_usd || 0), 'USD')}
        </div>
        <div className="mt-0.5 font-mono text-[11.5px] tabular-nums text-muted-foreground">
          ≈ {formatCompactKES(Number(w.amount_kes || 0))}
        </div>
        {rateText && (
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            @ {rateText}
          </div>
        )}
      </div>

      {/* 7. Actions */}
      <div className="flex justify-end">{actions}</div>
    </div>
  );
}
