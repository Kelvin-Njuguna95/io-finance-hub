-- ===========================================================================
-- 00049_expenses_idempotency_key.sql
--
-- Adds duplicate-submission protection to the expenses table. Same shape
-- as 00047 (payments). See that file's header for incident context.
--
-- Forms populating this column:
--   • src/components/expenses/expense-form-dialog.tsx       (Record Expense dialog)
--   • src/app/(dashboard)/expenses/new/page.tsx              (New Expense page)
--   • src/app/(dashboard)/misc/page.tsx                      (misc-page expense create at ~line 2863)
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idempotency_key
  ON public.expenses (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.expenses.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
