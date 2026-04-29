'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getActiveProjects } from '@/lib/queries/projects';
import { getCurrentYearMonth } from '@/lib/format';
import type { Project } from '@/types/database';

/**
 * Read-side composer for the new-expense form.
 *
 * Reproduces the queries currently run inside `ExpenseFormDialog`'s
 * `useEffect` block (src/components/expenses/expense-form-dialog.tsx
 * lines 57–93) — same shape, same filters. The dialog is being
 * superseded by the full-page route, but the queries are preserved
 * verbatim so server-side semantics (RLS, the
 * `fn_validate_expense_budget` trigger, approved-budgets-only) keep
 * working without change.
 */

export type ApprovedBudgetOption = {
  budget_id: string;
  budget_version_id: string;
  scope_name: string;
  project_id: string | null;
  department_id: string | null;
};

export type CategoryOption = { id: string; name: string };

export type UseExpenseFormResult = {
  approvedBudgets: ApprovedBudgetOption[];
  projects: Project[];
  categories: CategoryOption[];
  overheadCategories: CategoryOption[];
  yearMonth: string;
  loading: boolean;
};

export function useExpenseForm(): UseExpenseFormResult {
  const [approvedBudgets, setApprovedBudgets] = useState<ApprovedBudgetOption[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [overheadCategories, setOverheadCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const yearMonth = getCurrentYearMonth();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();

      // Get approved budgets for current month.
      const { data: budgetData } = await supabase
        .from('budgets')
        .select(
          `
          id, project_id, department_id,
          projects(name), departments(name),
          budget_versions!inner(id, status)
        `,
        )
        .eq('year_month', yearMonth)
        .eq('budget_versions.status', 'approved');

      if (cancelled) return;

      const mapped: ApprovedBudgetOption[] = (budgetData ?? []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (b: any) => ({
          budget_id: b.id as string,
          budget_version_id:
            ((b.budget_versions as Array<Record<string, unknown>>)?.[0]?.id as string) ||
            '',
          scope_name:
            ((b.projects as Record<string, unknown>)?.name as string) ||
            ((b.departments as Record<string, unknown>)?.name as string) ||
            '—',
          project_id: (b.project_id as string | null) ?? null,
          department_id: (b.department_id as string | null) ?? null,
        }),
      );

      const [projRes, ohRes, ecRes] = await Promise.all([
        getActiveProjects(supabase),
        supabase
          .from('overhead_categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('expense_categories')
          .select('id, name')
          .eq('is_active', true)
          .order('name'),
      ]);

      if (cancelled) return;

      setApprovedBudgets(mapped);
      setProjects((projRes.data ?? []) as Project[]);
      setOverheadCategories((ohRes.data ?? []) as CategoryOption[]);
      setCategories((ecRes.data ?? []) as CategoryOption[]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [yearMonth]);

  return {
    approvedBudgets,
    projects,
    categories,
    overheadCategories,
    yearMonth,
    loading,
  };
}
