-- ===========================================================================
-- 00054_withdrawals_rpc_idempotency_key.sql
--
-- Threads the new withdrawals.idempotency_key column (added in 00050)
-- through fn_withdrawal_record so the route can pass a client-generated
-- UUID with each call. The column was added without an RPC change, which
-- left the column unreachable from the only path that writes to it
-- (POST /api/withdrawals/create → fn_withdrawal_record RPC).
--
-- Mechanics:
--   • DROP the existing 17-arg signature.
--   • CREATE OR REPLACE with an 18th arg `p_idempotency_key UUID DEFAULT
--     NULL` last in the list. The DEFAULT NULL keeps the function safe
--     to call from any older code path that hasn't been updated yet —
--     the row will simply have idempotency_key NULL (the partial unique
--     index permits multiple NULLs).
--   • Both branch INSERTs (director_payout and operations) include
--     idempotency_key in the column list and VALUES tuple. Everything
--     else — validation, locking, forex_logs INSERT, audit_logs INSERT,
--     trg_withdrawal_payout_totals interaction — preserved verbatim
--     from 00043. The diff vs 00043's body is exactly:
--       (a) +1 parameter declaration
--       (b) +1 column in director_payout INSERT column list / VALUES
--       (c) +1 column in operations INSERT column list / VALUES
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
--
-- Drift caveat (per AGENTS.md): if the live function signature has
-- diverged from 00043 since that migration was applied, the DROP below
-- needs the live arg-type list, not the on-disk one. Verify with
--   SELECT pg_get_functiondef('public.fn_withdrawal_record'::regproc);
-- before applying. If the live shape differs, adapt the DROP signature
-- to match.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.fn_withdrawal_record(
  text, uuid, date, text, numeric, numeric, numeric, text, text,
  numeric, numeric, text, text, uuid, uuid, text, text
);

CREATE OR REPLACE FUNCTION public.fn_withdrawal_record(
  p_withdrawal_type TEXT,
  p_recorded_by UUID,
  p_withdrawal_date DATE,
  p_year_month TEXT,
  p_amount_usd NUMERIC,
  p_amount_kes NUMERIC,
  p_exchange_rate NUMERIC,
  p_forex_bureau TEXT,
  p_reference_id TEXT,
  p_reference_rate NUMERIC,
  p_variance_kes NUMERIC,
  p_notes TEXT,
  p_director_tag TEXT,           -- ops only; NULL for director_payout
  p_director_user_id UUID,       -- ops only; NULL for director_payout
  p_profit_share_record_id UUID, -- payout only; NULL for ops
  p_director_name TEXT,          -- payout only
  p_payout_type TEXT,            -- payout only; 'full' | 'partial'
  p_idempotency_key UUID DEFAULT NULL  -- NEW: client-generated UUID per form load
) RETURNS public.withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role public.user_role;
  v_psr public.profit_share_records;
  v_withdrawal public.withdrawals;
  v_remaining NUMERIC;
BEGIN
  IF p_withdrawal_type NOT IN ('operations', 'director_payout') THEN
    RAISE EXCEPTION 'invalid withdrawal_type %, expected operations|director_payout', p_withdrawal_type
      USING ERRCODE='P0001';
  END IF;

  IF p_amount_kes IS NULL OR p_amount_kes <= 0 THEN
    RAISE EXCEPTION 'amount_kes must be greater than zero (got %)', p_amount_kes
      USING ERRCODE='P0001';
  END IF;

  SELECT role INTO v_caller_role FROM public.users WHERE id = p_recorded_by;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('cfo'::user_role, 'accountant'::user_role) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot record withdrawals', p_recorded_by
      USING ERRCODE='P0001', HINT='only CFO or Accountant';
  END IF;

  IF p_withdrawal_type = 'director_payout' THEN
    IF p_profit_share_record_id IS NULL THEN
      RAISE EXCEPTION 'profit_share_record_id is required for director_payout' USING ERRCODE='P0001';
    END IF;
    IF p_director_name IS NULL OR p_director_name NOT IN ('Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor') THEN
      RAISE EXCEPTION 'invalid director_name %', p_director_name USING ERRCODE='P0001';
    END IF;
    IF p_payout_type IS NULL OR p_payout_type NOT IN ('full', 'partial') THEN
      RAISE EXCEPTION 'payout_type must be full or partial (got %)', p_payout_type USING ERRCODE='P0001';
    END IF;

    -- Lock-then-guard: TOCTOU mitigation for concurrent payouts against same PSR
    SELECT * INTO v_psr FROM public.profit_share_records
     WHERE id = p_profit_share_record_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'profit_share_record % not found', p_profit_share_record_id
        USING ERRCODE='P0001';
    END IF;

    IF v_psr.status <> 'cfo_reviewed' THEN
      RAISE EXCEPTION 'profit_share_record is not approved (status %)', v_psr.status
        USING ERRCODE='P0001', HINT='status must be cfo_reviewed';
    END IF;

    IF v_psr.director_name <> p_director_name THEN
      RAISE EXCEPTION 'profit_share_record director (%) does not match selected director (%)',
        v_psr.director_name, p_director_name USING ERRCODE='P0001';
    END IF;

    v_remaining := COALESCE(v_psr.balance_remaining, 0);
    IF p_amount_kes > v_remaining THEN
      RAISE EXCEPTION 'payout amount % exceeds remaining balance %', p_amount_kes, v_remaining
        USING ERRCODE='P0001';
    END IF;

    INSERT INTO public.withdrawals (
      withdrawal_type, profit_share_record_id, director_name, payout_type,
      amount_usd, exchange_rate, amount_kes,
      forex_bureau, reference_id, reference_rate, variance_kes, notes,
      recorded_by, withdrawal_date, year_month,
      idempotency_key
    ) VALUES (
      'director_payout', p_profit_share_record_id, p_director_name, p_payout_type,
      p_amount_usd, p_exchange_rate, p_amount_kes,
      p_forex_bureau, p_reference_id, p_reference_rate, p_variance_kes, p_notes,
      p_recorded_by, p_withdrawal_date, p_year_month,
      p_idempotency_key
    ) RETURNING * INTO v_withdrawal;

  ELSE
    -- operations
    IF p_director_tag IS NULL OR p_director_user_id IS NULL THEN
      RAISE EXCEPTION 'director_tag and director_user_id are required for operations withdrawal'
        USING ERRCODE='P0001';
    END IF;
    IF p_amount_usd IS NULL OR p_amount_usd <= 0 OR p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
      RAISE EXCEPTION 'amount_usd and exchange_rate must be greater than zero' USING ERRCODE='P0001';
    END IF;

    INSERT INTO public.withdrawals (
      withdrawal_type, withdrawal_date, director_tag, director_user_id,
      amount_usd, exchange_rate, amount_kes,
      forex_bureau, reference_id, reference_rate, variance_kes,
      year_month, notes, recorded_by,
      idempotency_key
    ) VALUES (
      'operations', p_withdrawal_date, p_director_tag, p_director_user_id,
      p_amount_usd, p_exchange_rate, p_amount_kes,
      p_forex_bureau, p_reference_id, p_reference_rate, p_variance_kes,
      p_year_month, p_notes, p_recorded_by,
      p_idempotency_key
    ) RETURNING * INTO v_withdrawal;
  END IF;

  -- Forex log (atomic with the withdrawal write) — unchanged
  IF p_exchange_rate IS NOT NULL AND p_exchange_rate > 0 THEN
    INSERT INTO public.forex_logs (
      withdrawal_id, rate_date, rate_usd_to_kes, source
    ) VALUES (
      v_withdrawal.id, p_withdrawal_date, p_exchange_rate,
      COALESCE(p_forex_bureau, 'Manual entry')
    );
  END IF;

  -- Manual audit log with full attribution — unchanged
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_recorded_by,
    CASE WHEN p_withdrawal_type = 'director_payout'
      THEN 'director_payout_withdrawal_recorded'
      ELSE 'operations_withdrawal_recorded' END,
    'withdrawals', v_withdrawal.id,
    jsonb_build_object(
      'withdrawal_type', p_withdrawal_type,
      'amount_kes', p_amount_kes,
      'amount_usd', p_amount_usd,
      'profit_share_record_id', p_profit_share_record_id,
      'director_name', p_director_name,
      'director_tag', p_director_tag,
      'payout_type', p_payout_type
    )
  );

  RETURN v_withdrawal;
END;
$$;
