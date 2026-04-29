'use client';

import { Paperclip, Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  ApprovedBudgetOption,
  CategoryOption,
} from '@/hooks/use-expense-form';
import type { Project } from '@/types/database';

/**
 * Pure presentational form body for /expenses/new.
 *
 * Two cards — Receipt & vendor / Amount & allocation — plus a sticky
 * footer with Discard + Record expense.
 *
 * Receipt placeholder is a static dashed box; D1 defers actual file
 * upload. The receipt_reference text input below stays the canonical
 * way to attach a receipt for now.
 */

export type ExpenseTypeKind = 'project_expense' | 'shared_expense';

export type ExpenseFormState = {
  expense_type: ExpenseTypeKind;
  description: string;
  amount_kes: number;
  expense_date: string;
  project_id: string;
  selected_budget_idx: string;
  expense_category_id: string;
  /** Selected overhead category FK — only used when expense_type='shared_expense'. */
  overhead_category_id: string;
  vendor: string;
  receipt_reference: string;
};

export type ExpenseFormOptions = {
  approvedBudgets: ApprovedBudgetOption[];
  projects: Project[];
  categories: CategoryOption[];
  /** Overhead categories list (rent, utilities, software, etc.) — sourced
   *  from the `overhead_categories` table. Used as the Category select
   *  source when `expense_type === 'shared_expense'`. */
  overheadCategories: CategoryOption[];
  loading: boolean;
};

type ExpenseFormProps = {
  formState: ExpenseFormState;
  onChange<K extends keyof ExpenseFormState>(
    field: K,
    value: ExpenseFormState[K],
  ): void;
  /** Toggle between project_expense and shared_expense. The page route
   *  uses this to clear stale state from the previous mode (project_id,
   *  budget selection, the inactive category) so submit only carries
   *  what's relevant. */
  onTypeChange(next: ExpenseTypeKind): void;
  options: ExpenseFormOptions;
  submitting: boolean;
  onDiscard(): void;
  onSubmit(): void;
  className?: string;
};

export function ExpenseForm({
  formState,
  onChange,
  onTypeChange,
  options,
  submitting,
  onDiscard,
  onSubmit,
  className,
}: ExpenseFormProps) {
  const isShared = formState.expense_type === 'shared_expense';

  // Budget options — for project mode, narrow to the selected project's
  // approved budgets. For shared mode, show all approved budgets for the
  // month regardless of project (matches the dialog's behavior — shared
  // expenses still need a budget linkage but it can be a department-level
  // one).
  const filteredBudgets = isShared
    ? options.approvedBudgets
    : formState.project_id
      ? options.approvedBudgets.filter(
          (b) => b.project_id === formState.project_id,
        )
      : options.approvedBudgets;

  const categorySource = isShared
    ? options.overheadCategories
    : options.categories;

  const canSubmit =
    !submitting &&
    formState.description.trim().length > 0 &&
    formState.amount_kes > 0 &&
    formState.selected_budget_idx.length > 0 &&
    (isShared
      ? formState.overhead_category_id.length > 0
      : formState.project_id.length > 0);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Card 1 — Receipt & vendor */}
      <section className="rounded-lg border border-border bg-card p-6">
        <header className="mb-4">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Receipt · vendor
          </p>
          <h2 className="mt-1.5 font-display text-[17px] font-medium text-foreground">
            Receipt &amp; vendor
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
            Attach a receipt reference and identify who you paid.
          </p>
        </header>

        {/* Receipt placeholder — deliberately static (D1) */}
        <div
          aria-hidden
          className="mb-5 grid grid-cols-[64px_1fr] items-center gap-4 rounded-[var(--radius)] border border-dashed border-[var(--paper-4)] bg-[var(--paper-2)] p-5"
        >
          <span className="flex size-16 items-center justify-center rounded-[var(--radius)] border border-border-subtle bg-card text-[var(--gold-lo)]">
            <Paperclip className="size-6" strokeWidth={1.75} />
          </span>
          <div>
            <p className="font-display text-[15px] font-medium text-foreground">
              Receipt upload coming soon
            </p>
            <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
              Paste a receipt reference in the field below for now.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Field label="Receipt reference">
            <Input
              value={formState.receipt_reference}
              onChange={(e) => onChange('receipt_reference', e.target.value)}
              placeholder="e.g. Naivas receipt #4218"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor / payee">
              <Input
                value={formState.vendor}
                onChange={(e) => onChange('vendor', e.target.value)}
                placeholder="Who was paid?"
              />
            </Field>
            <Field label="Date paid">
              <Input
                type="date"
                value={formState.expense_date}
                onChange={(e) => onChange('expense_date', e.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Card 2 — Amount & allocation */}
      <section className="rounded-lg border border-border bg-card p-6">
        <header className="mb-4">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Amount · allocation
          </p>
          <h2 className="mt-1.5 font-display text-[17px] font-medium text-foreground">
            Amount &amp; allocation
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
            What was this for?
          </p>
        </header>

        <div className="space-y-4">
          {/* Type toggle — Project / Shared */}
          <Field label="Expense type" required>
            <div
              role="group"
              aria-label="Expense type"
              className="inline-flex rounded-full border border-border bg-card p-0.5"
            >
              <button
                type="button"
                onClick={() => onTypeChange('project_expense')}
                className={cn(
                  'h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors',
                  !isShared
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Project expense
              </button>
              <button
                type="button"
                onClick={() => onTypeChange('shared_expense')}
                className={cn(
                  'h-8 rounded-full px-3.5 text-[12px] font-medium transition-colors',
                  isShared
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Shared expense
              </button>
            </div>
            {isShared && (
              <p className="text-[11.5px] text-muted-foreground">
                Shared overhead — rent, utilities, software. No project link.
              </p>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (KES)" required>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={formState.amount_kes || ''}
                onChange={(e) =>
                  onChange('amount_kes', parseFloat(e.target.value) || 0)
                }
                className="font-mono tabular-nums"
              />
            </Field>
            {!isShared && (
              <Field label="Project" required>
                <Select
                  value={formState.project_id || undefined}
                  onValueChange={(v) => {
                    if (!v) return;
                    onChange('project_id', v);
                    // Reset budget when project changes — current selection
                    // may belong to a different project.
                    onChange('selected_budget_idx', '');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <Field
            label="Approved budget"
            required
            help={
              !isShared && formState.project_id && filteredBudgets.length === 0
                ? 'No approved budgets for this project this month'
                : isShared && filteredBudgets.length === 0
                  ? 'No approved budgets for this month'
                  : undefined
            }
          >
            <Select
              value={formState.selected_budget_idx || undefined}
              onValueChange={(v) => v && onChange('selected_budget_idx', v)}
              disabled={
                isShared
                  ? filteredBudgets.length === 0
                  : !formState.project_id || filteredBudgets.length === 0
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    isShared
                      ? 'Select an approved budget'
                      : formState.project_id
                        ? 'Select an approved budget'
                        : 'Pick a project first'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {filteredBudgets.map((b) => {
                  // Index reference must point into the unfiltered options
                  // array so the page route's verbatim insert resolves
                  // the correct budget on submit.
                  const idx = options.approvedBudgets.findIndex(
                    (o) => o.budget_id === b.budget_id,
                  );
                  return (
                    <SelectItem key={b.budget_id} value={String(idx)}>
                      {b.scope_name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label={isShared ? 'Overhead category' : 'Category'}
            required={isShared}
          >
            <Select
              value={
                isShared
                  ? formState.overhead_category_id || undefined
                  : formState.expense_category_id || undefined
              }
              onValueChange={(v) => {
                if (!v) return;
                if (isShared) onChange('overhead_category_id', v);
                else onChange('expense_category_id', v);
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={isShared ? 'Select…' : 'Optional…'}
                />
              </SelectTrigger>
              <SelectContent>
                {categorySource.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Description" required>
            <Textarea
              value={formState.description}
              onChange={(e) => onChange('description', e.target.value)}
              placeholder="What this paid for, in plain language."
              rows={3}
            />
          </Field>
        </div>
      </section>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-10 -mx-6 mt-2 border-t border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={submitting}
            className="gap-1"
          >
            <X className="size-4" /> Discard
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="gap-1"
          >
            <Save className="size-4" /> Record expense
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12.5px] font-medium">
        {label}
        {required && (
          <span className="ml-0.5 text-danger-soft-foreground">*</span>
        )}
      </Label>
      {children}
      {help && <p className="text-[11.5px] text-muted-foreground">{help}</p>}
    </div>
  );
}
