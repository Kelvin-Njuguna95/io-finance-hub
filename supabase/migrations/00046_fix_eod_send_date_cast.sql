-- ===========================================================================
-- 00046_fix_eod_send_date_cast.sql
--
-- Fix: EOD send fails with
--   42804: column "report_date" is of type date but expression is of type text
--
-- Root cause:
--   In production, eod_reports.report_date is DATE. The function declared in
--   00043 takes p_report_date TEXT and INSERTs it into the column without a
--   cast. Postgres has no implicit text→date assignment cast, so every send
--   errors at the INSERT.
--
-- Schema drift note:
--   The column was originally declared TEXT in 00016_feature_table_coverage.sql
--   (line 102). At some point the production column was altered to DATE
--   without an accompanying migration on disk; the historical migration file
--   was not updated. This migration accepts the production reality (DATE)
--   rather than reverting it. The drift in 00016 is documented but not fixed
--   here — touching a historical migration is riskier than working around it,
--   and any environment seeded from a fresh apply of 00016 would have a TEXT
--   column that this cast still tolerates (text → text via ::date is valid
--   either way as long as the input parses).
--
-- Fix shape:
--   One-line cast inside the INSERT — p_report_date::date. Function
--   signature, validation rules, ON CONFLICT clause, red_flag insert, audit
--   log shape, JSONB audit value, and substring-based v_year_month
--   derivation are all unchanged.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
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
    p_report_date::date, p_sent_by, p_trigger_type, p_slack_status, p_payload,
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
