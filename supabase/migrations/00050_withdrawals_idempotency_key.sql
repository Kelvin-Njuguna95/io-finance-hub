-- ===========================================================================
-- 00050_withdrawals_idempotency_key.sql
--
-- Adds duplicate-submission protection to the withdrawals table. Same
-- shape as 00047 (payments). See that file's header for incident context.
--
-- Forms populating this column:
--   • src/components/withdrawals/withdrawal-form-dialog.tsx (Record Withdrawal)
--     → POST /api/withdrawals/create → fn_withdrawal_record RPC
--
-- The RPC currently inserts the withdrawal row directly. The wiring
-- commit will extend the RPC's parameter list (or accept the key via the
-- payload, depending on the chosen approach in the wiring step) so the
-- INSERT picks up the column. The migration here only adds the column +
-- index; no function-body change.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_idempotency_key
  ON public.withdrawals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.withdrawals.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
