-- ===========================================================================
-- 00052_misc_draws_idempotency_key.sql
--
-- Adds duplicate-submission protection to the misc_draws table. Same shape
-- as 00047 (payments). See that file's header for incident context.
--
-- Forms populating this column:
--   • src/app/(dashboard)/misc/page.tsx                     (multiple actions)
--     → POST /api/misc-draws (multiple distinct INSERT paths within the
--       same route handler, switched on the request body's `kind`/`action`)
--
-- Each calling form scope on the misc page generates its own
-- idempotency_key via useIdempotencyKey(). Re-clicking a single button is
-- protected; switching to a different action's form yields a fresh key.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================

ALTER TABLE public.misc_draws
  ADD COLUMN IF NOT EXISTS idempotency_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_misc_draws_idempotency_key
  ON public.misc_draws (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.misc_draws.idempotency_key IS
  'Client-generated UUID per form load. Prevents duplicate submissions: a second INSERT with the same key fails at the partial unique index. NULL allowed for legacy rows recorded before this column existed.';
