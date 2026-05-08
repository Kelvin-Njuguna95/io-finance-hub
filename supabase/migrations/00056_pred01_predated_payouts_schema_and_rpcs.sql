-- ===========================================================================
-- 00056_pred01_predated_payouts_schema_and_rpcs.sql
--
-- Stage 1 of 5 for the predated-payouts feature. Schema only — no API
-- routes or UI. Tables and RPCs are idempotent (CREATE TABLE IF NOT
-- EXISTS / CREATE OR REPLACE FUNCTION) so the file is safe to re-apply.
--
-- BACKGROUND
-- Two distinct payout streams existed before the app was adopted (Oct
-- 2024 onwards) and the company wants to capture them for forensic
-- completeness. Both are INFORMATIONAL records — they are NOT derived
-- from any profit_share_records row and they do NOT feed the live
-- profit-share allocation engine.
--
--   1. 70% project share — a director received their 70% slice of a
--      specific project's net profit for a specific month. Project FK
--      is required.
--
--   2. 30% company pool — a director received a slice of the company-
--      retained 30% across profitable projects for a specific month.
--      No project FK; the 30% is pooled at company level so per-project
--      attribution would be artificial.
--
-- The streams stay in separate tables because the queries that read
-- them are different (one references project_id, the other doesn't).
-- Unioning at the read side is cheap; conditional logic on a single
-- table is not.
--
-- INVARIANTS
--   * year_month must match YYYY-MM format and be STRICTLY in the past
--     (matched against Africa/Nairobi current month, not server tz).
--   * amount_kes > 0 (CHECK).
--   * payment_method ∈ {bank_transfer, cash, mobile_money, cheque,
--     other} (CHECK).
--   * idempotency_key is UNIQUE on each table — the duplicate-submit
--     trap, same shape as 00047–00053.
--   * Recording is gated to CFO and Accountant roles.
--   * "Director" is positional, not a role: anyone with
--     director_user_id set on at least one project (active or inactive)
--     qualifies. There is no separate director enum guard here.
--   * Both RPCs write a single audit_logs row on success with a
--     descriptive action and the inserted record_id.
--
-- OUT OF SCOPE FOR STAGE 1
--   * API routes (Stage 2)
--   * UI dialog (Stage 3)
--   * History list + badge (Stage 4)
--   * EOD wiring (Stage 5)
--   * RLS policies (deferred — service-role admin client gates writes
--     today via the API routes that will land in Stage 2)
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. predated_payouts — 70% project share stream
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.predated_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  director_user_id UUID NOT NULL REFERENCES public.users(id),
  project_id UUID NOT NULL REFERENCES public.projects(id),
  year_month TEXT NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_kes NUMERIC(16,2) NOT NULL CHECK (amount_kes > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'bank_transfer', 'cash', 'mobile_money', 'cheque', 'other'
  )),
  notes TEXT,
  idempotency_key UUID NOT NULL,
  recorded_by UUID NOT NULL REFERENCES public.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_predated_payouts_idempotency_key
  ON public.predated_payouts (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_predated_payouts_director_month
  ON public.predated_payouts (director_user_id, year_month);

CREATE INDEX IF NOT EXISTS idx_predated_payouts_year_month
  ON public.predated_payouts (year_month);

CREATE INDEX IF NOT EXISTS idx_predated_payouts_recorded_at
  ON public.predated_payouts (recorded_at);

COMMENT ON TABLE public.predated_payouts IS
  'Director payouts of the 70% project share that occurred BEFORE the app was adopted (Oct 2024 onwards). Informational only — not derived from profit_share_records and does not feed the live profit-share engine. Stage 1 of the predated-payouts feature (migration 00056).';


-- ---------------------------------------------------------------------------
-- 2. predated_company_share_distributions — 30% company pool stream
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.predated_company_share_distributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  director_user_id UUID NOT NULL REFERENCES public.users(id),
  year_month TEXT NOT NULL CHECK (year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount_kes NUMERIC(16,2) NOT NULL CHECK (amount_kes > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'bank_transfer', 'cash', 'mobile_money', 'cheque', 'other'
  )),
  notes TEXT,
  idempotency_key UUID NOT NULL,
  recorded_by UUID NOT NULL REFERENCES public.users(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_predated_company_share_idempotency_key
  ON public.predated_company_share_distributions (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_predated_company_share_director_month
  ON public.predated_company_share_distributions (director_user_id, year_month);

CREATE INDEX IF NOT EXISTS idx_predated_company_share_year_month
  ON public.predated_company_share_distributions (year_month);

CREATE INDEX IF NOT EXISTS idx_predated_company_share_recorded_at
  ON public.predated_company_share_distributions (recorded_at);

COMMENT ON TABLE public.predated_company_share_distributions IS
  'Director slices of the 30% company-retained pool that occurred BEFORE the app was adopted. No project FK — the 30% is pooled at company level. Informational only; does not feed the live profit-share engine. Stage 1 of the predated-payouts feature (migration 00056).';


-- ---------------------------------------------------------------------------
-- 3. fn_record_predated_payout — 70% project share insert
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_record_predated_payout(
  p_caller_id UUID,
  p_director_user_id UUID,
  p_project_id UUID,
  p_year_month TEXT,
  p_amount_kes NUMERIC,
  p_payment_method TEXT,
  p_notes TEXT,
  p_idempotency_key UUID
) RETURNS public.predated_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_role public.user_role;
  v_director_exists BOOLEAN;
  v_inserted public.predated_payouts;
BEGIN
  -- Auth: CFO or Accountant only. Same gate as the live director-payout
  -- and budget-create routes.
  SELECT role INTO v_caller_role FROM public.users WHERE id = p_caller_id;
  IF v_caller_role NOT IN ('cfo'::public.user_role, 'accountant'::public.user_role) THEN
    RAISE EXCEPTION 'Only CFO or Accountant can record predated payouts'
      USING ERRCODE='P0001';
  END IF;

  -- Director-existence check: positional, not a separate role. Anyone
  -- assigned as director_user_id on ANY project (active or deactivated)
  -- qualifies. Historical projects that were later deactivated still
  -- count — that's the whole point of recording predated payouts.
  SELECT EXISTS(
    SELECT 1 FROM public.projects
    WHERE director_user_id = p_director_user_id
  ) INTO v_director_exists;
  IF NOT v_director_exists THEN
    RAISE EXCEPTION 'User % is not a director on any project',
      p_director_user_id USING ERRCODE='P0001';
  END IF;

  -- Project must exist (active or inactive both OK)
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id = p_project_id) THEN
    RAISE EXCEPTION 'Project % does not exist', p_project_id
      USING ERRCODE='P0001';
  END IF;

  -- Year_month must be strictly past, anchored to Africa/Nairobi so a
  -- server in any timezone gets the same answer for "current month."
  IF p_year_month >= to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM') THEN
    RAISE EXCEPTION 'year_month must be a past month (got %)', p_year_month
      USING ERRCODE='P0001';
  END IF;

  -- Insert. The UNIQUE(idempotency_key) index is the duplicate-submit
  -- lock: a second attempt with the same key fails 23505 and the API
  -- route translates that to a success-with-existing response.
  INSERT INTO public.predated_payouts (
    director_user_id, project_id, year_month,
    amount_kes, payment_method, notes,
    idempotency_key, recorded_by
  ) VALUES (
    p_director_user_id, p_project_id, p_year_month,
    p_amount_kes, p_payment_method, p_notes,
    p_idempotency_key, p_caller_id
  )
  RETURNING * INTO v_inserted;

  -- Audit row with full attribution.
  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, new_values
  ) VALUES (
    p_caller_id,
    'predated_payout_recorded',
    'predated_payouts',
    v_inserted.id,
    jsonb_build_object(
      'director_user_id', p_director_user_id,
      'project_id', p_project_id,
      'year_month', p_year_month,
      'amount_kes', p_amount_kes,
      'payment_method', p_payment_method
    )
  );

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.fn_record_predated_payout(UUID, UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) IS
  'Records a 70% project-share predated payout. Gates on CFO/Accountant role, validates director positionally, requires project_id to exist, blocks current/future months, and writes an audit_logs row. UNIQUE(idempotency_key) is the duplicate-submit lock. Stage 1 of the predated-payouts feature (migration 00056).';


-- ---------------------------------------------------------------------------
-- 4. fn_record_predated_company_share — 30% company pool insert
-- ---------------------------------------------------------------------------
-- Same shape as fn_record_predated_payout minus the project_id parameter
-- and the project-existence check. The 30% is pooled at company level
-- and recipient eligibility is positional (director on at least one
-- project, active or inactive); no per-project attribution applies.

CREATE OR REPLACE FUNCTION public.fn_record_predated_company_share(
  p_caller_id UUID,
  p_director_user_id UUID,
  p_year_month TEXT,
  p_amount_kes NUMERIC,
  p_payment_method TEXT,
  p_notes TEXT,
  p_idempotency_key UUID
) RETURNS public.predated_company_share_distributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_caller_role public.user_role;
  v_director_exists BOOLEAN;
  v_inserted public.predated_company_share_distributions;
BEGIN
  -- Auth: CFO or Accountant only.
  SELECT role INTO v_caller_role FROM public.users WHERE id = p_caller_id;
  IF v_caller_role NOT IN ('cfo'::public.user_role, 'accountant'::public.user_role) THEN
    RAISE EXCEPTION 'Only CFO or Accountant can record predated company-share distributions'
      USING ERRCODE='P0001';
  END IF;

  -- Director-existence check.
  SELECT EXISTS(
    SELECT 1 FROM public.projects
    WHERE director_user_id = p_director_user_id
  ) INTO v_director_exists;
  IF NOT v_director_exists THEN
    RAISE EXCEPTION 'User % is not a director on any project',
      p_director_user_id USING ERRCODE='P0001';
  END IF;

  -- Past-only guard.
  IF p_year_month >= to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM') THEN
    RAISE EXCEPTION 'year_month must be a past month (got %)', p_year_month
      USING ERRCODE='P0001';
  END IF;

  -- Insert.
  INSERT INTO public.predated_company_share_distributions (
    director_user_id, year_month,
    amount_kes, payment_method, notes,
    idempotency_key, recorded_by
  ) VALUES (
    p_director_user_id, p_year_month,
    p_amount_kes, p_payment_method, p_notes,
    p_idempotency_key, p_caller_id
  )
  RETURNING * INTO v_inserted;

  -- Audit row. project_id intentionally omitted from new_values — the
  -- 30% pool is company-level, not per-project.
  INSERT INTO public.audit_logs (
    user_id, action, table_name, record_id, new_values
  ) VALUES (
    p_caller_id,
    'predated_company_share_recorded',
    'predated_company_share_distributions',
    v_inserted.id,
    jsonb_build_object(
      'director_user_id', p_director_user_id,
      'year_month', p_year_month,
      'amount_kes', p_amount_kes,
      'payment_method', p_payment_method
    )
  );

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.fn_record_predated_company_share(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, UUID) IS
  'Records a 30% company-pool predated distribution. Same gating and validation shape as fn_record_predated_payout but no project_id (the 30% is pooled at company level). Stage 1 of the predated-payouts feature (migration 00056).';
