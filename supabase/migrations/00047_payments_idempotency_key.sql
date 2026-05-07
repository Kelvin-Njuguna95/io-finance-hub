-- ===========================================================================
-- 00047_payments_idempotency_key.sql
--
-- Adds defense-in-depth duplicate-submission protection to the payments
-- table. Triggered by an incident where a single payment-form click
-- recorded two payments rows for invoice AIFI A1 (USD 22,803.90 and
-- USD 22,804.00, 54 seconds apart) — UI-level button disabling did not
-- prevent the duplicate.
--
-- Forms populating this column (after the corresponding code commits land):
--   • src/components/revenue/payment-form-dialog.tsx       (Record Payment)
--   • src/app/(dashboard)/revenue/page.tsx                  (inline invoice payment)
--
-- Pattern:
--   • Column is NULL-able so historical rows are not affected.
--   • Partial unique index enforces uniqueness only when the key is set,
--     which means a second INSERT carrying the same key fails at the DB
--     level with SQLSTATE 23505 (unique_violation). The route catches
--     that, looks up the row by key, and returns the original record.
--   • IF NOT EXISTS guards make this script safe to re-paste.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
--
-- Drift caveat (per AGENTS.md): verify the live column does not already
-- exist (e.g. via prior manual ad-hoc work) before applying. The IF NOT
-- EXISTS clauses below tolerate that, but a name collision on a
-- different-typed pre-existing column would surface as a separate error.
-- ===========================================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key
  ON public.payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.payments.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
