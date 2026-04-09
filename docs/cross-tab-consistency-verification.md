# Cross-Tab Consistency Verification

## Test 1: Invoice → Outstanding Receivables consistency
PASS — Both views now use `getOutstandingInvoices` and outstanding is derived from the same payment join shape.

## Test 2: Expense Queue → Budget vs Actual consistency
PASS — Budget vs Actual now uses `getConfirmedExpensesByMonth` with `lifecycle_status = confirmed`.

## Test 3: Dashboard stat cards → Report pages consistency
PASS — Red Flags dashboard and detail page now read through shared red-flag query helpers.

## Test 4: Budget list → PM review queue consistency
PASS — PM queue count now uses PM-review-only canonical filter.

## Test 5: Misc draws → Misc report totals consistency
PASS — Misc report loader and draw loader for project-period now use shared misc query helpers.

## Test 6: Red flags count → Red flags page consistency
PASS — Both use `is_resolved` filtering via shared `red-flags` query helper.

## Test 7: Project dropdown consistency
PASS — Invoice form, expense form, budget form, and misc project loaders now use shared active-project query patterns.

## Test 8: Currency consistency
PASS — Shared currency formatter now standardises display labels (`KES`, `USD`) and decimals.
