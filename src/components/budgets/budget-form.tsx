'use client';

import { AlertTriangle, Info, Save, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, formatYearMonth } from '@/lib/format';
import { ROLE_LABELS } from '@/types/database';
import {
  LineItemEditor,
  type LineItem,
} from '@/components/budgets/line-item-editor';

/**
 * Pure presentational form body for the new-budget page. All state is
 * owned by the page route (handleSave, checkExisting, checkMiscGate stay
 * upstream verbatim — D2 / spec §3 / Phase 3a-3 contract).
 */

export type ScopeKind = 'project' | 'department';

export type ScopeOption = {
  id: string;
  name: string;
};

export type ExistingBudgetSummary = {
  submitted_by_role: string;
  submitted_by_name: string;
  submitted_at: string;
  total_kes: number;
  status: string;
};

export type BudgetFormProps = {
  scopeOptions: {
    projects: ScopeOption[];
    departments: ScopeOption[];
    canCreateDepartment: boolean;
  };
  scope: { type: ScopeKind; id: string; yearMonth: string };
  onScopeChange(next: Partial<{ type: ScopeKind; id: string; yearMonth: string }>): void;
  /** Free-text "Description" — writes to budget_versions.notes. */
  notes: string;
  onNotesChange(value: string): void;
  items: LineItem[];
  categories: string[];
  lineItemHandlers: {
    onAdd(): void;
    onRemove(id: string): void;
    onUpdate(id: string, field: keyof LineItem, value: string | number): void;
  };
  existingBudgets: ExistingBudgetSummary[];
  miscGateBlocked: boolean;
  miscGateMessage: string;
  submitting: boolean;
  showScopeTypeToggle: boolean;
  /** Hint text under scope select — role-driven copy. */
  showFirstSubmitterNotice: boolean;
  onDiscard(): void;
  onSave(submit: boolean): void;
};

const MONTH_OPTIONS = 6;

export function BudgetForm({
  scopeOptions,
  scope,
  onScopeChange,
  notes,
  onNotesChange,
  items,
  categories,
  lineItemHandlers,
  existingBudgets,
  miscGateBlocked,
  miscGateMessage,
  submitting,
  showScopeTypeToggle,
  showFirstSubmitterNotice,
  onDiscard,
  onSave,
}: BudgetFormProps) {
  const activeOptions =
    scope.type === 'project'
      ? scopeOptions.projects
      : scopeOptions.departments;
  const selectedScopeName =
    activeOptions.find((s) => s.id === scope.id)?.name ?? '';

  return (
    <div className="space-y-6">
      {/* Card 1 — Budget basics */}
      <section className="rounded-lg border border-border bg-card p-6">
        <header className="mb-4">
          <h3 className="font-display text-[17px] font-medium text-foreground">
            Budget basics
          </h3>
          <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
            Pick the scope and period. The budget number is generated on submit.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {showScopeTypeToggle && (
            <div className="space-y-1.5">
              <Label>Scope type</Label>
              <Select
                value={scope.type}
                onValueChange={(v) => {
                  if (!v) return;
                  onScopeChange({
                    type: v as ScopeKind,
                    id: '',
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Project</SelectItem>
                  {scopeOptions.canCreateDepartment && (
                    <SelectItem value="department">Department</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{scope.type === 'project' ? 'Project' : 'Department'} *</Label>
            <Select
              value={scope.id || undefined}
              onValueChange={(v) => v && onScopeChange({ id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {activeOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select
              value={scope.yearMonth}
              onValueChange={(v) => v && onScopeChange({ yearMonth: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MONTH_OPTIONS }, (_, i) => {
                  const d = new Date();
                  d.setMonth(d.getMonth() + i);
                  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  return (
                    <SelectItem key={ym} value={ym}>
                      {formatYearMonth(ym)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Existing-budget warning (project scope) */}
        {scope.id && scope.type === 'project' && existingBudgets.length > 0 && (
          <div className="mt-4 space-y-1 rounded-lg border border-warning/30 bg-warning-soft/40 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-warning-soft-foreground">
              <AlertTriangle className="size-4" />
              {selectedScopeName} — {formatYearMonth(scope.yearMonth)}
            </div>
            <p className="text-sm text-warning-soft-foreground">
              Existing budgets this month:
            </p>
            {existingBudgets.map((eb, i) => (
              <p key={i} className="pl-2 text-sm text-warning-soft-foreground">
                — Submitted by <strong>{eb.submitted_by_name}</strong> (
                {ROLE_LABELS[eb.submitted_by_role as keyof typeof ROLE_LABELS] ??
                  eb.submitted_by_role}
                )
                {eb.status !== 'draft' && (
                  <>
                    {' '}
                    · {formatCurrency(eb.total_kes, 'KES')} · Status: {eb.status}
                  </>
                )}
              </p>
            ))}
            <p className="mt-1 text-xs text-warning-soft-foreground">
              Submitting yours will create an additional version. Both will be
              visible to the PM for review.
            </p>
          </div>
        )}

        {/* "First to submit" info */}
        {scope.id &&
          scope.type === 'project' &&
          existingBudgets.length === 0 &&
          showFirstSubmitterNotice && (
            <div className="mt-4 rounded-lg border border-info/40 bg-info-soft/40 p-3">
              <div className="flex items-center gap-2 text-sm text-info-soft-foreground">
                <Info className="size-4" />
                No budget submitted yet for this period. You are the first to
                submit.
              </div>
            </div>
          )}

        {/* Department info */}
        {scope.type === 'department' && scope.id && (
          <div className="mt-4 rounded-lg border border-info/40 bg-info-soft/40 p-3">
            <div className="flex items-center gap-2 text-sm text-info-soft-foreground">
              <Info className="size-4" />
              Department expenditures are classified as{' '}
              <strong>shared costs</strong> and will be distributed across
              projects during P&amp;L reporting.
            </div>
          </div>
        )}

        {/* Misc-gate warning */}
        {miscGateBlocked && (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft/40 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-danger-soft-foreground">
              <AlertTriangle className="size-4" />
              Submission blocked
            </div>
            <p className="mt-1 text-sm text-danger-soft-foreground">
              {miscGateMessage}
            </p>
          </div>
        )}

        {/* Description (writes to budget_versions.notes) */}
        <div className="mt-5 space-y-1.5">
          <Label htmlFor="budget-description">Description</Label>
          <Textarea
            id="budget-description"
            placeholder="What this budget pays for, written in sentence case."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={3}
          />
          <p className="text-[11.5px] text-[var(--warm-grey-3)]">
            Treasury register. No marketing voice.
          </p>
        </div>
      </section>

      {/* Card 2 — Line items */}
      <section className="rounded-lg border border-border bg-card p-6">
        <header className="mb-4">
          <h3 className="font-display text-[17px] font-medium text-foreground">
            Line items
          </h3>
          <p className="mt-1 text-[12.5px] text-[var(--warm-grey-3)]">
            Break the budget into categories. Each line is a quantity × unit
            cost.
          </p>
        </header>
        <LineItemEditor
          items={items}
          categories={categories}
          onAdd={lineItemHandlers.onAdd}
          onRemove={lineItemHandlers.onRemove}
          onUpdate={lineItemHandlers.onUpdate}
        />
      </section>

      {/* Sticky footer */}
      <div
        className="sticky bottom-0 z-10 -mx-6 mt-2 border-t border-border bg-background/95 px-6 py-3 backdrop-blur"
      >
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
            variant="outline"
            size="sm"
            onClick={() => onSave(false)}
            disabled={submitting}
            className="gap-1"
          >
            <Save className="size-4" /> Save as draft
          </Button>
          <Button
            size="sm"
            onClick={() => onSave(true)}
            disabled={submitting || miscGateBlocked}
            className="gap-1"
          >
            <Send className="size-4" /> Submit for approval
          </Button>
        </div>
      </div>
    </div>
  );
}
