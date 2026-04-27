-- =====================================================================
-- F-12 remainder: Withdrawal + EOD lifecycle RPCs (atomic state transitions)
-- =====================================================================
-- Closes the F-12 remainder slice (the audit's expense-lifecycle slice
-- closed via 00029, the budgets/resubmit slice closed via 00042). Also
-- closes the F-12.1 scope expansion (withdrawals/update flow).
--
-- Architecture mirrors 00029 (F-06) and 00042 (F-07):
--   * One RPC per logical transition. Each is one PL/pgSQL function =
--     one transaction. Status guards prevent invalid transitions.
--     Concurrency-safe via SELECT ... FOR UPDATE row locks on parent
--     rows (profit_share_records for withdrawals, eod_reports for the
--     daily report by report_date).
--   * SECURITY DEFINER. Authorization via the passed user_id.
--   * Errors raise with ERRCODE='P0001' and structured HINT/DETAIL for
--     the API route to translate.
--   * Audit trail: each RPC manually inserts an audit_logs row with
--     full user_id attribution. The fn_audit_log trigger on withdrawals
--     ALSO fires producing a row with user_id=NULL (service-role
--     context); the dual-row pattern is acceptable per 00042 §header.
--   * No drift codification preamble: F-12 Phase 1 verified zero drift
--     across the affected tables (withdrawals, forex_logs, eod_reports,
--     red_flags, notifications, audit_logs). The schema/code drift
--     family that anchored F-02 / F-10 / F-33 / F-07 is genuinely
--     converging.
--
-- TOCTOU mitigations:
--   * fn_withdrawal_record locks the profit_share_records row before
--     the balance check (route line 57-62 was outside any lock; two
--     concurrent director payouts could both pass the balance check
--     and overdraft).
--   * fn_eod_report_send uses INSERT ... ON CONFLICT (report_date) DO
--     UPDATE — atomic upsert eliminates the resend check race at route
--     line 214; UNIQUE violations surface as structured errors via the
--     ON CONFLICT clause rather than raw 23505.
--   * fn_withdrawal_update locks the withdrawals row plus both old and
--     new profit_share_records rows before the credit/debit pair, so
--     concurrent updates against the same PSR can't interleave their
--     balance arithmetic.
--
-- Slack delivery ordering (eod):
--   The route currently calls Slack BEFORE writing to the DB; if Slack
--   succeeds and the DB write fails, the report was sent but unrecorded.
--   F-12 closes the multi-write atomicity (eod_reports + red_flag) but
--   keeps the Slack-before-RPC order — the RPC takes p_slack_status and
--   p_error_message as parameters. The DB writes inside the RPC are
--   atomic (single transaction); Slack delivery and notifications stay
--   in the route, mirroring 00042's notifications-post-RPC pattern.
--
-- Out of scope for this migration:
--   * src/app/api/withdrawals/fix-legacy/route.ts — admin utility with
--     similar pattern. Logged as F-12.2 deferred per user decision.
--   * Notifications loop (eod) and audit log dual-row pattern remain
--     route-side concerns; same disposition as 00042.
-- =====================================================================


-- ===========================================================================
-- 1. fn_withdrawal_record
--    Wraps: withdrawals INSERT + forex_logs INSERT (conditional) +
--           audit_logs INSERT.
--    Branches on p_withdrawal_type:
--      'director_payout' — validates PSR balance under FOR UPDATE lock
--      'operations'      — validates director_tag + director_user_id
--    Trigger trg_withdrawal_payout_totals (00017) fires on the INSERT
--    and recomputes profit_share_records totals atomically.
-- ===========================================================================
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
  p_payout_type TEXT             -- payout only; 'full' | 'partial'
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
      recorded_by, withdrawal_date, year_month
    ) VALUES (
      'director_payout', p_profit_share_record_id, p_director_name, p_payout_type,
      p_amount_usd, p_exchange_rate, p_amount_kes,
      p_forex_bureau, p_reference_id, p_reference_rate, p_variance_kes, p_notes,
      p_recorded_by, p_withdrawal_date, p_year_month
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
      year_month, notes, recorded_by
    ) VALUES (
      'operations', p_withdrawal_date, p_director_tag, p_director_user_id,
      p_amount_usd, p_exchange_rate, p_amount_kes,
      p_forex_bureau, p_reference_id, p_reference_rate, p_variance_kes,
      p_year_month, p_notes, p_recorded_by
    ) RETURNING * INTO v_withdrawal;
  END IF;

  -- Forex log (atomic with the withdrawal write)
  IF p_exchange_rate IS NOT NULL AND p_exchange_rate > 0 THEN
    INSERT INTO public.forex_logs (
      withdrawal_id, rate_date, rate_usd_to_kes, source
    ) VALUES (
      v_withdrawal.id, p_withdrawal_date, p_exchange_rate,
      COALESCE(p_forex_bureau, 'Manual entry')
    );
  END IF;

  -- Manual audit log with full attribution
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


-- ===========================================================================
-- 2. fn_withdrawal_update
--    Wraps: withdrawals UPDATE + paired profit_share_records UPDATE
--           (credit old PSR, debit new PSR) + forex_logs INSERT/UPDATE +
--           audit_logs INSERT.
--    Auth: CFO only.
--    Lock order: withdrawals row, then both old and new PSR rows under
--    FOR UPDATE before the balance arithmetic. Preserves the route's
--    EXACT credit/debit semantics — does not change PSR computation
--    behavior, only wraps it atomically.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_withdrawal_update(
  p_withdrawal_id UUID,
  p_updated_by UUID,
  p_withdrawal_type TEXT,
  p_purpose TEXT,
  p_withdrawal_date DATE,
  p_amount_usd NUMERIC,
  p_amount_kes NUMERIC,
  p_exchange_rate NUMERIC,
  p_forex_bureau TEXT,
  p_reference_id TEXT,
  p_reference_rate NUMERIC,
  p_variance_kes NUMERIC,
  p_notes TEXT,
  p_director_tag TEXT,
  p_director_user_id UUID,
  p_director_name TEXT,
  p_profit_share_record_id UUID,
  p_payout_type TEXT
) RETURNS public.withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role public.user_role;
  v_existing public.withdrawals;
  v_updated public.withdrawals;
  v_old_psr public.profit_share_records;
  v_new_psr public.profit_share_records;
  v_credited_balance NUMERIC;
  v_credited_paid_out NUMERIC;
  v_debited_balance NUMERIC;
  v_debited_paid_out NUMERIC;
  v_available NUMERIC;
  v_existing_forex_id UUID;
BEGIN
  SELECT role INTO v_caller_role FROM public.users WHERE id = p_updated_by;
  IF v_caller_role IS NULL OR v_caller_role <> 'cfo'::user_role THEN
    RAISE EXCEPTION 'unauthorized: caller % is not CFO', p_updated_by USING ERRCODE='P0001';
  END IF;

  IF p_amount_kes IS NULL OR p_amount_kes <= 0 THEN
    RAISE EXCEPTION 'amount_kes must be greater than zero' USING ERRCODE='P0001';
  END IF;

  -- Lock the withdrawal row
  SELECT * INTO v_existing FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'withdrawal % not found', p_withdrawal_id USING ERRCODE='P0001';
  END IF;

  IF p_withdrawal_type = 'director_payout' THEN
    IF p_director_name IS NULL OR p_director_name NOT IN ('Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor') THEN
      RAISE EXCEPTION 'invalid director_name %', p_director_name USING ERRCODE='P0001';
    END IF;
    IF p_payout_type NOT IN ('full', 'partial') THEN
      RAISE EXCEPTION 'payout_type must be full or partial' USING ERRCODE='P0001';
    END IF;
    IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
      RAISE EXCEPTION 'exchange_rate is required for director payout updates' USING ERRCODE='P0001';
    END IF;

    IF p_profit_share_record_id IS NOT NULL THEN
      SELECT * INTO v_new_psr FROM public.profit_share_records
       WHERE id = p_profit_share_record_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'profit_share_record % not found', p_profit_share_record_id USING ERRCODE='P0001';
      END IF;

      IF v_new_psr.status NOT IN ('cfo_reviewed', 'approved') THEN
        RAISE EXCEPTION 'profit_share_record is not approved (status %)', v_new_psr.status
          USING ERRCODE='P0001';
      END IF;

      IF v_new_psr.director_name <> p_director_name THEN
        RAISE EXCEPTION 'profit_share_record director (%) does not match selected director (%)',
          v_new_psr.director_name, p_director_name USING ERRCODE='P0001';
      END IF;

      -- Available = current balance, plus any amount being released back
      -- if this is the same PSR being re-allocated (preserves route semantics)
      v_available := COALESCE(v_new_psr.balance_remaining, 0);
      IF v_existing.withdrawal_type = 'director_payout'
         AND v_existing.profit_share_record_id IS NOT NULL
         AND v_existing.profit_share_record_id = p_profit_share_record_id
      THEN
        v_available := v_available + COALESCE(v_existing.amount_kes, 0);
      END IF;

      IF p_amount_kes > v_available THEN
        RAISE EXCEPTION 'payout amount % exceeds remaining balance %', p_amount_kes, v_available
          USING ERRCODE='P0001';
      END IF;
    END IF;
  END IF;

  -- UPDATE the withdrawal row
  UPDATE public.withdrawals SET
    withdrawal_type = p_withdrawal_type,
    purpose = p_purpose,
    withdrawal_date = COALESCE(p_withdrawal_date, withdrawal_date),
    amount_usd = p_amount_usd,
    exchange_rate = p_exchange_rate,
    amount_kes = p_amount_kes,
    forex_bureau = p_forex_bureau,
    reference_id = p_reference_id,
    reference_rate = p_reference_rate,
    variance_kes = p_variance_kes,
    notes = p_notes,
    director_tag = p_director_tag,
    director_user_id = p_director_user_id,
    director_name = CASE WHEN p_withdrawal_type = 'director_payout' THEN p_director_name ELSE NULL END,
    profit_share_record_id = CASE WHEN p_withdrawal_type = 'director_payout' THEN p_profit_share_record_id ELSE NULL END,
    payout_type = CASE WHEN p_withdrawal_type = 'director_payout' THEN p_payout_type ELSE NULL END,
    project_id = CASE WHEN p_withdrawal_type = 'director_payout' THEN NULL ELSE project_id END,
    budget_id = CASE WHEN p_withdrawal_type = 'director_payout' THEN NULL ELSE budget_id END
  WHERE id = p_withdrawal_id
  RETURNING * INTO v_updated;

  -- Credit OLD PSR (if previous version was director_payout)
  IF v_existing.withdrawal_type = 'director_payout' AND v_existing.profit_share_record_id IS NOT NULL THEN
    -- Lock old PSR (may already be locked above if same as new PSR; FOR UPDATE is idempotent in same txn)
    SELECT * INTO v_old_psr FROM public.profit_share_records
     WHERE id = v_existing.profit_share_record_id FOR UPDATE;

    IF FOUND THEN
      v_credited_balance := COALESCE(v_old_psr.balance_remaining, 0) + COALESCE(v_existing.amount_kes, 0);
      v_credited_paid_out := COALESCE(v_old_psr.total_paid_out, 0) - COALESCE(v_existing.amount_kes, 0);
      UPDATE public.profit_share_records SET
        balance_remaining = v_credited_balance,
        total_paid_out = GREATEST(v_credited_paid_out, 0),
        payout_status = CASE
          WHEN v_credited_paid_out <= 0 THEN 'unpaid'
          WHEN v_credited_balance <= 0 THEN 'paid'
          ELSE 'partial' END
      WHERE id = v_existing.profit_share_record_id;
    END IF;
  END IF;

  -- Debit NEW PSR (if updated to director_payout)
  IF p_withdrawal_type = 'director_payout' AND p_profit_share_record_id IS NOT NULL THEN
    -- Refresh after the credit may have updated the same row
    SELECT * INTO v_new_psr FROM public.profit_share_records
     WHERE id = p_profit_share_record_id FOR UPDATE;

    v_available := COALESCE(v_new_psr.balance_remaining, 0);
    IF p_amount_kes > v_available THEN
      RAISE EXCEPTION 'amount % exceeds remaining balance %', p_amount_kes, v_available
        USING ERRCODE='P0001';
    END IF;

    v_debited_balance := v_available - p_amount_kes;
    v_debited_paid_out := COALESCE(v_new_psr.total_paid_out, 0) + p_amount_kes;
    UPDATE public.profit_share_records SET
      balance_remaining = v_debited_balance,
      total_paid_out = v_debited_paid_out,
      payout_status = CASE WHEN v_debited_balance <= 0 THEN 'paid' ELSE 'partial' END
    WHERE id = p_profit_share_record_id;
  END IF;

  -- Forex log (UPDATE existing or INSERT new) when exchange rate changed
  IF COALESCE(v_existing.exchange_rate, 0) <> COALESCE(p_exchange_rate, 0) AND p_exchange_rate > 0 THEN
    SELECT id INTO v_existing_forex_id FROM public.forex_logs
     WHERE withdrawal_id = v_existing.id
     ORDER BY created_at DESC LIMIT 1;

    IF v_existing_forex_id IS NOT NULL THEN
      UPDATE public.forex_logs SET
        rate_date = COALESCE(p_withdrawal_date, v_existing.withdrawal_date),
        rate_usd_to_kes = p_exchange_rate,
        source = COALESCE(p_forex_bureau, 'Manual entry')
      WHERE id = v_existing_forex_id;
    ELSE
      INSERT INTO public.forex_logs (withdrawal_id, rate_date, rate_usd_to_kes, source)
      VALUES (
        v_existing.id,
        COALESCE(p_withdrawal_date, v_existing.withdrawal_date),
        p_exchange_rate,
        COALESCE(p_forex_bureau, 'Manual entry')
      );
    END IF;
  END IF;

  -- Manual audit log with full attribution
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    p_updated_by, 'withdrawal_edited', 'withdrawals', v_existing.id,
    jsonb_build_object(
      'withdrawal_type', v_existing.withdrawal_type,
      'withdrawal_date', v_existing.withdrawal_date,
      'director_tag', v_existing.director_tag,
      'director_user_id', v_existing.director_user_id,
      'director_name', v_existing.director_name,
      'profit_share_record_id', v_existing.profit_share_record_id,
      'amount_usd', v_existing.amount_usd,
      'amount_kes', v_existing.amount_kes,
      'exchange_rate', v_existing.exchange_rate,
      'payout_type', v_existing.payout_type,
      'forex_bureau', v_existing.forex_bureau,
      'notes', v_existing.notes
    ),
    jsonb_build_object(
      'withdrawal_type', p_withdrawal_type,
      'withdrawal_date', p_withdrawal_date,
      'director_tag', p_director_tag,
      'director_user_id', p_director_user_id,
      'director_name', p_director_name,
      'profit_share_record_id', p_profit_share_record_id,
      'amount_usd', p_amount_usd,
      'amount_kes', p_amount_kes,
      'exchange_rate', p_exchange_rate,
      'payout_type', p_payout_type,
      'forex_bureau', p_forex_bureau,
      'notes', p_notes,
      'type_changed', v_existing.withdrawal_type <> p_withdrawal_type
    )
  );

  RETURN v_updated;
END;
$$;


-- ===========================================================================
-- 3. fn_eod_report_send
--    Wraps: eod_reports INSERT/UPSERT + conditional red_flag INSERT +
--           audit_logs INSERT.
--    p_sent_by may be NULL — auto-send cron path is system-generated and
--    legitimately has no user attribution. Manual path always supplies
--    a user_id (route-side guard before calling).
--    Atomic upsert via INSERT ... ON CONFLICT (report_date) DO UPDATE
--    eliminates the resend-check TOCTOU at route line 214.
--    Slack delivery + notifications stay in the route post-RPC. The RPC
--    receives p_slack_status / p_error_message as parameters — those
--    are computed pre-RPC by the route's Slack call.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_eod_report_send(
  p_report_date TEXT,
  p_sent_by UUID,
  p_trigger_type TEXT,
  p_slack_status TEXT,
  p_error_message TEXT,
  p_payload JSONB,
  p_expense_count INTEGER,
  p_withdrawal_count INTEGER,
  p_cash_received_count INTEGER,
  p_budget_action_count INTEGER
) RETURNS public.eod_reports
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role public.user_role;
  v_report public.eod_reports;
  v_year_month TEXT;
BEGIN
  IF p_report_date IS NULL OR length(trim(p_report_date)) = 0 THEN
    RAISE EXCEPTION 'report_date is required' USING ERRCODE='P0001';
  END IF;
  IF p_trigger_type NOT IN ('manual', 'auto') THEN
    RAISE EXCEPTION 'trigger_type must be manual or auto (got %)', p_trigger_type USING ERRCODE='P0001';
  END IF;
  IF p_slack_status NOT IN ('success', 'failed') THEN
    RAISE EXCEPTION 'slack_status must be success or failed (got %)', p_slack_status USING ERRCODE='P0001';
  END IF;

  -- Manual path requires a real user; auto path may pass NULL
  IF p_trigger_type = 'manual' THEN
    IF p_sent_by IS NULL THEN
      RAISE EXCEPTION 'sent_by is required for manual EOD reports' USING ERRCODE='P0001';
    END IF;
    SELECT role INTO v_caller_role FROM public.users WHERE id = p_sent_by;
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('cfo'::user_role, 'accountant'::user_role) THEN
      RAISE EXCEPTION 'unauthorized: caller % cannot send EOD reports', p_sent_by
        USING ERRCODE='P0001', HINT='only CFO or Accountant';
    END IF;
  END IF;

  -- Atomic upsert by report_date — eliminates the resend-check race at the route's old line 214
  INSERT INTO public.eod_reports (
    report_date, sent_by, trigger_type, slack_status, payload,
    expense_count, withdrawal_count, cash_received_count, budget_action_count, error_message
  ) VALUES (
    p_report_date, p_sent_by, p_trigger_type, p_slack_status, p_payload,
    p_expense_count, p_withdrawal_count, p_cash_received_count, p_budget_action_count, p_error_message
  )
  ON CONFLICT (report_date) DO UPDATE SET
    sent_by = EXCLUDED.sent_by,
    trigger_type = EXCLUDED.trigger_type,
    slack_status = EXCLUDED.slack_status,
    payload = EXCLUDED.payload,
    expense_count = EXCLUDED.expense_count,
    withdrawal_count = EXCLUDED.withdrawal_count,
    cash_received_count = EXCLUDED.cash_received_count,
    budget_action_count = EXCLUDED.budget_action_count,
    error_message = EXCLUDED.error_message
  RETURNING * INTO v_report;

  -- Conditional red flag for delivery failure (atomic with the eod_reports upsert)
  IF p_slack_status = 'failed' THEN
    v_year_month := substring(p_report_date FROM 1 FOR 7);
    INSERT INTO public.red_flags (
      flag_type, severity, title, description, year_month
    ) VALUES (
      'report_delivery_failed', 'high',
      'EOD Report Slack delivery failed',
      p_error_message, v_year_month
    );
  END IF;

  -- Manual audit log with full attribution (auto path has p_sent_by=NULL)
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (
    p_sent_by, 'eod_report_sent', 'eod_reports', v_report.id,
    jsonb_build_object(
      'report_date', p_report_date,
      'trigger_type', p_trigger_type,
      'slack_status', p_slack_status,
      'expense_count', p_expense_count,
      'withdrawal_count', p_withdrawal_count,
      'cash_received_count', p_cash_received_count,
      'budget_action_count', p_budget_action_count,
      'has_error', p_error_message IS NOT NULL
    )
  );

  RETURN v_report;
END;
$$;
