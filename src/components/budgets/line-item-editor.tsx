'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Inline-table line-item editor for the new-budget form.
 *
 * Columns: Category / Description / Quantity / Unit cost (KES) / Line total
 * / delete. Drops the design's "Type" column and "Import CSV" affordance
 * per D2 — neither has schema backing tonight.
 */

export type LineItem = {
  id: string;
  description: string;
  category: string;
  quantity: number;
  unit_cost_kes: number;
  notes: string;
};

type LineItemEditorProps = {
  items: LineItem[];
  categories: string[];
  onAdd(): void;
  onRemove(id: string): void;
  onUpdate(id: string, field: keyof LineItem, value: string | number): void;
  className?: string;
};

export function LineItemEditor({
  items,
  categories,
  onAdd,
  onRemove,
  onUpdate,
  className,
}: LineItemEditorProps) {
  const total = items.reduce(
    (s, i) => s + (i.quantity || 0) * (i.unit_cost_kes || 0),
    0,
  );

  return (
    <div className={cn('space-y-4', className)}>
      <div className="overflow-x-auto rounded-lg border border-border-subtle bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Category
              </th>
              <th className="px-3 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Description
              </th>
              <th className="px-3 py-2.5 text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Qty
              </th>
              <th className="px-3 py-2.5 text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Unit cost · KES
              </th>
              <th className="px-3 py-2.5 text-right font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Line total
              </th>
              <th aria-hidden className="w-[44px] px-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const lineTotal = (item.quantity || 0) * (item.unit_cost_kes || 0);
              return (
                <tr key={item.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="p-2 align-middle">
                    <Select
                      value={item.category || undefined}
                      onValueChange={(v) => v && onUpdate(item.id, 'category', v)}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2 align-middle">
                    <Input
                      value={item.description}
                      onChange={(e) =>
                        onUpdate(item.id, 'description', e.target.value)
                      }
                      placeholder="e.g. Translator licences"
                      className="h-9"
                    />
                  </td>
                  <td className="p-2 align-middle">
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        onUpdate(item.id, 'quantity', parseInt(e.target.value) || 1)
                      }
                      className="h-9 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="p-2 align-middle">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.unit_cost_kes || ''}
                      onChange={(e) =>
                        onUpdate(
                          item.id,
                          'unit_cost_kes',
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      className="h-9 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="p-2 text-right align-middle font-mono tabular-nums text-foreground">
                    {formatCurrency(lineTotal, 'KES')}
                  </td>
                  <td className="p-2 align-middle">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove line item"
                      className="size-7"
                      disabled={items.length <= 1}
                      onClick={() => onRemove(item.id)}
                    >
                      <Trash2 className="size-3.5 text-danger-soft-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-subtle">
              <td
                colSpan={4}
                className="p-3 text-right font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground"
              >
                Total · KES
              </td>
              <td className="p-3 text-right font-mono font-medium tabular-nums text-foreground">
                {formatCurrency(total, 'KES')}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-dashed border-[var(--paper-4)] bg-transparent px-3.5 py-2 text-[12.5px] text-[var(--warm-grey-3)] transition-colors hover:border-foreground hover:bg-muted/40 hover:text-foreground"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        Add line item
      </button>
    </div>
  );
}
