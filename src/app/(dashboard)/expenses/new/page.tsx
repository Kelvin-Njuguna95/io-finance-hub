'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import { useIdempotencyKey } from '@/hooks/use-idempotency-key';
import {
  useExpenseForm,
  type UseExpenseFormResult,
} from '@/hooks/use-expense-form';
import { PageTitle } from '@/components/layout/page-title';
import { formatYearMonth } from '@/lib/format';
import { getUserErrorMessage } from '@/lib/errors';
import { isIdempotencyConflict } from '@/lib/idempotency';
import { fireDuplicateBlocked } from '@/lib/audit-duplicate-blocked';
import {
  ExpenseForm,
  type ExpenseFormState,
  type ExpenseTypeKind,
} from '@/components/expenses/expense-form';

const NAIROBI_TZ = 'Africa/Nairobi';

function todayInNairobi(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NAIROBI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const INITIAL_STATE: ExpenseFormState = {
  expense_type: 'project_expense',
  description: '',
  amount_kes: 0,
  expense_date: todayInNairobi(),
  project_id: '',
  selected_budget_idx: '',
  expense_category_id: '',
  overhead_category_id: '',
  vendor: '',
  receipt_reference: '',
};

export default function NewExpensePage() {
  const router = useRouter();
  const { user } = useUser();
  const options: UseExpenseFormResult = useExpenseForm();

  const [formState, setFormState] = useState<ExpenseFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  // Page navigates away on success (router.push) so the next visit
  // remounts and gets a fresh key — no manual regenerate needed.
  const [idempotencyKey] = useIdempotencyKey();

  // Refresh today's date if the user keeps the page open across midnight
  // (Nairobi). Cheap effect — runs once on mount.
  useEffect(() => {
    setFormState((prev) =>
      prev.expense_date === '' ? { ...prev, expense_date: todayInNairobi() } : prev,
    );
  }, []);

  function onChange<K extends keyof ExpenseFormState>(
    field: K,
    value: ExpenseFormState[K],
  ) {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }

  // Toggle expense type and clear stale fields from the previous mode so
  // the submit payload only carries values relevant to the new mode.
  function onTypeChange(next: ExpenseTypeKind) {
    setFormState((prev) => ({
      ...prev,
      expense_type: next,
      project_id: '',
      selected_budget_idx: '',
      expense_category_id: '',
      overhead_category_id: '',
    }));
  }

  // Submit handler — branches on expense_type to match the legacy
  // ExpenseFormDialog's exact insert shape (see expense-form-dialog.tsx
  // lines 129–145):
  //   project_expense  → project_id set, overhead_category_id null,
  //                      expense_category_id from the category select.
  //   shared_expense   → project_id null, overhead_category_id from the
  //                      category select, expense_category_id null
  //                      (the dialog allowed a secondary expense_category
  //                      pick in shared mode; the redesigned single
  //                      Category select drops that affordance).
  async function handleSave() {
    if (!formState.description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (!formState.selected_budget_idx) {
      toast.error('Please select a budget');
      return;
    }

    const budget =
      options.approvedBudgets[Number(formState.selected_budget_idx)];
    if (!budget) {
      toast.error('Invalid budget selection');
      return;
    }

    if (formState.expense_type === 'project_expense' && !formState.project_id) {
      toast.error('Project is required for project expenses');
      return;
    }
    if (
      formState.expense_type === 'shared_expense' &&
      !formState.overhead_category_id
    ) {
      toast.error('Overhead category is required for shared expenses');
      return;
    }

    if (!user?.id) {
      toast.error('Session expired. Please log in again.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const isShared = formState.expense_type === 'shared_expense';

    const { error } = await supabase.from('expenses').insert({
      budget_id: budget.budget_id,
      budget_version_id: budget.budget_version_id,
      expense_type: formState.expense_type,
      project_id: isShared ? null : formState.project_id,
      overhead_category_id: isShared ? formState.overhead_category_id : null,
      expense_category_id: isShared
        ? null
        : formState.expense_category_id || null,
      description: formState.description,
      amount_usd: 0,
      amount_kes: formState.amount_kes,
      expense_date: formState.expense_date,
      year_month: options.yearMonth,
      vendor: formState.vendor || null,
      receipt_reference: formState.receipt_reference || null,
      notes: null,
      entered_by: user.id,
      idempotency_key: idempotencyKey,
    });

    if (error && !isIdempotencyConflict(error)) {
      toast.error(getUserErrorMessage(error));
      setSubmitting(false);
      return;
    }

    if (error && isIdempotencyConflict(error)) {
      // IDEMP-4..IDEMP-10: client-direct insert can't write to
      // audit_logs (RLS), so fire telemetry server-side via the
      // dedicated route. Fire-and-forget; user-facing UX unchanged.
      void fireDuplicateBlocked('expenses', idempotencyKey);
    }

    // Either fresh insert succeeded, or a prior attempt with this key
    // already created the row — same outcome from the user's view.
    toast.success('Expense recorded');
    router.push('/expenses');
  }

  function handleDiscard() {
    router.push('/expenses');
  }

  const formOptions = useMemo(
    () => ({
      approvedBudgets: options.approvedBudgets,
      projects: options.projects,
      categories: options.categories,
      overheadCategories: options.overheadCategories,
      loading: options.loading,
    }),
    [
      options.approvedBudgets,
      options.projects,
      options.categories,
      options.overheadCategories,
      options.loading,
    ],
  );

  return (
    <div>
      <div className="border-b border-border/70 bg-background px-6 py-6">
        <PageTitle
          primary="Record expense"
          accent="draft"
          subtitle={`New entry · ${formatYearMonth(options.yearMonth)}`}
        />
      </div>

      <div className="p-6">
        <ExpenseForm
          formState={formState}
          onChange={onChange}
          onTypeChange={onTypeChange}
          options={formOptions}
          submitting={submitting}
          onDiscard={handleDiscard}
          onSubmit={handleSave}
        />
      </div>
    </div>
  );
}
