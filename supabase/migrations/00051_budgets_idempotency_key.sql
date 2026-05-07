-- ===========================================================================
-- 00051_budgets_idempotency_key.sql
--
-- Adds duplicate-submission protection to the budgets table. Same shape
-- as 00047 (payments). See that file's header for incident context.
--
-- Form populating this column:
--   • src/app/(dashboard)/budgets/new/page.tsx              (Create Budget)
--     → POST /api/budgets/create
--
-- Important: budget creation is a two-step write — the route inserts the
-- parent `budgets` row, then a separate INSERT on `budget_items`. We are
-- NOT adding an idempotency_key column to budget_items. The wiring
-- commit will detect a duplicate parent attempt at the budgets-INSERT
-- step, fetch the existing parent by idempotency_key, and SKIP the
-- budget_items INSERT entirely (the items were inserted on the first
-- successful attempt). This is recorded explicitly in the route commit.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_idempotency_key
  ON public.budgets (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.budgets.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed. Parent-only — budget_items is protected indirectly by skipping the items INSERT when the parent is detected as a duplicate.';
