-- ===========================================================================
-- F-32: Currency conversion triggers + F-21 fix to lagged view
-- ===========================================================================
-- Closes AUDIT_1 finding F-32 (USD columns systematically empty across
-- budget_versions, budget_items, expenses; KES empty across invoices, payments)
-- and F-21 (hardcoded 128.5 in lagged_revenue_by_project_month view).
--
-- Architecture: Option C from AUDIT_2_F32_USD_ARCHITECTURE.md — dual-store with
-- bidirectional triggers. Both currency columns are populated; whichever side
-- the writer fills, the trigger fills the other. If the writer fills both
-- explicitly, the trigger preserves user intent (no overwrite).
--
-- Verification evidence (2026-04-26):
--   - 0 closed months → no historical poisoned data to regenerate
--   - 0 manually-corrected rows → uniform broken state, clean backfill
--   - standard_exchange_rate populated at 129.5 → backfill rate confirmed
--   - 0 unexpected triggers on the 5 tables → no conflicts
--   - system_settings has unrestricted SELECT policy → no SECURITY DEFINER needed
--
-- Rate at backfill time: 129.5 (recorded as literal in this migration so that
-- this file's effect is reproducible regardless of future rate changes).
--
-- Side effect on lagged_revenue_by_project_month (F-21):
-- KES revenue values shift by ~0.78% upward (129.5/128.5) for invoices that
-- previously hit the fallback path. After this migration, the COALESCE first
-- branch (inv.total_invoice_kes) hits for backfilled invoices, so the new rate
-- is used only for any future USD-only invoice. The fallback structure is
-- preserved for defensive belt-and-suspenders behavior.
--
-- Known edge case: UPDATE that explicitly sets one currency column to 0 will
-- have the trigger overwrite that 0 from the other column. This is a known
-- ambiguous case (was the user clearing the value, or zeroing one side
-- temporarily?). Per F-32 architecture decision, the trigger preserves "both
-- populated" intent but otherwise fills from the populated side. If a future
-- workflow needs to clear a currency column, set both to 0 in the same UPDATE.
--
-- Out of scope (intentional, tracked separately):
--   * withdrawals — already correctly capture USD × forex_bureau_rate at entry;
--     applying the system rate would overwrite the bureau rate that was
--     actually used for the cash transaction.
--   * outstanding_receivables_snapshot — table has 0 rows as of 2026-04-26;
--     when/if a writer is built, both columns should be populated at source.
--   * fn_calculate_project_profitability, fn_calculate_overhead_allocations,
--     fn_generate_monthly_snapshot, fn_generate_profit_shares,
--     fn_generate_red_flags — these self-correct once the underlying tables
--     have both currency columns populated (per AUDIT_2 §7 Option C analysis).
--   * API writers that explicitly write `amount_usd: 0` literals — trigger
--     overwrites them; literal cleanup is tech debt for a follow-up.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Rate-getter function
-- ---------------------------------------------------------------------------
-- STABLE (NOT IMMUTABLE — reads database state). No SECURITY DEFINER (verified
-- 2026-04-26 that system_settings.ss_select policy applies to all roles with
-- qual=TRUE; ss_manage gates writes only).
--
-- Loud-fail design: raises an exception if the row is missing or value is
-- non-positive. Silent zero would re-introduce the F-32 defect.

CREATE OR REPLACE FUNCTION public.fn_currency_get_rate()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  SELECT value::NUMERIC INTO v_rate
  FROM public.system_settings
  WHERE key = 'standard_exchange_rate';

  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'standard_exchange_rate not set or invalid in system_settings (got %)', v_rate
      USING HINT = 'Insert/update system_settings WHERE key=''standard_exchange_rate''';
  END IF;

  RETURN v_rate;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Trigger functions
-- ---------------------------------------------------------------------------
-- Three separate functions instead of one TG_ARGV-branching function: each
-- references its column names directly, so future audits via pg_get_functiondef
-- read clearly. ROUND(_, 4) for USD outputs (NUMERIC(16,4) per schema),
-- ROUND(_, 2) for KES outputs (NUMERIC(16,2) per schema).

-- 2a. invoices, payments, expenses (column pair: amount_usd / amount_kes)
CREATE OR REPLACE FUNCTION public.fn_currency_sync_amount_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  v_rate := public.fn_currency_get_rate();

  IF COALESCE(NEW.amount_kes, 0) > 0
     AND (NEW.amount_usd IS NULL OR NEW.amount_usd = 0)
  THEN
    NEW.amount_usd := ROUND(NEW.amount_kes / v_rate, 4);
  ELSIF COALESCE(NEW.amount_usd, 0) > 0
        AND (NEW.amount_kes IS NULL OR NEW.amount_kes = 0)
  THEN
    NEW.amount_kes := ROUND(NEW.amount_usd * v_rate, 2);
  END IF;
  -- Both populated, both zero, or both NULL → no-op (preserve user intent).

  RETURN NEW;
END;
$$;

-- 2b. budget_versions (column pair: total_amount_usd / total_amount_kes)
CREATE OR REPLACE FUNCTION public.fn_currency_sync_total_amount_pair()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  v_rate := public.fn_currency_get_rate();

  IF COALESCE(NEW.total_amount_kes, 0) > 0
     AND (NEW.total_amount_usd IS NULL OR NEW.total_amount_usd = 0)
  THEN
    NEW.total_amount_usd := ROUND(NEW.total_amount_kes / v_rate, 4);
  ELSIF COALESCE(NEW.total_amount_usd, 0) > 0
        AND (NEW.total_amount_kes IS NULL OR NEW.total_amount_kes = 0)
  THEN
    NEW.total_amount_kes := ROUND(NEW.total_amount_usd * v_rate, 2);
  END IF;

  RETURN NEW;
END;
$$;

-- 2c. budget_items (TWO independent column pairs: amount_*, unit_cost_*).
--     unit_cost_usd and unit_cost_kes are NULLABLE per schema.
CREATE OR REPLACE FUNCTION public.fn_currency_sync_budget_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate NUMERIC;
BEGIN
  v_rate := public.fn_currency_get_rate();

  -- Pair 1: amount_usd / amount_kes (both NOT NULL DEFAULT 0)
  IF COALESCE(NEW.amount_kes, 0) > 0
     AND (NEW.amount_usd IS NULL OR NEW.amount_usd = 0)
  THEN
    NEW.amount_usd := ROUND(NEW.amount_kes / v_rate, 4);
  ELSIF COALESCE(NEW.amount_usd, 0) > 0
        AND (NEW.amount_kes IS NULL OR NEW.amount_kes = 0)
  THEN
    NEW.amount_kes := ROUND(NEW.amount_usd * v_rate, 2);
  END IF;

  -- Pair 2: unit_cost_usd / unit_cost_kes (both NULLABLE)
  IF COALESCE(NEW.unit_cost_kes, 0) > 0
     AND (NEW.unit_cost_usd IS NULL OR NEW.unit_cost_usd = 0)
  THEN
    NEW.unit_cost_usd := ROUND(NEW.unit_cost_kes / v_rate, 4);
  ELSIF COALESCE(NEW.unit_cost_usd, 0) > 0
        AND (NEW.unit_cost_kes IS NULL OR NEW.unit_cost_kes = 0)
  THEN
    NEW.unit_cost_kes := ROUND(NEW.unit_cost_usd * v_rate, 2);
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE OF <cols>: column list applies only to the UPDATE
-- event; INSERT always fires (PostgreSQL semantics). DROP TRIGGER IF EXISTS
-- pattern matches the convention from 00018.

DROP TRIGGER IF EXISTS tr_currency_sync_invoices ON public.invoices;
CREATE TRIGGER tr_currency_sync_invoices
  BEFORE INSERT OR UPDATE OF amount_usd, amount_kes
  ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_currency_sync_amount_pair();

DROP TRIGGER IF EXISTS tr_currency_sync_payments ON public.payments;
CREATE TRIGGER tr_currency_sync_payments
  BEFORE INSERT OR UPDATE OF amount_usd, amount_kes
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_currency_sync_amount_pair();

DROP TRIGGER IF EXISTS tr_currency_sync_expenses ON public.expenses;
CREATE TRIGGER tr_currency_sync_expenses
  BEFORE INSERT OR UPDATE OF amount_usd, amount_kes
  ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_currency_sync_amount_pair();

DROP TRIGGER IF EXISTS tr_currency_sync_budget_versions ON public.budget_versions;
CREATE TRIGGER tr_currency_sync_budget_versions
  BEFORE INSERT OR UPDATE OF total_amount_usd, total_amount_kes
  ON public.budget_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_currency_sync_total_amount_pair();

DROP TRIGGER IF EXISTS tr_currency_sync_budget_items ON public.budget_items;
CREATE TRIGGER tr_currency_sync_budget_items
  BEFORE INSERT OR UPDATE OF amount_usd, amount_kes, unit_cost_usd, unit_cost_kes
  ON public.budget_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_currency_sync_budget_items();


-- ---------------------------------------------------------------------------
-- 4. Backfill (literal 129.5 — standard_exchange_rate snapshot at migration
--    write time, 2026-04-26)
-- ---------------------------------------------------------------------------
-- Order: triggers above are already in place. Each backfill UPDATE sets the
-- previously-zero column to a non-zero value derived from the populated side.
-- The trigger then sees both sides non-zero and no-ops. Filter clauses make
-- each statement idempotent — re-running matches zero rows.
--
-- Literal vs fn_currency_get_rate() in the backfill: literal preferred so this
-- migration file's effect is reproducible regardless of future rate changes.
-- The trigger itself uses the function for any post-migration writes.

-- 4a. budget_versions: KES → USD
UPDATE public.budget_versions
   SET total_amount_usd = ROUND(total_amount_kes / 129.5, 4)
 WHERE total_amount_kes > 0
   AND total_amount_usd = 0;

-- 4b. budget_items, amount pair: KES → USD
UPDATE public.budget_items
   SET amount_usd = ROUND(amount_kes / 129.5, 4)
 WHERE amount_kes > 0
   AND amount_usd = 0;

-- 4c. budget_items, unit_cost pair: KES → USD (both NULLABLE)
UPDATE public.budget_items
   SET unit_cost_usd = ROUND(unit_cost_kes / 129.5, 4)
 WHERE unit_cost_kes IS NOT NULL
   AND unit_cost_kes > 0
   AND (unit_cost_usd IS NULL OR unit_cost_usd = 0);

-- 4d. expenses: KES → USD
UPDATE public.expenses
   SET amount_usd = ROUND(amount_kes / 129.5, 4)
 WHERE amount_kes > 0
   AND amount_usd = 0;

-- 4e. invoices: USD → KES
UPDATE public.invoices
   SET amount_kes = ROUND(amount_usd * 129.5, 2)
 WHERE amount_usd > 0
   AND amount_kes = 0;

-- 4f. payments: USD → KES
UPDATE public.payments
   SET amount_kes = ROUND(amount_usd * 129.5, 2)
 WHERE amount_usd > 0
   AND amount_kes = 0;


-- ---------------------------------------------------------------------------
-- 5. F-21: lagged_revenue_by_project_month — replace hardcoded 128.5 with
--          fn_currency_get_rate()
-- ---------------------------------------------------------------------------
-- Body copied byte-for-byte from pg_get_viewdef(...) on the live database
-- 2026-04-26, with the single mutation being:
--   * Two appearances of `inv.total_invoice_usd * 128.5` replaced by
--     `inv.total_invoice_usd * public.fn_currency_get_rate()`
--     (in lagged_revenue_kes column expression and gross_profit_kes column
--     expression).
--
-- Column shape preserved byte-for-byte (9 columns, same types, same order):
--   project_id, expense_month, revenue_source_month,
--   lagged_revenue_kes, lagged_revenue_usd, current_expenses_kes,
--   gross_profit_kes, has_lagged_invoice, revenue_kes_estimated.
--
-- Downstream view lagged_revenue_company_month is a pure aggregate over this
-- view and inherits the rate change automatically; deliberately not touched.
--
-- COALESCE(NULLIF(...), <rate-multiplied USD>, 0) outer structure preserved as
-- defensive belt-and-suspenders behavior. After backfill, the first branch
-- (inv.total_invoice_kes) hits for every existing invoice; the rate-multiplied
-- branch only fires for any hypothetical future USD-only invoice.

CREATE OR REPLACE VIEW public.lagged_revenue_by_project_month AS
 SELECT pm.project_id,
    pm.year_month AS expense_month,
    to_char(to_date(pm.year_month, 'YYYY-MM'::text) - '1 mon'::interval, 'YYYY-MM'::text) AS revenue_source_month,
    COALESCE(NULLIF(inv.total_invoice_kes, 0::numeric), inv.total_invoice_usd * public.fn_currency_get_rate(), 0::numeric) AS lagged_revenue_kes,
    COALESCE(inv.total_invoice_usd, 0::numeric) AS lagged_revenue_usd,
    COALESCE(exp.total_expenses_kes, 0::numeric) AS current_expenses_kes,
    COALESCE(NULLIF(inv.total_invoice_kes, 0::numeric), inv.total_invoice_usd * public.fn_currency_get_rate(), 0::numeric) - COALESCE(exp.total_expenses_kes, 0::numeric) AS gross_profit_kes,
    CASE
        WHEN inv.total_invoice_kes IS NOT NULL OR inv.total_invoice_usd IS NOT NULL THEN true
        ELSE false
    END AS has_lagged_invoice,
    COALESCE(inv.total_invoice_usd, 0::numeric) > 0::numeric AND (inv.total_invoice_kes IS NULL OR inv.total_invoice_kes = 0::numeric) AS revenue_kes_estimated
   FROM ( SELECT DISTINCT expenses.project_id,
            expenses.year_month
           FROM expenses
          WHERE expenses.project_id IS NOT NULL AND expenses.expense_type = 'project_expense'::expense_type
        UNION
         SELECT DISTINCT invoices.project_id,
            invoices.billing_period AS year_month
           FROM invoices) pm
     LEFT JOIN ( SELECT invoices.project_id,
            invoices.billing_period AS invoice_month,
            sum(invoices.amount_kes) AS total_invoice_kes,
            sum(invoices.amount_usd) AS total_invoice_usd
           FROM invoices
          GROUP BY invoices.project_id, invoices.billing_period) inv ON inv.project_id = pm.project_id AND inv.invoice_month = to_char(to_date(pm.year_month, 'YYYY-MM'::text) - '1 mon'::interval, 'YYYY-MM'::text)
     LEFT JOIN ( SELECT expenses.project_id,
            expenses.year_month,
            sum(expenses.amount_kes) AS total_expenses_kes
           FROM expenses
          WHERE expenses.project_id IS NOT NULL AND expenses.expense_type = 'project_expense'::expense_type AND expenses.lifecycle_status = 'confirmed'::text
          GROUP BY expenses.project_id, expenses.year_month) exp ON exp.project_id = pm.project_id AND exp.year_month = pm.year_month
  WHERE pm.year_month >= to_char(CURRENT_DATE - '6 mons'::interval, 'YYYY-MM'::text);
