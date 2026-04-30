// Visual spec: _design-system/invoices.html (.aging-bar in 4th KPI card)
import { cn } from '@/lib/utils';
import { formatCompactKES } from '@/lib/format';

export type AgingBuckets = {
  /** 0–30 days */
  current: number;
  /** 31–60 days */
  thirty: number;
  /** 61–90 days */
  sixty: number;
  /** 90+ days */
  ninety: number;
};

type AgingBucketsPanelProps = {
  buckets: AgingBuckets;
  className?: string;
};

type BucketTone = 'default' | 'warn' | 'danger';

const TONE_CLASS: Record<BucketTone, { wrap: string; val: string }> = {
  default: { wrap: 'bg-card', val: 'text-foreground' },
  warn: { wrap: 'bg-[var(--gold-soft)]', val: 'text-[var(--gold-lo)]' },
  danger: { wrap: 'bg-danger-soft', val: 'text-[var(--danger)]' },
};

function Bucket({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: BucketTone;
}) {
  const cls = TONE_CLASS[tone];
  return (
    <div className={cn('flex flex-col gap-1 px-2.5 py-2.5', cls.wrap)}>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono text-[13px] font-medium tabular-nums', cls.val)}>
        {formatCompactKES(value).replace('KES ', '')}
      </span>
    </div>
  );
}

export function AgingBucketsPanel({ buckets, className }: AgingBucketsPanelProps) {
  return (
    <div
      className={cn(
        // .aging-bar: 4-col grid with 1px gap that shows border-subtle
        'mt-2 grid grid-cols-4 gap-px overflow-hidden rounded-[var(--radius-sm)] bg-[var(--border-subtle)]',
        className,
      )}
    >
      <Bucket label="0–30" value={buckets.current} tone="default" />
      <Bucket label="31–60" value={buckets.thirty} tone="default" />
      <Bucket label="61–90" value={buckets.sixty} tone="warn" />
      <Bucket label="90+" value={buckets.ninety} tone="danger" />
    </div>
  );
}
