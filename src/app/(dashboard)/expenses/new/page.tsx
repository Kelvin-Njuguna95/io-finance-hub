'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useUser } from '@/hooks/use-user';
import {
  useExpenseForm,
  type UseExpenseFormResult,
} from '@/hooks/use-expense-form';
import { PageTitle } from '@/components/layout/page-title';
import { formatYearMonth } from '@/lib/format';
import { getUserErrorMessage } from '@/lib/errors';
import {
  ExpenseForm,
  type ExpenseFormState,
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
  description: '',
  amount_kes: 0,
  expense_date: todayInNairobi(),
  project_id: '',
  selected_budget_idx: '',
  expense_category_id: '',
  vendor: '',
  receipt_reference: '',
};

export default function NewExpensePage() {
  const router = useRouter();
  const { user } = useUser();
  const options: UseExpenseFormResult = useExpenseForm();

  const [formState, setFormState] = useState<ExpenseFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);

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

  // Submit handler — body preserved verbatim from
  // src/components/expenses/expense-form-dialog.tsx lines 110–156.
  // The form is project-expense-only in the new full-page surface, so
  // expense_type / overhead_category_id resolve to fixed values; the
  // shape and column names of the insert are otherwise unchanged.
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

    if (!formState.project_id) {
      toast.error('Project is required for project expenses');
      return;
    }

    if (!user?.id) {
      toast.error('Session expired. Please log in again.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error } = await supabase.from('expenses').insert({
      budget_id: budget.budget_id,
      budget_version_id: budget.budget_version_id,
      expense_type: 'project_expense',
      project_id: formState.project_id,
      overhead_category_id: null,
      expense_category_id: formState.expense_category_id || null,
      description: formState.description,
      amount_usd: 0,
      amount_kes: formState.amount_kes,
      expense_date: formState.expense_date,
      year_month: options.yearMonth,
      vendor: formState.vendor || null,
      receipt_reference: formState.receipt_reference || null,
      notes: null,
      entered_by: user.id,
    });

    if (error) {
      toast.error(getUserErrorMessage(error));
      setSubmitting(false);
      return;
    }

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
      loading: options.loading,
    }),
    [
      options.approvedBudgets,
      options.projects,
      options.categories,
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
          options={formOptions}
          submitting={submitting}
          onDiscard={handleDiscard}
          onSubmit={handleSave}
        />
      </div>
    </div>
  );
}
