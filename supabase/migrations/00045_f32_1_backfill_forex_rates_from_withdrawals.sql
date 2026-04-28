-- ===========================================================================
-- 00045_f32_1_backfill_forex_rates_from_withdrawals.sql
--
-- F-32.1: backfill forex_rates from withdrawals + go-forward trigger
--
-- Closes the follow-up logged in AUDIT_2_F32_USD_ARCHITECTURE.md §11.1 Q11.5:
-- forex_rates was created in 00009_appendix_o_fixes.sql but never populated.
-- Audit 2 §11 verification (2026-04-28) confirmed 0 rows. The currency-sync
-- triggers from 00028_f32_currency_conversion_triggers.sql read
-- system_settings.standard_exchange_rate (single live rate) instead of any
-- per-month historical rate.
--
-- SCOPE OF THIS MIGRATION
--   * Backfills forex_rates with one row per year_month found in withdrawals,
--     keyed to (year_month || '-01')::date, using the volume-weighted average
--     of withdrawals.exchange_rate (weighted by amount_usd).
--   * Adds the missing UNIQUE constraint on (rate_date, currency_pair) so
--     subsequent upserts are idempotent.
--   * Adds an AFTER INSERT trigger on withdrawals that keeps the month's
--     forex_rates row in sync with future withdrawal activity.
--
-- DOES NOT CHANGE CONVERSION BEHAVIOR
--   fn_currency_get_rate() and the three sync trigger functions
--   (fn_currency_sync_amount_pair, fn_currency_sync_total_amount_pair,
--   fn_currency_sync_budget_items) are NOT TOUCHED. They continue to read
--   system_settings.standard_exchange_rate. Phase 2b (making conversions
--   actually consult forex_rates by row date) is deferred to a separate
--   migration with its own diagnostic + verification window.
--
-- BACKFILL SOURCE / AGGREGATION
--   withdrawals.exchange_rate is NUMERIC(12,4) NOT NULL; year_month is
--   validated TEXT (YYYY-MM). Per-month rate is SUM(exchange_rate *
--   amount_usd) / SUM(amount_usd) — volume-weighted by USD volume — rounded
--   to 6 decimals. 6dp gives the trigger room to converge as more
--   withdrawals arrive without losing precision against the 4dp source.
--
-- VERIFICATION
--   Self-verify DO block at end confirms UNIQUE constraint, trigger
--   presence, and reports forex_rates row count via RAISE NOTICE. Does NOT
--   fail on 0 rows — a clean DB with no withdrawals legitimately has none.
-- ===========================================================================

-- 1. Add UNIQUE constraint (idempotent — safe to re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'forex_rates'
      AND constraint_name = 'forex_rates_date_pair_unique'
  ) THEN
    ALTER TABLE public.forex_rates
      ADD CONSTRAINT forex_rates_date_pair_unique UNIQUE (rate_date, currency_pair);
  END IF;
END $$;

-- 2. Volume-weighted backfill from withdrawals.
INSERT INTO public.forex_rates (rate_date, currency_pair, rate, source)
SELECT
  (year_month || '-01')::date                                              AS rate_date,
  'USD/KES'                                                                AS currency_pair,
  ROUND(SUM(exchange_rate * amount_usd) / NULLIF(SUM(amount_usd), 0), 6)   AS rate,
  'withdrawal_backfill'                                                    AS source
FROM public.withdrawals
WHERE amount_usd > 0
GROUP BY year_month
ON CONFLICT (rate_date, currency_pair) DO NOTHING;

-- 3. Go-forward trigger function — keeps the month's rate current as
--    new withdrawals arrive.
CREATE OR REPLACE FUNCTION public.fn_forex_rate_upsert_from_withdrawal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  -- Skip if the new row carries no USD volume to weight by.
  IF NEW.amount_usd IS NULL OR NEW.amount_usd <= 0 THEN
    RETURN NULL;
  END IF;

  -- Recompute the month's volume-weighted average across all withdrawals
  -- in NEW.year_month (NEW is already visible — this fires AFTER INSERT).
  SELECT ROUND(SUM(exchange_rate * amount_usd) / NULLIF(SUM(amount_usd), 0), 6)
    INTO v_rate
  FROM public.withdrawals
  WHERE year_month = NEW.year_month
    AND amount_usd > 0;

  IF v_rate IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.forex_rates (rate_date, currency_pair, rate, source)
  VALUES ((NEW.year_month || '-01')::date, 'USD/KES', v_rate, 'withdrawal_trigger')
  ON CONFLICT (rate_date, currency_pair) DO UPDATE
    SET rate   = EXCLUDED.rate,
        source = EXCLUDED.source;

  RETURN NULL;
END;
$$;

-- 4. Attach trigger (idempotent).
DROP TRIGGER IF EXISTS tr_forex_rate_upsert_on_withdrawal ON public.withdrawals;
CREATE TRIGGER tr_forex_rate_upsert_on_withdrawal
  AFTER INSERT ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_forex_rate_upsert_from_withdrawal();

-- ---------------------------------------------------------------------------
-- Self-verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_constraint_count int;
  v_trigger_count    int;
  v_row_count        int;
BEGIN
  SELECT COUNT(*) INTO v_constraint_count
  FROM information_schema.table_constraints
  WHERE table_schema    = 'public'
    AND table_name      = 'forex_rates'
    AND constraint_name = 'forex_rates_date_pair_unique'
    AND constraint_type = 'UNIQUE';

  IF v_constraint_count = 0 THEN
    RAISE EXCEPTION 'F-32.1 self-verify failed: UNIQUE constraint forex_rates_date_pair_unique not present on public.forex_rates';
  END IF;

  SELECT COUNT(*) INTO v_trigger_count
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'
    AND event_object_table  = 'withdrawals'
    AND trigger_name        = 'tr_forex_rate_upsert_on_withdrawal';

  IF v_trigger_count = 0 THEN
    RAISE EXCEPTION 'F-32.1 self-verify failed: tr_forex_rate_upsert_on_withdrawal trigger not present on public.withdrawals';
  END IF;

  SELECT COUNT(*) INTO v_row_count FROM public.forex_rates;
  RAISE NOTICE 'F-32.1 backfill complete: % row(s) in forex_rates', v_row_count;
END $$;
