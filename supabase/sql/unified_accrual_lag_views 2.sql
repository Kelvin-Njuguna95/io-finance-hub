-- Unified one-month accrual lag views (reporting-only)
-- Payment month P => service month S = P - 1 month

CREATE OR REPLACE VIEW lagged_revenue_by_project_month AS
SELECT
  e.project_id,
  e.payment_month,
  (e.payment_month - INTERVAL '1 month')::DATE AS service_month,
  COALESCE(inv.total_invoice_amount, 0) AS lagged_revenue,
  COALESCE(exp.total_expenses, 0) AS recognised_expenses,
  COALESCE(inv.total_invoice_amount, 0) - COALESCE(exp.total_expenses, 0) AS gross_profit,
  TO_CHAR((e.payment_month - INTERVAL '1 month')::DATE, 'Month YYYY') AS service_month_label,
  TO_CHAR(e.payment_month, 'Month YYYY') AS payment_month_label,
  TO_CHAR((e.payment_month - INTERVAL '1 month')::DATE, 'Month YYYY') || ' (paid in ' || TO_CHAR(e.payment_month, 'Month YYYY') || ')' AS display_label,
  CASE WHEN inv.total_invoice_amount IS NULL THEN FALSE ELSE TRUE END AS has_lagged_invoice
FROM (
  SELECT DISTINCT
    project_id,
    DATE_TRUNC('month', COALESCE(period_month, expense_date))::DATE AS payment_month
  FROM expenses
  WHERE project_id IS NOT NULL
    AND lifecycle_status = 'confirmed'
) e
LEFT JOIN (
  SELECT
    project_id,
    DATE_TRUNC('month', invoice_date)::DATE AS invoice_month,
    SUM(amount) AS total_invoice_amount
  FROM invoices
  GROUP BY project_id, DATE_TRUNC('month', invoice_date)::DATE
) inv
  ON inv.project_id = e.project_id
 AND inv.invoice_month = (e.payment_month - INTERVAL '1 month')::DATE
LEFT JOIN (
  SELECT
    project_id,
    DATE_TRUNC('month', COALESCE(period_month, expense_date))::DATE AS payment_month,
    SUM(amount) AS total_expenses
  FROM expenses
  WHERE project_id IS NOT NULL
    AND lifecycle_status = 'confirmed'
  GROUP BY project_id, DATE_TRUNC('month', COALESCE(period_month, expense_date))::DATE
) exp
  ON exp.project_id = e.project_id
 AND exp.payment_month = e.payment_month;

CREATE OR REPLACE VIEW lagged_revenue_company_month AS
SELECT
  payment_month,
  service_month,
  SUM(lagged_revenue) AS lagged_revenue,
  SUM(recognised_expenses) AS recognised_expenses,
  SUM(gross_profit) AS gross_profit,
  MAX(service_month_label) AS service_month_label,
  MAX(payment_month_label) AS payment_month_label,
  MAX(display_label) AS display_label
FROM lagged_revenue_by_project_month
GROUP BY payment_month, service_month;

CREATE OR REPLACE VIEW lagged_overhead_by_month AS
SELECT
  DATE_TRUNC('month', COALESCE(period_month, expense_date))::DATE AS payment_month,
  (DATE_TRUNC('month', COALESCE(period_month, expense_date)) - INTERVAL '1 month')::DATE AS service_month,
  SUM(amount) AS recognised_overhead,
  overhead_category_id
FROM expenses
WHERE expense_type = 'shared_expense'
  AND lifecycle_status = 'confirmed'
GROUP BY DATE_TRUNC('month', COALESCE(period_month, expense_date))::DATE, overhead_category_id;
