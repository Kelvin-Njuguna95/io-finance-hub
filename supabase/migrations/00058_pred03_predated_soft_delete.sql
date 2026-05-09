-- ===========================================================================
-- 00058_pred03_predated_soft_delete.sql
--
-- Adds CFO-only soft-delete capability for predated payouts (both 70%
-- project share and 30% company pool streams). Predated records
-- represent real director payments — once recorded, they enter the
-- company's financial trail. Hard delete would create reconciliation
-- gaps. Soft delete with deleted_at + deleted_by + audit trail is the
-- right pattern.
--
-- Read-side queries (use-predated-payouts hook + EOD section queries)
-- must filter `deleted_at IS NULL` to hide soft-deleted rows. RLS
-- doesn't need a new policy — the SELECT policy from 00057 still
-- covers reads; soft-delete filtering happens at the query layer so a
-- CFO running raw dashboard SQL can still see deleted rows for
-- forensic recovery.
--
-- Re-applying this migration is safe: ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, and CREATE OR REPLACE FUNCTION are all
-- idempotent.
--
-- Apply via Supabase Dashboard → SQL Editor.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Schema — deleted_at + deleted_by on both tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.predated_payouts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id);

ALTER TABLE public.predated_company_share_distributions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id);


-- ---------------------------------------------------------------------------
-- 2. Indexes for the active-rows path (every read filters
-- `deleted_at IS NULL`).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_predated_payouts_active
  ON public.predated_payouts (recorded_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_predated_company_share_active
  ON public.predated_company_share_distributions (recorded_at DESC)
  WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- 3. Soft-delete RPCs (CFO-only, idempotent on already-deleted rows)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_soft_delete_predated_payout(
  p_caller_id UUID,
  p_record_id UUID
) RETURNS public.predated_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_role public.user_role;
  v_existing public.predated_payouts;
  v_updated public.predated_payouts;
BEGIN
  -- CFO only. Tighter than the recording RPC's CFO+Accountant gate
  -- because deleting a recorded payment is more sensitive than
  -- recording one.
  SELECT role INTO v_caller_role FROM public.users WHERE id = p_caller_id;
  IF v_caller_role <> 'cfo'::public.user_role THEN
    RAISE EXCEPTION 'Only CFO can delete predated payouts'
      USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_existing FROM public.predated_payouts WHERE id = p_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Predated payout % not found', p_record_id
      USING ERRCODE='P0001';
  END IF;

  -- Idempotent on already-deleted: return current state without
  -- writing a second audit row. Lets retry-on-network-error be safe.
  IF v_existing.deleted_at IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  UPDATE public.predated_payouts
     SET deleted_at = now(),
         deleted_by = p_caller_id
   WHERE id = p_record_id
   RETURNING * INTO v_updated;

  -- Audit row carries the full pre-delete state in old_values so a
  -- service-role restore (UPDATE … SET deleted_at = NULL) has all the
  -- forensic context needed for reconciliation.
  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, old_values, new_values
  ) VALUES (
    p_caller_id,
    'predated_payout_deleted',
    'predated_payouts',
    p_record_id,
    jsonb_build_object(
      'director_user_id', v_existing.director_user_id,
      'project_id', v_existing.project_id,
      'year_month', v_existing.year_month,
      'amount_kes', v_existing.amount_kes,
      'payment_method', v_existing.payment_method,
      'recorded_at', v_existing.recorded_at,
      'recorded_by', v_existing.recorded_by
    ),
    jsonb_build_object(
      'deleted_at', v_updated.deleted_at,
      'deleted_by', v_updated.deleted_by
    )
  );

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.fn_soft_delete_predated_payout(UUID, UUID) IS
  'CFO-only soft delete of a predated_payouts row. Idempotent on already-deleted rows. Writes a predated_payout_deleted audit_logs entry with the full pre-delete state in old_values for restore forensics.';


CREATE OR REPLACE FUNCTION public.fn_soft_delete_predated_company_share(
  p_caller_id UUID,
  p_record_id UUID
) RETURNS public.predated_company_share_distributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_role public.user_role;
  v_existing public.predated_company_share_distributions;
  v_updated public.predated_company_share_distributions;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = p_caller_id;
  IF v_caller_role <> 'cfo'::public.user_role THEN
    RAISE EXCEPTION 'Only CFO can delete predated company-share distributions'
      USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_existing FROM public.predated_company_share_distributions WHERE id = p_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Predated company-share distribution % not found', p_record_id
      USING ERRCODE='P0001';
  END IF;

  IF v_existing.deleted_at IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  UPDATE public.predated_company_share_distributions
     SET deleted_at = now(),
         deleted_by = p_caller_id
   WHERE id = p_record_id
   RETURNING * INTO v_updated;

  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, old_values, new_values
  ) VALUES (
    p_caller_id,
    'predated_company_share_deleted',
    'predated_company_share_distributions',
    p_record_id,
    jsonb_build_object(
      'director_user_id', v_existing.director_user_id,
      'year_month', v_existing.year_month,
      'amount_kes', v_existing.amount_kes,
      'payment_method', v_existing.payment_method,
      'recorded_at', v_existing.recorded_at,
      'recorded_by', v_existing.recorded_by
    ),
    jsonb_build_object(
      'deleted_at', v_updated.deleted_at,
      'deleted_by', v_updated.deleted_by
    )
  );

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.fn_soft_delete_predated_company_share(UUID, UUID) IS
  'CFO-only soft delete of a predated_company_share_distributions row. Same shape as fn_soft_delete_predated_payout. Idempotent on already-deleted rows.';
