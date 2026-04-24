-- =========================================================
-- Fix F-27: variance_summary_by_project — sibling-budget fan-out fix
--
-- Background:
--   Migration 00009 originally defined variance_summary_by_project as
--   a single LEFT JOIN of budgets → expenses on (project_id, year_month).
--   When a single project has multiple budget rows for the same month
--   (sibling budgets, e.g. TL + Accountant + supplemental — all valid
--   per the data model), each expense was joined once per sibling,
--   producing a cartesian fan-out.
--
--   Fix 2a-bis (migration 00025) added the lifecycle_status='confirmed'
--   filter to the original join. The lifecycle filter was correct, but
--   the underlying fan-out remained. Smoke E (2026-04) measured:
--     via_view  = 7,657,108.88 KES
--     raw confd = 4,024,469.94 KES
--     ratio     = 1.903x  (matches sibling-count distribution)
--
-- User business rule (confirmed 2026-04-24):
--   Multiple approved sibling budgets per project-month are LEGITIMATE.
--   They represent separate, intentional budget submissions on different
--   days as new needs arise (initial month-start budget plus mid-month
--   supplementals). The correct aggregate for a project-month's total
--   approved budget is the SUM of all approved siblings. The correct
--   aggregate for actual spend is the SUM of confirmed project expenses
--   for that project-month, counted ONCE.
--
-- Approach:
--   * Pre-aggregate budgets per (project_id, year_month) in a subquery
--     so siblings sum cleanly into a single budget_kes value.
--   * Pre-aggregate expenses per (project_id, year_month) in a subquery
--     so each expense counts exactly once into actual_kes (no fan-out).
--   * Enumerate the (project_id, year_month) keyset from the union of
--     budgets + confirmed project expenses, so a project-month with
--     either-or-both still appears as a row (matches original LEFT JOIN
--     semantics on the keyset side).
--
-- Issue A decision (per user, Phase 1):
--   The actual aggregate filters expense_type = 'project_expense'.
--   The original view did NOT have this filter and would have included
--   shared_expense rows that happened to have a project_id populated.
--   Per user decision, shared overhead is allocated separately via
--   fn_calculate_overhead_allocations; counting shared-tagged-to-project
--   here would double-count once allocations run. Filter added.
--
-- Out of scope for this fix (tracked separately in AUDIT_1_CORRECTNESS.md):
--   * F-28: reclassified to Low — not a data bug per user rule.
--   * F-29: fn_generate_red_flags overspending uses the same flawed
--     join pattern. Same business rule applies. Queued for next session.
--   * F-30: latent — once F-07 (resubmit-in-place) is fixed and budgets
--     can carry multiple approved historical versions, the budget_agg
--     subquery here will need an additional
--     `bv.version_number = b.current_version` filter. Does not fire
--     today because F-07 keeps each budget at exactly one approved
--     version.
--
-- Column shape preserved byte-for-byte vs the live view captured
-- 2026-04-24 (six columns, same names, same order, same types):
--   project_id (uuid)
--   project_name (text)
--   year_month (text)
--   budget_kes (numeric)
--   actual_kes (numeric)
--   variance_kes (numeric)
--
-- Cast styles ('approved'::budget_status, 'confirmed'::text,
-- 'project_expense'::expense_type, 0::numeric) match the
-- pg_get_viewdef normalization to minimize spurious diffs in future
-- audits.
--
-- variance_summary_company (00009) is a pure aggregate over this view
-- and inherits the fix automatically; deliberately not touched.
-- =========================================================

CREATE OR REPLACE VIEW public.variance_summary_by_project AS
SELECT
  pm.project_id,
  p.name AS project_name,
  pm.year_month,
  COALESCE(budget_agg.total_budget_kes, 0::numeric) AS budget_kes,
  COALESCE(exp_agg.total_actual_kes, 0::numeric) AS actual_kes,
  COALESCE(budget_agg.total_budget_kes, 0::numeric) - COALESCE(exp_agg.total_actual_kes, 0::numeric) AS variance_kes
FROM (
  SELECT DISTINCT project_id, year_month FROM budgets WHERE project_id IS NOT NULL
  UNION
  SELECT DISTINCT project_id, year_month FROM expenses
    WHERE expense_type = 'project_expense'::expense_type
      AND lifecycle_status = 'confirmed'::text
      AND project_id IS NOT NULL
) pm
LEFT JOIN projects p ON p.id = pm.project_id
LEFT JOIN (
  SELECT b.project_id, b.year_month, SUM(bv.total_amount_kes) AS total_budget_kes
  FROM budgets b
  JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'::budget_status
  WHERE b.project_id IS NOT NULL
  GROUP BY b.project_id, b.year_month
) budget_agg ON budget_agg.project_id = pm.project_id AND budget_agg.year_month = pm.year_month
LEFT JOIN (
  SELECT e.project_id, e.year_month, SUM(e.amount_kes) AS total_actual_kes
  FROM expenses e
  WHERE e.expense_type = 'project_expense'::expense_type
    AND e.lifecycle_status = 'confirmed'::text
    AND e.project_id IS NOT NULL
  GROUP BY e.project_id, e.year_month
) exp_agg ON exp_agg.project_id = pm.project_id AND exp_agg.year_month = pm.year_month
WHERE pm.project_id IS NOT NULL;
