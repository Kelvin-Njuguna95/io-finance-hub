-- ===========================================================================
-- 00053_director_payouts_idempotency_key.sql
--
-- Adds duplicate-submission protection to the director_payouts table.
-- Same shape as 00047 (payments). See that file's header for incident
-- context.
--
-- Form populating this column:
--   • src/components/common/payout-dialog.tsx               (Record Director Payout)
--     → POST /api/director-payouts (verified target table:
--       admin.from('director_payouts').insert at route line 86).
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.director_payouts
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_director_payouts_idempotency_key
  ON public.director_payouts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.director_payouts.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
