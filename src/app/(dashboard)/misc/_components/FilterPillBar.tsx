// Visual spec: _design-system/Misc Draws and Reports.html (.filter-row .pill)
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
              // .pill: height 32, padding 0 12, gap 6, radius full, fs 12.5
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors',
              active
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-foreground hover:bg-[var(--paper-2)]',
            )}
          >
            <span>{p.label}</span>
            {typeof p.count === 'number' && (
              <span
                className={cn(
                  'font-mono text-[10.5px] tabular-nums',
                  active ? 'text-background/60' : 'text-muted-foreground',
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
