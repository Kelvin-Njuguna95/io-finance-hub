-- =========================================================
-- Fix F-01: Add lifecycle_status filter to lagged_revenue_by_project_month
--
-- The view's current_expenses_kes aggregate sums all project expenses
-- regardless of lifecycle_status, while every dashboard query filters
-- lifecycle_status = 'confirmed'. This causes the view's gross_profit_kes
-- to disagree with every page that computes profit from the same data.
--
-- Fix: add AND expenses.lifecycle_status = 'confirmed' to the expense
-- aggregation subquery's WHERE clause. Revenue logic and column shape
-- are preserved byte-for-byte from 00021_fix_lagged_revenue_views.sql,
-- so CREATE OR REPLACE VIEW is safe and the dependent
-- lagged_revenue_company_month view does not need to be touched.
--
-- Deferred (F-26): seven other FROM expenses aggregates that also
-- omit the lifecycle filter — fn_calculate_project_profitability,
-- fn_calculate_overhead_allocations, fn_generate_monthly_snapshot,
-- fn_generate_red_flags, red-flag budget-vs-actuals,
-- variance_summary_by_project, and the 00021 keyset. To be addressed
-- in fix 2a-bis.
-- =========================================================

CREATE OR REPLACE VIEW public.lagged_revenue_by_project_month AS
SELECT
  pm.project_id,
  pm.year_month AS expense_month,
  to_char(to_date(pm.year_month, 'YYYY-MM') - interval '1 month', 'YYYY-MM') AS revenue_source_month,
  COALESCE(NULLIF(inv.total_invoice_kes, 0), inv.total_invoice_usd * 128.5, 0::numeric) AS lagged_revenue_kes,
  COALESCE(inv.total_invoice_usd, 0::numeric) AS lagged_revenue_usd,
  COALESCE(exp.total_expenses_kes, 0::numeric) AS current_expenses_kes,
  COALESCE(NULLIF(inv.total_invoice_kes, 0), inv.total_invoice_usd * 128.5, 0::numeric) - COALESCE(exp.total_expenses_kes, 0::numeric) AS gross_profit_kes,
  (
    (COALESCE(inv.total_invoice_usd, 0::numeric) > 0)
    AND (inv.total_invoice_kes IS NULL OR inv.total_invoice_kes = 0)
  ) AS revenue_kes_estimated,
  CASE
    WHEN inv.total_invoice_kes IS NOT NULL OR inv.total_invoice_usd IS NOT NULL THEN true
    ELSE false
  END AS has_lagged_invoice
FROM (
  SELECT DISTINCT expenses.project_id, expenses.year_month
  FROM expenses
  WHERE expenses.project_id IS NOT NULL
    AND expenses.expense_type = 'project_expense'::expense_type
  UNION
  SELECT DISTINCT invoices.project_id, invoices.billing_period AS year_month
  FROM invoices
) pm
LEFT JOIN (
  SELECT
    invoices.project_id,
    invoices.billing_period AS invoice_month,
    SUM(invoices.amount_kes) AS total_invoice_kes,
    SUM(invoices.amount_usd) AS total_invoice_usd
  FROM invoices
  GROUP BY invoices.project_id, invoices.billing_period
) inv
  ON inv.project_id = pm.project_id
 AND inv.invoice_month = to_char(to_date(pm.year_month, 'YYYY-MM') - interval '1 month', 'YYYY-MM')
LEFT JOIN (
  SELECT
    expenses.project_id,
    expenses.year_month,
    SUM(expenses.amount_kes) AS total_expenses_kes
  FROM expenses
  WHERE expenses.project_id IS NOT NULL
    AND expenses.expense_type = 'project_expense'::expense_type
    AND expenses.lifecycle_status = 'confirmed'
  GROUP BY expenses.project_id, expenses.year_month
) exp
  ON exp.project_id = pm.project_id
 AND exp.year_month = pm.year_month
WHERE pm.year_month >= to_char(CURRENT_DATE - interval '6 months', 'YYYY-MM');
