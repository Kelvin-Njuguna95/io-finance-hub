-- ===========================================================================
-- 00048_invoices_idempotency_key.sql
--
-- Adds duplicate-submission protection to the invoices table. Same shape
-- as 00047 (payments). See that file's header for the incident context
-- and pattern rationale.
--
-- Forms populating this column:
--   • src/components/revenue/invoice-form-dialog.tsx        (Create Invoice)
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_idempotency_key
  ON public.invoices (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.invoices.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
