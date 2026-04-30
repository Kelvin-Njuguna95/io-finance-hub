import { cn } from '@/lib/utils';

export type FilterPill<TKey extends string = string> = {
  key: TKey;
  label: string;
  count?: number;
};

type FilterPillBarProps<TKey extends string = string> = {
  pills: ReadonlyArray<FilterPill<TKey>>;
  activeKey: TKey;
  onChange: (key: TKey) => void;
  className?: string;
};

export function FilterPillBar<TKey extends string = string>({
  pills,
  activeKey,
  onChange,
  className,
}: FilterPillBarProps<TKey>) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {pills.map((p) => {
        const active = p.key === activeKey;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
              'border',
              active
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground hover:bg-muted/40',
            )}
          >
            <span>{p.label}</span>
            {typeof p.count === 'number' && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums',
                  active
                    ? 'bg-background/15 text-background'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {p.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
