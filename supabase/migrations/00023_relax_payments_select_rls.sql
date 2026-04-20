-- Align payments SELECT visibility with invoices SELECT visibility.
-- Previously, PMs/TLs could see invoices but not their payments, leading
-- to "all invoices outstanding" bugs on /revenue.

DROP POLICY IF EXISTS payments_select ON payments;

CREATE POLICY payments_select ON payments FOR SELECT
USING (
  -- Any authenticated staff user whose invoice row is visible to them.
  -- Invoices are gated by invoices_select; if the caller can see the
  -- invoice, they can see its payments.
  EXISTS (
    SELECT 1 FROM invoices i WHERE i.id = payments.invoice_id
  )
);
