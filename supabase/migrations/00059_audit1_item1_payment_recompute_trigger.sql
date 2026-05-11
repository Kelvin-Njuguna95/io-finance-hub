-- ===========================================================================
-- AUDIT 1 — ITEM 1: payment recompute trigger + idempotent reconciliation
-- ===========================================================================
-- Closes the lost-update race documented in AUDIT1-ITEM1-DIAGNOSIS.md §5.
--
-- Source of truth (Phase 1.5 A1): SUM(payments.amount_usd) per invoice.
-- The trigger guarantees that after every INSERT/UPDATE/DELETE on payments:
--   invoices.total_paid          = SUM(payments.amount_usd) for the invoice
--   invoices.balance_outstanding = max(invoices.amount_usd - total_paid, 0)
--   invoices.status              ∈ {paid, partially_paid, sent, <preserved>}
--   invoices.payment_status      = invoices.status::text (Phase 1.5 A2)
--
-- Application-layer UPDATEs in revenue/page.tsx and payment-form-dialog.tsx
-- stay in place — they write the same values the trigger writes, so they
-- degrade to harmless no-ops (last-write-wins on identical values).
-- Removal is deferred to a follow-up ticket after ≥2 weeks of clean soak.
--
-- Out of scope:
--   * Collapsing payment_status into status (Phase 1.5 A2)
--   * Unified /api/payments route (Phase 1.5 A4)
--   * Removing application-layer UPDATEs (Phase 1.5 A4)
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Trigger function
-- ---------------------------------------------------------------------------
-- See AUDIT1-ITEM1-DESIGN.md §1 for the full annotated rationale.

CREATE OR REPLACE FUNCTION public.fn_payments_recompute_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id            UUID;
  v_total_paid    NUMERIC;
  v_invoice_total NUMERIC;
  v_balance       NUMERIC;
  v_current_status invoice_status;
  v_status        invoice_status;
BEGIN
  FOR v_id IN
    SELECT DISTINCT id_val
    FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.invoice_id ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.invoice_id ELSE NULL END
    ]) AS id_val
    WHERE id_val IS NOT NULL
  LOOP
    SELECT COALESCE(SUM(amount_usd), 0)
      INTO v_total_paid
      FROM public.payments
     WHERE invoice_id = v_id;

    SELECT amount_usd, status
      INTO v_invoice_total, v_current_status
      FROM public.invoices
     WHERE id = v_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_balance := GREATEST(COALESCE(v_invoice_total, 0) - v_total_paid, 0);

    IF v_total_paid <= 0 AND v_balance > 0 THEN
      IF v_current_status IN ('paid', 'partially_paid') THEN
        v_status := 'sent';
      ELSE
        v_status := v_current_status;
      END IF;
    ELSIF v_total_paid > 0 AND v_balance > 0 THEN
      v_status := 'partially_paid';
    ELSE
      v_status := 'paid';
    END IF;

    UPDATE public.invoices
       SET total_paid          = v_total_paid,
           balance_outstanding = v_balance,
           status              = v_status,
           payment_status      = v_status::text
     WHERE id = v_id;
  END LOOP;

  RETURN NULL;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. Trigger
-- ---------------------------------------------------------------------------
-- DROP IF EXISTS + CREATE pattern matches 00028's convention so re-running
-- the migration is idempotent.

DROP TRIGGER IF EXISTS tr_payments_recompute_invoice ON public.payments;
CREATE TRIGGER tr_payments_recompute_invoice
  AFTER INSERT OR UPDATE OR DELETE
  ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_payments_recompute_invoice();


-- ---------------------------------------------------------------------------
-- 3. One-shot reconciliation backfill
-- ---------------------------------------------------------------------------
-- Recomputes every invoice's denormalised columns from SUM(payments.amount_usd).
-- LEFT JOIN onto the per-invoice sum subquery so invoices with zero payments
-- still get reconciled (their total_paid lands at 0, balance_outstanding lands
-- at amount_usd, and status falls through the same decision tree the trigger
-- uses).
--
-- Idempotent — safe to re-run. If every row is already consistent the UPDATE
-- still touches the row but writes the same value back (no-op semantically,
-- though set_updated_at_invoices will bump updated_at — see note below).
--
-- NOTE on set_updated_at_invoices: the BEFORE UPDATE trigger from
-- 00004_functions.sql:79 will bump invoices.updated_at on every row this
-- statement touches. Acceptable: the reconciliation is a one-time event and
-- the updated_at bump captures "trigger reconciliation happened here." If
-- this becomes objectionable, a SET LOCAL session_replication_role = 'replica'
-- block could suppress it, but that's overengineering for a one-shot run.

-- Drive the subquery from invoices LEFT JOIN payments so every invoice
-- gets a row (with total_paid = 0 when no payments exist). The outer
-- UPDATE then writes the recomputed values onto each invoice.
UPDATE public.invoices AS i
   SET total_paid          = p.total_paid,
       balance_outstanding = GREATEST(COALESCE(i.amount_usd, 0) - p.total_paid, 0),
       status = CASE
         WHEN p.total_paid <= 0
              AND GREATEST(COALESCE(i.amount_usd, 0) - p.total_paid, 0) > 0
           THEN CASE
                  WHEN i.status IN ('paid', 'partially_paid') THEN 'sent'::invoice_status
                  ELSE i.status
                END
         WHEN p.total_paid > 0
              AND GREATEST(COALESCE(i.amount_usd, 0) - p.total_paid, 0) > 0
           THEN 'partially_paid'::invoice_status
         ELSE 'paid'::invoice_status
       END,
       payment_status = CASE
         WHEN p.total_paid <= 0
              AND GREATEST(COALESCE(i.amount_usd, 0) - p.total_paid, 0) > 0
           THEN CASE
                  WHEN i.status IN ('paid', 'partially_paid') THEN 'sent'
                  ELSE i.status::text
                END
         WHEN p.total_paid > 0
              AND GREATEST(COALESCE(i.amount_usd, 0) - p.total_paid, 0) > 0
           THEN 'partially_paid'
         ELSE 'paid'
       END
  FROM (
    SELECT i2.id AS invoice_id,
           COALESCE(SUM(pay.amount_usd), 0) AS total_paid
      FROM public.invoices i2
      LEFT JOIN public.payments pay ON pay.invoice_id = i2.id
     GROUP BY i2.id
  ) AS p
 WHERE i.id = p.invoice_id;


-- ---------------------------------------------------------------------------
-- 4. Drift check (commented out — run manually after the migration applies)
-- ---------------------------------------------------------------------------
-- Expected: 0 rows. Returns invoices whose denormalised total_paid disagrees
-- with the authoritative SUM(payments.amount_usd).
--
-- SELECT i.id,
--        i.invoice_number,
--        i.total_paid AS denorm_total_paid,
--        COALESCE((SELECT SUM(amount_usd) FROM public.payments
--                   WHERE invoice_id = i.id), 0) AS ledger_total_paid
--   FROM public.invoices i
--  WHERE i.total_paid
--          != COALESCE((SELECT SUM(amount_usd) FROM public.payments
--                        WHERE invoice_id = i.id), 0);
