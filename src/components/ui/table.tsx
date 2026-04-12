'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Finance Hub table primitives.
 *
 * The IO brand table look (navy header, zebra rows, subtle brand hover)
 * is baked into these components and driven entirely by design tokens.
 *
 * Phase 2 removes the equivalent global !important overrides from
 * globals.css in the same commit, so no existing table surface loses
 * its styling.
 */

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto rounded-lg ring-1 ring-border -webkit-overflow-scrolling-touch"
    >
      <table
        data-slot="table"
        className={cn(
          'w-full caption-bottom text-sm tabular-nums',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        '[&_tr]:border-b [&_tr]:border-primary/30',
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        // Zebra with a very subtle brand tint
        '[&_tr]:border-b [&_tr]:border-border-subtle',
        '[&_tr:nth-child(even)]:bg-[color-mix(in_oklab,var(--primary)_2.5%,transparent)]',
        '[&_tr:last-child]:border-0',
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'border-t bg-muted/60 font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'transition-colors duration-[var(--dur-fast)]',
        // Brand-tinted hover; preserves row height (no border layout shift)
        'hover:bg-[color-mix(in_oklab,var(--primary)_5%,transparent)]',
        'has-aria-expanded:bg-[color-mix(in_oklab,var(--primary)_6%,transparent)]',
        'data-[state=selected]:bg-[color-mix(in_oklab,var(--primary)_8%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-3 text-left align-middle whitespace-nowrap',
        'bg-primary text-primary-foreground',
        'text-[0.78rem] font-semibold uppercase tracking-wide',
        'first:rounded-tl-lg last:rounded-tr-lg',
        'sticky top-0 z-10',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'px-3 py-2.5 align-middle whitespace-nowrap text-foreground/90',
        '[&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
