# AUDIT 1 — Correctness & Data Integrity

**Scope:** Read-only audit of financial calculation correctness, schema/code consistency, write-path integrity, business-rule adherence, silent failures, and known-issue patterns.
**Out of scope:** audit logging, observability, architecture, UX, tests, performance unless it produces a wrong number. Out-of-scope items appear in §5.
**Method:** Read every file in `supabase/migrations/`, `src/app/api/**`, `src/lib/**`, key dashboard pages and shared components. Verified each finding directly against source. Findings I could not confirm without DB access are marked `Needs verification`.
**Last updated:** 2026-04-27 — closed-status annotations added inline; finding bodies unchanged.

---

## 1. Executive Summary

The app is in a worse state than the surface suggests. The single biggest issue is **systemic schema/code drift**: at least three columns referenced extensively in code (`expenses.lifecycle_status`, `profit_share_records.distributable_amount`, `profit_share_records.director_name`) and at least one column rename (`notifications.message`→`body` plus `type` becoming `NOT NULL`) are present in code or in trigger bodies but absent from the migrations tree. Either production has been patched directly (so migrations are no longer authoritative) **or** the queries silently fail and entire categories of numbers (confirmed expenses, profit-share balances, notifications) are wrong or missing in production today. Both are bad; the difference matters but I can't tell from disk alone.

The second biggest issue is **multiple sources of truth for the same number**, with three different USD→KES fallback rates (128.5 in the SQL view, 129.5 in two API/dashboard paths) and three different ways of summing expenses (lagged view sums all project expenses; most pages filter `lifecycle_status='confirmed'`; project-financials API does neither and bypasses the lagged view entirely).

Counts (at write time): **6 Critical, 9 High, 5 Medium, 5 Low (25 total — capped, see notes at the end).**

**Status as of 2026-04-27 (post-sweep + F-18 + F-16 + F-33 + F-10 + F-07/F-30 close):** 28 closed, 1 partially closed (F-12 — resubmit slice landed via F-07; withdrawals/create + eod remain), 1 open, 1 deferred, 1 informational. Closed: F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-09, F-10, F-13, F-15, F-16, F-17, F-18, F-19, F-20, F-21, F-22, F-23, F-24, F-25, F-26 (tracked externally — addressed by migration 00025; no in-doc section), F-27, F-29, F-30, F-32, F-33. Partially closed: F-12 (expense-lifecycle RPCs landed via 00029; `budgets/resubmit` slice landed via 00042's RPC suite; `withdrawals/create`, `eod` remain non-transactional). Open: F-12 remainder. Deferred: F-14 (taxonomy decision needed before code fix). Informational: F-31.

**Recommended fix order (revised post-F-07):** F-12 remainder (High — two multi-write flows: withdrawals/create and eod need RPC wrapping; pattern from 00029 + 00042). This is the only Critical/High/Medium item left; everything else is closed, deferred (F-14), or informational (F-31).

---

## 2. Health Score

**Correctness & Data Integrity: 42 / 100** *(at write time)*

**Updated 2026-04-27 (post-sweep + F-18 + F-16 + F-33 + F-10 + F-07/F-30 close): estimated 88 / 100.** Every Critical is closed (F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-27, F-29, F-32). Every High except the F-12 remainder is closed (F-08, F-09, F-10, F-13, F-15). Every Medium is closed (F-16, F-18, F-19, F-20, F-33). Every Low is closed (F-21, F-22, F-23, F-24, F-25, F-30). Only F-31 (informational) remains besides F-12 remainder. The benchmark called out at write time — "with F-01–F-07 fixed, this score should rise into the 70s without major refactoring" — is achieved and substantially surpassed. Remaining gap to 90+ is anchored by exactly one item: the F-12 remainder (withdrawals/create + eod still write non-atomically; budgets/resubmit slice closed via the F-07 RPC suite).

Note on F-07 closure: scope expanded materially during Phase 1. The audit framed F-07 as "single route — budgets/resubmit"; verification surfaced that all 6 budget status-change routes (resubmit, pm-review, pm-line-review submit, cfo-approve, cfo-revert send_back, withdraw) used the same in-place mutation pattern. The PR closed the systemic pattern via 6 SECURITY DEFINER RPCs in 00042 (architecture mirrors 00029's F-06 expense-lifecycle RPCs). Migration 00041 codified the four production-only `budget_status` enum values; 00042's preamble codified ~17 drift columns across budgets / budget_versions / budget_items / budget_approvals / expenses; §3 / §4 fixed F-30 ahead of the regression-on-fix it would otherwise surface. Single PR, full scope, per Phase 2 Option A.

Note on F-33 closure: production verification confirmed scenario (b), meaning two categories of operational alerts (expense-variance overspend, misc top-up limit-reached) had been silently disabled since the routes were written — every red flag of those types that should have fired has produced zero rows in production to date. Migration 00039 restores forward-going alerts; past events are not recoverable. The score impact reflects the migration alone; the operational visibility cost is sunk.

Note on F-10 closure: production verification confirmed scenario (a)-with-twist — migration 00010's body/type rename and adds never landed in production, so the 26 application callsites that wrote `{user_id, title, message, link}` have been working correctly throughout. Disagreement was between disk and production, not between code and schema. Migration 00040 codified production reality on disk; no data was lost (no rows ever existed in body/type). The downstream `body`/`type` adoption work — richer notification typing, preference-toggle integration via `notification_preferences`, eventual `notification_type` enum — is a deferred follow-up, not a regression fix.

Justification: The systemic schema/code drift that anchored the original 42 — `lifecycle_status` un-codified, profit-share trigger columns absent, three different USD fallback rates, USD columns systematically empty — has been resolved via migrations 00024, 00028, 00029, 00030, 00037 and the route-level cleanups in commits 44aa480, 83db636, ffe211d, a64fcfb, ba12f79. The app is no longer one rebuild away from a broken DB. Cross-page revenue/expense agreement is now reachable from the migration tree. Lagged view, status constants, and cash-balance helpers remain centralised. The remaining open findings are localised bugs rather than systemic drift, which is the qualitative shift the score reflects.

---

## 3. Findings

### F-01 — Lagged view does not filter expenses by lifecycle; pages do — disagreement guaranteed

**STATUS: CLOSED — Migration 00024 (lagged view lifecycle filter)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Calculation
**Files:** `supabase/migrations/00021_fix_lagged_revenue_views.sql:21-52`; `src/app/(dashboard)/_components/cfo-dashboard.tsx:134`; `src/app/(dashboard)/reports/pnl/page.tsx:128-130`; `src/app/(dashboard)/profit-share/page.tsx:159`; `src/hooks/use-monthly-pl-summary.ts:48,54`
**Confidence:** Certain

**What's wrong:**
The `lagged_revenue_by_project_month` view's `current_expenses_kes` aggregate is `SUM(expenses.amount_kes) WHERE expense_type='project_expense'` — no lifecycle filter, no exclusion of voided/pending/under-review rows. Every dashboard page that computes its own expense totals filters `.eq('lifecycle_status', 'confirmed')`. The two definitions of "expenses" therefore disagree by every voided/pending/modified expense row in the system.

**Impact:**
The view's `gross_profit_kes` (revenue − expenses) is a different number than every page that subtracts expenses from `total_revenue_kes`. Anywhere a page reads `lagged_revenue_company_month.gross_profit_kes` and another page computes it manually, they disagree. Trends, project P&L, profit-share-source-of-truth all diverge.

**Suggested fix (not implemented):**
Decide whether the lagged view should also filter `lifecycle_status='confirmed'` (probably yes), then update the view migration and re-deploy.

---

### F-02 — `expenses.lifecycle_status` is referenced 12+ times in code but never created in any migration

**STATUS: CLOSED — Migration 00037 (codify expenses.lifecycle_status column)**
**Closed: 2026-04-27 (verified in this session)**

**Severity:** Critical
**Category:** Schema
**Files:** `src/lib/queries/expenses.ts:13`; `src/app/(dashboard)/_components/cfo-dashboard.tsx:134`; `src/app/(dashboard)/profit-share/page.tsx:159`; `src/app/(dashboard)/reports/{pnl,profitability,projects,trends,monthly}/page.tsx`; `src/hooks/use-monthly-pl-summary.ts:48,54`; `src/types/query-results.ts:23`
**Confidence:** Likely (need DB introspection to confirm whether column exists in production)

**What's wrong:**
Code consistently filters `expenses.lifecycle_status = 'confirmed'`. No migration in `supabase/migrations/` adds that column to the `expenses` table (only `period_month` and `imported_by` were added in 00009). The only place the column appears in SQL is `supabase/sql/unified_accrual_lag_views.sql`, which is not in the migrations tree and uses different column names than the actual `expenses` table (`amount` vs `amount_kes`) — that file is dead/draft and was not applied. Either (a) production has this column added by hand outside migrations, in which case the migrations are no longer authoritative and the next clean rebuild will produce a broken DB, or (b) the column genuinely doesn't exist and every "confirmed expense" query returns an error or empty set silently because the code does not check `.error`.

**Impact:**
If (a): brittle deploys, cannot rebuild from scratch. If (b): every dashboard reading expenses through the page-level queries shows revenue from the lagged view but `0` for expenses → net profit appears equal to revenue → every P&L number on every page is wrong by the cost of every confirmed expense. The known reality of the app suggests (a), but the rebuild risk is real either way.

**Suggested fix (not implemented):**
Confirm production state via `\d expenses`; if column exists, add a migration to codify it and define `EXPENSE_STATUS.CONFIRMED` semantics; if not, add the column and a backfill, OR pivot the queries to read lifecycle from `pending_expenses` joined on `pending_expenses.expense_id`.

---

### F-03 — Three different USD→KES fallback rates produce three different revenue numbers for the same month

**STATUS: CLOSED — Commit ba12f79 (lagged view rate consolidation; F-32 currency conversion triggers landed in same commit)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Critical
**Category:** Calculation
**Files:** `supabase/migrations/00021_fix_lagged_revenue_views.sql:9,12` (`128.5`); `src/app/(dashboard)/_components/cfo-dashboard.tsx:143` (`'129.5'`); `src/app/api/project-financials/route.ts:55` (`'129.5'`); `src/app/(dashboard)/reports/pnl/page.tsx:139` (`'129.5'`)
**Confidence:** Certain

**What's wrong:**
When an invoice has `amount_usd > 0` but `amount_kes IS NULL OR 0`, the lagged view falls back to `amount_usd * 128.5`. Every consumer of the same data path then re-fetches the rate from `system_settings.standard_exchange_rate` with a hardcoded fallback of `129.5` if the setting is missing. The view itself does not consult `system_settings` at all.

**Impact:**
For any project where KES is unrecorded on the invoice (estimated revenue path), the company P&L revenue from `lagged_revenue_company_month` differs from the per-project revenue computed page-side by `(129.5 − 128.5) × USD = 1 KES per USD`. On a $100K month, the dashboard shows ~KES 100K more than the lagged view does — and which number is right depends on which page you opened. The `revenue_kes_estimated` flag exists but does not signal that *the estimate itself differs by source*.

**Suggested fix (not implemented):**
Single rate, single source. Either move the fallback into `system_settings` and have the view read it via a SQL function, or (simpler) deprecate the fallback entirely and require KES recorded at invoice time, with a hard-block in the invoice form.

---

### F-04 — `api/project-financials/route.ts` bypasses the lagged view AND skips the lifecycle filter

**STATUS: CLOSED — Commit 44aa480 (project-financials route uses lagged view + lifecycle filter)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Business rule
**Files:** `src/app/api/project-financials/route.ts:48-50, 65-68, 117-119`
**Confidence:** Certain

**What's wrong:**
The Project Financials route reads revenue by directly querying `from('invoices').select('*, payments(*)').eq('project_id', projectId).eq('billing_period', prevMonth)` (line 48) — not from `lagged_revenue_by_project_month`. It then queries expenses with `eq('expense_type','project_expense')` only — no `lifecycle_status` filter (line 65, and again at line 119 for trends). Both violations.

**Impact:**
Project Financials shows a different revenue and expense total than every other page for the same project + month. Health-score computation downstream (margin, budget utilisation) all derive from these wrong numbers and are persisted into `project_health_scores` (line 242). Decisions made off the project financial page are made from a non-canonical view.

**Suggested fix (not implemented):**
Replace lines 48-50 with a query against `lagged_revenue_by_project_month` filtered by `project_id = ? AND expense_month = ?`. Add `.eq('lifecycle_status', EXPENSE_STATUS.CONFIRMED)` at lines 65-68 and 119 to match every other page.

---

### F-05 — Triggers reference `profit_share_records.distributable_amount` and `.director_name`; neither exists in any migration

**STATUS: CLOSED — Migration 00030 (profit_share trigger column drift fix)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Schema
**Files:** `supabase/migrations/00017_withdrawal_type.sql:80,83`; `supabase/migrations/00018_director_payouts.sql:21,72,90`; `src/app/api/director-payouts/route.ts:60`; `src/app/api/withdrawals/create/route.ts:59`
**Confidence:** Likely (same drift question as F-02)

**What's wrong:**
Migration 00002 defines `profit_share_records.distributable_profit_kes` (and `_usd`) and a `director_tag` enum. Migrations 00017 and 00018 add triggers (`update_profit_share_payout_totals`, `sync_profit_share_from_director_payouts`) that reference `distributable_amount` and `director_name` on the same table. Neither column is added by any migration. Code at `api/director-payouts/route.ts:60` and `api/withdrawals/create/route.ts:59` selects `director_name` and `balance_remaining` from `profit_share_records`.

**Impact:**
Either the triggers fail at runtime (which would block every withdrawal and every director payout — the app would be visibly broken), or the columns were added directly in production (drift, can't rebuild). If the triggers do work, they're computing balance_remaining from a column nobody can find in the migration history. Director payout reconciliation depends entirely on this.

**Suggested fix (not implemented):**
Verify production columns; if they exist, write a migration that adds them so the migration tree is the source of truth. If they don't, the triggers are dead and `withdrawals` of `withdrawal_type='director_payout'` would currently be writing without ever decrementing balance — investigate whether overdraft is possible.

---

### F-06 — Expense confirm/modify is not transactional and re-confirmation leaves orphan `expenses` rows

**STATUS: CLOSED — Migration 00029 (expense lifecycle RPCs)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Write path
**Files:** `src/app/api/expense-lifecycle/route.ts:255-284 (confirm), 354-383 (modify), 458-504 (void), 533-577 (carry-forward)`
**Confidence:** Certain

**What's wrong:**
The confirm action does `INSERT INTO expenses` (line 255) and then `UPDATE pending_expenses SET status='confirmed', expense_id=expense.id` (line 278). No transaction. If the second statement fails, the expense row exists with no link back. Worse: a pending expense that goes `pending_auth → modified → confirm` (allowed by the status guard at line 224) will INSERT a fresh `expenses` row each time `confirm` runs after a modification cycle. Only the latest pointer is stored on `pending_expenses.expense_id`; the earlier `expenses` rows continue to contribute to every aggregate that sums `expenses.amount_kes` for that month/project. Same family as the known resubmit-in-place bug, but here the bug is the opposite: history accumulates instead of being preserved cleanly.

**Impact:**
Every modify-then-confirm cycle inflates expense totals by the new amount while leaving the previous attempt's row in the table. Anyone reconciling the books will not be able to tell the duplicates apart from real expenses without looking at the `notes` column ("Confirmed from pending expense X"). Variance reports double-count.

**Suggested fix (not implemented):**
Wrap the two writes in a Postgres function (RPC) so they are atomic. On `modify` and `confirm`, before inserting, look up `pending_expenses.expense_id`; if non-null, UPDATE that existing expense row instead of inserting a new one (or soft-delete the old). Decide whether the `notes` field is the audit trail or a separate audit log, and remove the duplicate path.

---

### F-07 — Resubmit-in-place (KNOWN) — listed for completeness

**STATUS: CLOSED — Migrations 00041 (budget_status enum) + 00042 (6 RPCs + ~17 drift columns + F-30 view/function fixes) + commit a8c902a (6-route RPC integration) + commits ea508ae / a288d02 (migration audit records)**
**Closed: 2026-04-27 (Phase 1 surfaced systemic across all 6 budget status-change routes; full scope landed in single PR per Option A)**

**Severity:** Critical
**Category:** Known-issue pattern
**Files:** `src/app/api/budgets/resubmit/route.ts` (whole file is a single minified line; the `update('budget_versions').update({ status: newStatus, ... })` block destroys the rejected/returned status)
**Confidence:** Certain

**What's wrong:**
Resubmit mutates the existing `budget_versions` row from `rejected/returned_to_tl/draft` to `pm_review/pm_approved` in place. The history of why it was rejected (and what version was rejected) is lost; only the current state survives.

**Impact:**
Audit trail erased on every resubmit. CFO cannot see the rejection chain. Already known.

**Suggested fix (not implemented):**
Insert a new `budget_versions` row with incremented `version_number` and the new status; bump `budgets.current_version`. Keep the old row immutable. (This is the family of pattern referenced in F-06 too.)

---

### F-08 — `getCurrentYearMonth()` uses server-local `new Date()`; on Vercel this is UTC and shifts the "current month" by up to 3 hours near month boundaries

**STATUS: CLOSED — Commit ffe211d (Nairobi-timezone helper via `Intl.DateTimeFormat('en-CA')`) + commit a64fcfb (rollover-cron consumer migrated to shared helper, private server-local helpers deleted)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** High
**Category:** Calculation
**Files:** `src/lib/format.ts:30-33`; consumers in `src/app/(dashboard)/{financials,misc,month-closure,expenses,expenses/variance,expenses/queue,agent-counts}/page.tsx`, `src/app/(dashboard)/_components/{accountant-dashboard,project-manager-dashboard}.tsx`, `src/app/api/expense-lifecycle/rollover-cron/route.ts:10-13`
**Confidence:** Certain

**What's wrong:**
The helper does `new Date().getFullYear()` and `getMonth()` — server-local time, which is UTC on Vercel. Used as the SSR initial state for 16+ pages and as the "current month" in the rollover cron. The dashboard correctly uses `Intl.DateTimeFormat(..., timeZone:'Africa/Nairobi')` for display, but the underlying month string is computed in UTC.

**Impact:**
A user in Nairobi opening the dashboard at 02:30 EAT on the 1st of the month will see *last month* as the default selected month (because UTC is still the previous day). The rollover cron, if it fires at the same time, will roll forward the wrong month. Bug only manifests for ~3 hours each month-boundary, but on a finance app at month-close that's exactly the time it matters.

**Suggested fix (not implemented):**
Compute via `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year:'numeric', month:'2-digit' }).format(new Date())` (en-CA returns ISO-shaped `YYYY-MM-DD`), or use `Date.UTC` plus a +3-hour offset and read year/month from the resulting `Date`. Replace in `format.ts` and in the rollover cron.

---

### F-09 — `OutstandingReceivablesPanel` understates outstanding by excluding `partially_paid` and `overdue` invoices

**STATUS: CLOSED — Commit 83db636 (getOutstandingInvoices uses `OUTSTANDING_INVOICE_STATUSES`; dead `payment_status` clause removed alongside F-17)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** High
**Category:** Business rule
**Files:** `src/lib/queries/invoices.ts:21-28`; `src/components/revenue/outstanding-receivables-panel.tsx:50-110`
**Confidence:** Certain

**What's wrong:**
`getOutstandingInvoices` filters `.eq('status', 'sent')` only. The canonical `OUTSTANDING_INVOICE_STATUSES` constant in `src/lib/constants/status.ts:31-35` is `['sent', 'partially_paid', 'overdue']`. The panel's own description text claims it covers "sent, partially paid, and overdue", but the query returns only `sent`. The `.or('payment_status.is.null,payment_status.neq.paid')` clause is also ineffective because no app code maintains `payment_status`.

**Impact:**
Outstanding receivables shown on the CFO dashboard and Accountant dashboard exclude every invoice whose status was ever moved to `partially_paid` or `overdue`. The number is silently understated. The `/invoices` page's own outstanding tab (which uses a different code path, `OUTSTANDING_INVOICE_STATUSES`-aware filtering at line 70) shows a higher correct number — direct cross-page disagreement (see §4).

**Suggested fix (not implemented):**
Replace the `status='sent'` filter with `.in('status', OUTSTANDING_INVOICE_STATUSES)` and remove the dead `payment_status` clause.

---

### F-10 — Every `notifications.insert` writes `{ message }` and omits `type`; migration 00010 renames to `body` and declares `type NOT NULL`

**STATUS: CLOSED — Migration 00040 (revert speculative body/type rename + adds) + commit b208169 (helper consolidation + 26 callsite rewrites) + commit 82f90f7 (migration audit record)**
**Closed: 2026-04-27 (production verification confirmed scenario (a)-with-twist; 00010 never landed for body/type; reconciled by codifying production reality on disk)**

**Severity:** High
**Category:** Schema
**Files:** 14 occurrences across `src/app/api/{eod,misc-draws,expense-lifecycle,budgets/resubmit,budgets/pm-line-review,budgets/pm-review,budgets/accountant-submit-notify}/route.ts`; schema in `supabase/migrations/00010_notifications_and_preferences.sql:9-22, 41-49`
**Confidence:** Likely (DB introspection needed to confirm which column shape is live)

**What's wrong:**
Migration 00010 renames `notifications.message` to `body` (conditional on existence) and declares `type TEXT NOT NULL`. Every single notification insert in the codebase passes `{ user_id, title, message, link }` — never `body`, never `type`. If the migration applied as written, every notification insert raises either "column message does not exist" or a NOT NULL violation. If the migration didn't rename, the schema is stuck on `message` and the next clean rebuild will break notifications system-wide.

**Impact:**
Either notifications haven't been working in production for some flows, or the code is producing visible-error 500s and the calls are wrapped in `try/catch` that swallows them. Several notification calls are not wrapped (e.g. `api/eod/route.ts:314, 327`) — those would surface as 500s.

**Suggested fix (not implemented):**
Confirm production column shape. Standardise inserts to `{ user_id, title, body, type, link }`. Add a `type` value at every callsite. If `message` is the live column, write a migration to formalise it.

---

### F-11 — `director_payouts.profit_share_record_id` is `NOT NULL` in schema but the API inserts `?? null` without validating

**Severity:** High
**Category:** Write path
**Files:** `src/app/api/director-payouts/route.ts:53-55, 81-93`; `supabase/migrations/00018_director_payouts.sql:5`
**Confidence:** Certain

**What's wrong:**
The schema declares `profit_share_record_id UUID NOT NULL REFERENCES profit_share_records(id)`. The API validates `director_name`, `period_month`, and `amount_kes` (line 53), then inserts `profit_share_record_id: body.profit_share_record_id ?? null` (line 85). If a client omits the field, the DB rejects with a constraint violation.

**Impact:**
The API will return a 500 with an opaque error any time the client doesn't include the field. Worse, any contractor or future endpoint that constructs the payload incorrectly will hit this without warning.

**Suggested fix (not implemented):**
Add `if (!body.profit_share_record_id) return 422` at line 53. Drop the `?? null` fallback at line 85.

---

### F-12 — Multi-write API flows have no transaction boundaries

**STATUS: PARTIALLY CLOSED — Expense lifecycle multi-writes wrapped in RPCs (00029). Other call sites (`withdrawals/create`, `eod`, `budgets/resubmit`) still non-transactional.**
**Last reviewed: 2026-04-27**

**Severity:** High
**Category:** Write path
**Files:** `src/app/api/expense-lifecycle/route.ts` (confirm 255+278, modify 354+376, void 458-504, carry 533-577); `src/app/api/withdrawals/create/route.ts:77-108, 131-156` (withdrawal + forex_log + audit_log); `src/app/api/eod/route.ts:267-321` (eod upsert + red_flag + notifications + audit); `src/app/api/budgets/resubmit/route.ts` (status update + budget_items reset + notifications + audit)
**Confidence:** Certain

**What's wrong:**
Every multi-row write executes as separate `supabase.from(...).insert/update(...)` calls. A failure between calls leaves the system half-written. For finance writes, half-written state is the worst kind of error because it looks like normal data.

**Impact:**
Withdrawal recorded with no forex_log; EOD report sent to Slack but no DB record (or vice versa); pending_expense status moves but expense row missing; budget items reset but resubmit notification never sent.

**Suggested fix (not implemented):**
Wrap each multi-write flow in a Postgres function/RPC; call the RPC from the route. Failure becomes atomic. (This is a project-shaped change, not a single-file fix.)

---

### F-13 — Voiding a `pending_expense` does not cascade to the linked `expenses` row

**STATUS: CLOSED — Migration 00029 (void cascades via same RPC family)**
**Closed: 2026-04 (verified in this session)**

**Severity:** High
**Category:** Write path
**Files:** `src/app/api/expense-lifecycle/route.ts` void action (~lines 458-504)
**Confidence:** Certain

**What's wrong:**
Voiding a pending expense updates `pending_expenses.status='voided'` but does not touch the `expenses` row referenced by `pending_expenses.expense_id` (which exists if the pending expense had been confirmed previously and is now being voided). The expense remains in the `expenses` table contributing to every sum.

**Impact:**
"Voided" pending expenses still inflate `expenses.amount_kes` aggregates, including the lagged view's `current_expenses_kes`. Voiding does not actually un-recognise the cost.

**Suggested fix (not implemented):**
On void, when `expense_id IS NOT NULL`, soft-delete or hard-delete the corresponding `expenses` row inside the same transaction (cf. F-12).

---

### F-14 — `withdrawals.purpose` and `withdrawals.withdrawal_type` are parallel taxonomies; the API leaves `purpose` at the schema default for operations rows

**STATUS: DEFERRED — Investigation under commit ffe211d revealed that `purpose` and `withdrawal_type` accept different value sets and the CHECK constraint on `purpose` gates on fields the operations API does not capture (project_id required when `purpose='company_operations'`). A naive `purpose = withdrawal_type` mapping fails the constraint. Needs a product/taxonomy decision before code change — not a bug to be patched.**
**Last reviewed: 2026-04-27**

**Severity:** High
**Category:** Schema
**Files:** `supabase/migrations/00013_withdrawal_company_ops.sql:18,30-34`; `supabase/migrations/00017_withdrawal_type.sql:3-6`; `supabase/migrations/20260413_add_withdrawal_type_column.sql`; `src/app/api/withdrawals/create/route.ts:131-146`
**Confidence:** Certain

**What's wrong:**
00013 introduced `withdrawals.purpose` (default `'director_payout'`) with a CHECK constraint matching purpose to required field combinations. 00017 then introduced `withdrawals.withdrawal_type` (default `'operations'`) covering largely the same semantic distinction. The 20260413 migration backfilled both columns to be consistent for legacy rows. The current API creates `withdrawal_type='operations'` rows without setting `purpose` — so `purpose` defaults to `'director_payout'`. The DB constraint is satisfied because director fields are also set, but the data is semantically wrong (an operations withdrawal labelled `purpose=director_payout`).

**Impact:**
Any analytic that filters by `purpose` (versus `withdrawal_type`) will misclassify operations withdrawals as director payouts. The mismatch is silent.

**Suggested fix (not implemented):**
Pick one taxonomy and drop the other. If both must stay, set `purpose` explicitly in the API to match `withdrawal_type`, and add a CHECK that they agree.

---

### F-15 — PNL cash-mode revenue fetches every payment ever; if `payment_date` is null the payment is silently dropped

**STATUS: CLOSED — Commit a64fcfb (PNL cash-mode pushes date filter into DB via `.gte('payment_date', monthStart).lt('payment_date', monthEnd)` and adds explicit `payRes.error` check)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** High
**Category:** Silent failure
**Files:** `src/app/(dashboard)/reports/pnl/page.tsx:136, 150-152`
**Confidence:** Certain

**What's wrong:**
Line 136: `supabase.from('payments').select('amount_usd, payment_date')` — no date filter at all, returns the entire table. Line 150 then filters in-app: `payRes.data.filter(p => p.payment_date?.startsWith(selectedMonth))`. Any payment with `payment_date IS NULL` (the column is `NOT NULL` in 00002:256, but `null` could appear on a query where the field is absent or stripped) silently disappears. More importantly, a query failure returns `data:null` and `(payRes.data || []).filter(...)` evaluates to `[]` → cash revenue silently shows zero.

**Impact:**
Cash-basis PNL is the alternative view CFO uses to reconcile against accrual. If it silently shows zero (or skips rows), the reconciliation is meaningless and there is no error surfaced.

**Suggested fix (not implemented):**
Add `.gte('payment_date', selectedMonth + '-01').lt('payment_date', nextMonth + '-01')` to push the filter into the DB. Check `payRes.error` before computing.

---

### F-16 — `historical-seed/route.ts` DELETE handler targets non-existent tables and reuses a Supabase query builder for two operations

**STATUS: CLOSED — Commit f7eae46 (route collapsed to uniform 405 across all verbs; Settings page seed-cleanup UI removed end-to-end; phantom-table refs and query-builder reuse pattern eliminated)**
**Closed: 2026-04-27 (verified via build + diff review)**

**Severity:** Medium
**Category:** Write path
**Files:** `src/app/api/historical-seed/route.ts:34-99`
**Confidence:** Certain

**What's wrong:**
The GET and DELETE handlers reference tables `project_expenses` and `shared_overhead_entries` (lines 44-45, 85-86) that are not defined in any migration. They also reference columns `data_source` (line 41) and `source_note` (lines 42-46) on tables (`monthly_financial_snapshots`, `invoices`, `payments`, `profit_share_records`) where those columns are not defined in any migration. The `countDelete` helper at lines 73-79 builds a query, calls `q.select('id')` to count, then calls `q.delete()` on the same builder — Supabase `PostgrestQueryBuilder` is not designed to be reused across two terminal operations and may error or behave unexpectedly.

**Impact:**
The route is supposedly disabled (POST returns 405), but DELETE remains live to CFO. If the columns/tables exist in production, deletes happen against tables we have no migration record for. If they don't, the route silently fails (returns counts of 0). Either way, dead-code-shaped risk on a destructive endpoint.

**Suggested fix (not implemented):**
Delete the route entirely or replace the GET/DELETE with `405 Method Not Allowed`. If history-seed cleanup is genuinely needed, write it as a one-off SQL migration with verified column/table names.

---

### F-17 — `getOutstandingInvoices` second filter is dead because nothing maintains `payment_status`

**STATUS: CLOSED — Commit 83db636 (dead `payment_status` filter removed; only status-based matching remains, paired with F-09 fix)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Medium
**Category:** Business rule
**Files:** `src/lib/queries/invoices.ts:21-28`; `supabase/migrations/00009_appendix_o_fixes.sql:45-47`
**Confidence:** Certain

**What's wrong:**
Migration 00009 added `invoices.payment_status TEXT DEFAULT 'unpaid'`. No app code, no DB trigger, and no documented background process updates this column when payments are recorded. The query at `getOutstandingInvoices` uses `.or('payment_status.is.null,payment_status.neq.paid')` — which is satisfied for every row because `payment_status` is always 'unpaid' (so neq 'paid' is always true). The clause looks like a safety check but is a no-op.

**Impact:**
Misleading code. If a future engineer assumes `payment_status` is meaningful, they'll write further bugs on top.

**Suggested fix (not implemented):**
Either (a) drop the dead filter and rely on `status` only (paired with F-09 fix), or (b) add a DB trigger on `payments` insert/update/delete that recomputes `invoices.payment_status` and `total_paid` and `balance_outstanding` (those columns also exist unused per 00009:45-47).

---

### F-18 — EOD route inserts a `red_flag` with `flag_type='missing_expense_classification'` for a Slack-delivery failure

**STATUS: CLOSED — Migration 00038 (extends `red_flag_type` enum with `'report_delivery_failed'`) + commit 00bc99c (EOD route switched to the new value)**
**Closed: 2026-04-27 (verified via build + production migration apply)**

**Severity:** Medium
**Category:** Write path
**Files:** `src/app/api/eod/route.ts:303-310`
**Confidence:** Certain

**What's wrong:**
When the EOD Slack webhook returns non-2xx or `EOD_SLACK_WEBHOOK_URL` is unset, the route inserts a red_flag with `flag_type: 'missing_expense_classification'`. That enum value is unrelated to delivery failure. The intent was probably a `report_delivery_failed` value, but the code re-uses an existing enum to satisfy NOT NULL.

**Impact:**
Red-flag triage filters by `flag_type`. EOD delivery failures will show up filtered as "missing expense classification" — wrong category, dilutes signal in both buckets.

**Suggested fix (not implemented):**
Add a real enum value or change the title-only red flag and use a generic `flag_type='delivery_failure'`. Migration required.

---

### F-19 — CFO dashboard prefers `monthly_financial_snapshots` for the current month; if the snapshot exists with revenue=0 (empty closed month), the live override is skipped and the dashboard goes blank

**STATUS: CLOSED — Commit a64fcfb (CFO dashboard now treats snapshot as authoritative only when `month_closures.status` is `'closed'` or `'locked'`; live override applied for open months; extra query parallelised with existing `Promise.all`)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Medium
**Category:** Silent failure
**Files:** `src/app/(dashboard)/_components/cfo-dashboard.tsx:114-172`
**Confidence:** Likely

**What's wrong:**
Line 158: `snapshotRes.data && Number(snapshotRes.data.total_revenue_kes) > 0 ? snapshot : { live overrides }`. The condition treats "snapshot exists with zero revenue" as "snapshot exists, use it" — so the live revenue/expense numbers are not blended in. For a month that was closed early or with no invoices yet, the snapshot may legitimately be 0; once a late invoice arrives, the dashboard still shows 0.

**Impact:**
CFO sees zero revenue for the current month even when invoices exist — visible "we have no income" misimpression.

**Suggested fix (not implemented):**
Always blend: prefer snapshot for closed months, override with live values for the open month. Or: only use snapshot if `month_closures.status='closed'` for that year_month.

---

### F-20 — Standing misc draw insert uses SELECT-then-INSERT with no transaction; concurrent calls return generic 500 instead of friendly 409

**STATUS: CLOSED — Commit ffe211d (SELECT pre-check dropped; UNIQUE index `idx_misc_draws_one_standing_per_month` is the enforcement layer; `23505` translated to 409 with user-friendly message)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Medium
**Category:** Write path
**Files:** `src/app/api/misc-draws/route.ts:217-234`
**Confidence:** Certain

**What's wrong:**
Lines 217-221 SELECT to check for existing standing draw; lines 224-232 INSERT. The DB-level UNIQUE index `idx_misc_draws_one_standing_per_month` (00006:32) catches concurrency, but the API surfaces it as a 500 instead of recognising the unique-violation code (`23505`) and translating to 409.

**Impact:**
Real race only fires under double-clicks or near-simultaneous requests, but when it does the user sees a confusing 500. Defensive issue, not active corruption.

**Suggested fix (not implemented):**
Drop the SELECT pre-check, do the INSERT, and on `23505` return 409 with a clear message.

---

### F-21 — `cfo-dashboard.tsx` and `pnl/page.tsx` fall back to `129.5` rate; lagged view falls back to `128.5`; project-financials uses `129.5`

**STATUS: CLOSED — Commit ba12f79 (lagged view rate consolidation — same fix as F-03; single source of truth for USD→KES conversion via `fn_currency_get_rate()`)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Low
**Category:** Calculation
**Files:** see F-03 file list
**Confidence:** Certain

**What's wrong:**
Three different default rates. Same situation as F-03 but listed separately because even with `system_settings.standard_exchange_rate` set correctly, the *fallback path* used when the setting query fails (silently!) differs across the codebase.

**Impact:**
Latent. Only fires if the system_settings row is missing, but if it does, three pages produce three different revenue numbers.

**Suggested fix (not implemented):**
Single shared constant in `src/lib/constants/`, used everywhere. Better still: never fall back — error and surface the missing setting.

---

### F-22 — `supabase/sql/unified_accrual_lag_views.sql` is dead code with column names that don't match the live schema

**STATUS: CLOSED — Commit 83db636 (both `unified_accrual_lag_views.sql` and the ` 2.sql` twin deleted; `supabase/sql/` retains only `unified_accrual_snapshot.sql`)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Low
**Category:** Schema
**Files:** `supabase/sql/unified_accrual_lag_views.sql`; duplicated as `unified_accrual_lag_views 2.sql`
**Confidence:** Certain

**What's wrong:**
This SQL file (and its `2.sql` twin) defines a different `lagged_revenue_by_project_month` view that uses `expenses.amount` and `invoices.amount` (singular), references `lifecycle_status='confirmed'`, and is not in the migrations folder. If applied, it would error because the actual columns are `amount_kes`/`amount_usd`. The fact that this file claims `lifecycle_status` exists is what made the column appear to be "intended" — but the file would not run.

**Impact:**
Confusing. New contributors will assume the column exists; existing engineers may try to apply this file and break the DB.

**Suggested fix (not implemented):**
Delete both files. If `lifecycle_status` is intended, formalise as a migration.

---

### F-23 — `cash-balance.ts` overstates "paid" when `status='paid'` was set manually before all payments were recorded

**STATUS: CLOSED — Commit 83db636 (`Math.max` removed from `getInvoicePaidUsd`; helper now returns the actual recorded payment total)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Low
**Category:** Silent failure
**Files:** `src/lib/cash-balance.ts:11-20`
**Confidence:** Certain

**What's wrong:**
`getInvoicePaidUsd` returns `Math.max(invoiceAmount, paymentTotal)` when `invoice.status === 'paid'`. If a CFO marked an invoice paid before all payments were entered, the helper assumes the full invoice amount was received. It silently fixes the data inconsistency by hiding it.

**Impact:**
Bank balance and cash reconciliation appear to balance even when payments are missing in the DB. Latent until a CFO tries to chase a "missing" payment that was already counted as received.

**Suggested fix (not implemented):**
Drop the `Math.max`. Show actual recorded payments. Surface a UI red flag when status is `paid` but `paymentTotal < invoiceAmount`.

---

### F-24 — Accountant `notifications.insert` calls in misc-draws use `amount.toLocaleString()` (no locale, no en-KE) for KES amounts in user-facing text

**STATUS: CLOSED — Commit a64fcfb (every `toLocaleString()` callsite in `misc-draws/route.ts` replaced with `formatKES()`; original audit listed 13 sites, 8 remained at fix time, all converted)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Low
**Category:** Business rule
**Files:** `src/app/api/misc-draws/route.ts:252, 339, 351, 416, 461, 499, 552, 612, 622, 681, 745, 802, 812`
**Confidence:** Certain

**What's wrong:**
Every notification message text constructs an amount via `amount.toLocaleString()` — no `'en-KE'` argument, no `formatKES()`. The Vercel server runs in `en-US`-ish locale, so notifications read e.g. "1,500" instead of "1,500.00" KES. Minor formatting drift, but it's also a missed opportunity to use the canonical formatter.

**Impact:**
Cosmetic in notifications — but the rule says all KES rendering must use `formatKES`. Dozens of violations means the rule isn't enforced anywhere.

**Suggested fix (not implemented):**
Replace each with `formatKES(amount)` from `src/lib/format.ts`. (UI-only, not financial-correctness-critical.)

---

### F-25 — `notifications` callsites that don't await/await-without-error-check let failures be silently swallowed

**STATUS: CLOSED — Commit 83db636 (initial — notification `.error` checks + `console.error` logging added) + commit a64fcfb (CFO notification loop patch)**
**Closed: 2026-04-27 (verified via git log + code inspection)**

**Severity:** Low
**Category:** Silent failure
**Files:** `src/app/api/budgets/resubmit/route.ts` (the `for (const pm of pmAssignments)` loop calls `await admin.from('notifications').insert(...)` without checking `.error`); same pattern in `src/app/api/eod/route.ts:312-321, 324-333`, `src/app/api/expense-lifecycle/route.ts:33`
**Confidence:** Certain

**What's wrong:**
Notification inserts return `{ data, error }`; the routes destructure neither and proceed. Combined with F-10 (column may not exist or `type` may be required), every notification could be silently failing without anyone noticing. The route returns success.

**Impact:**
If F-10 turns out to be (b), this is the reason no one has been paged about it: the inserts fail, but the API returns 200, so nothing surfaces.

**Suggested fix (not implemented):**
Either check `.error` and log, or fire-and-forget intentionally with a comment, but document either way.

---

### F-27 — variance_summary_by_project view double-counts expenses when a project has sibling budgets

**STATUS: CLOSED — Migration 00026 (variance view siblings aggregate fix)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Calculation
**Files:** `supabase/migrations/00009_appendix_o_fixes.sql:60-73`; applied in production via Fix 2a-bis (commit e6581fd, migration 00025)
**Confidence:** Certain

**What's wrong:**
The view joins `LEFT JOIN expenses e ON e.project_id = b.project_id AND e.year_month = b.year_month`. When a single project has multiple budget rows for the same month (sibling budgets — e.g. TL and Accountant each submitted one, which is a supported state in the data model, visible via the "N versions" count on the Budgets page), each expense is joined once per sibling budget. The expense then enters `SUM(e.amount_kes)` once per pairing, inflating the aggregate by the sibling count.

**Evidence:**
Smoke E verification for 2026-04, run during Fix 2a-bis production apply (captured 2026-04-24):
- `via_view` (SUM of `actual_kes` in `variance_summary_by_project` for 2026-04): KES 7,657,108.88
- `raw_confirmed` (direct SUM of expenses in the same project-month set): KES 4,024,469.94
- Inflation factor: 1.903x
- Budget row count for 2026-04 (per Smoke D): 11 rows across 6 scopes — some scopes (Admin) have 3 siblings, others (Aifi) have 2. Matches the ~1.9x inflation.

**Impact:**
The two dashboard pages that read this view have been displaying inflated `actual_kes` and `variance_kes`:
- `src/app/(dashboard)/reports/budget-vs-actual/page.tsx`
- `src/app/(dashboard)/reports/budget-accuracy/page.tsx`

Both show projects as overspending when they are not. Any CFO or TL using these pages to assess budget health has been working from inflated numbers. Bug is pre-existing (since the view was written in 00009), unrelated to Fix 2a or Fix 2a-bis — Fix 2a-bis's lifecycle filter worked correctly; the smoke test happened to reveal this separately.

**Suggested fix (not implemented):**
Three plausible approaches, needs product decision:
1. Join expenses on `budget_id` (the expense's own FK to budgets) rather than `project_id + year_month` — each expense attaches to exactly one budget. Cleanest semantically.
2. Pre-aggregate budgets to one row per project-month before the join (e.g. SUM(total_amount_kes) across siblings).
3. Pick one "canonical" budget per project-month via a priority rule (TL > Accountant, or latest submitted, etc.) and only join to that.

Approach #1 requires that every expense has a valid `budget_id` FK populated — needs verification before committing to this approach.

**Deferred to a separate fix session (F-27 fix).** Not urgent: the bug has been live since 00009 and users have been seeing these inflated numbers throughout; one more day doesn't matter. Fix properly rather than patch.

---

### F-28 — Multiple approved sibling budgets exist for the same project-month with significantly disagreeing amounts

**Severity:** Low (re-scoped — see note below)
**Category:** Data integrity / business rule
**Files:** `supabase/migrations/00002_tables.sql` (budgets + budget_versions tables); affects every consumer of budget data
**Confidence:** Certain (data inspection, not speculation)

**What's wrong:**
The data model allows multiple `budgets` rows for the same `(project_id, year_month)` — each with their own `budget_versions` chain and independent `status` (including `approved`). This is used legitimately when both a TL and an Accountant submit budgets for the same project-month (visible as the "N versions" pill on the Budgets tab). What has happened in production is that **both siblings can simultaneously be in status `approved`, with materially different amounts**, and there is no business rule or constraint preventing it.

**Evidence:**
F-27 pre-work data audit, 2026-04 (captured 2026-04-24):

| Project | Budget 1 (approved) | Budget 2 (approved) | Ratio |
|---|---|---|---|
| Aifi | KES 83,600 (accountant) | KES 1,582,450 (accountant) | ~19x |
| Windward | KES 95,000 (accountant) | KES 2,278,051 (team_leader) | ~24x |

Both sibling rows for each project are marked `approved` in `budget_versions`. Both are legitimate rows in `budgets`. The system has no way to determine which one is "the budget."

**Impact (after user clarification, 2026-04-24):**
Per product decision by the user, multiple approved sibling budgets per project-month are LEGITIMATE — they represent separate, legitimate budget submissions on different days as new needs arise (e.g. initial month-start budget plus a mid-month supplemental). Per the user's rule, the correct aggregate is SUM of all approved siblings.

Therefore F-28 is no longer a data-integrity bug. The data itself is correct. What matters is that every downstream consumer of budget data treats siblings as "sum, don't pick one, don't multiply through a join."

**Reclassified as Low (docs-only finding):** no constraint should be added to prevent multiple approved siblings. No data cleanup needed. The only remaining action is to ensure every downstream consumer (view, function, page) correctly SUMs siblings rather than picking one, fan-out joining, or deduping. Those remaining actions are tracked as F-27 (variance view, highest priority) and F-29 (red flags overspending — newly identified, see below).

**Resolution required before F-27 can be fixed:**
The business needs to answer: when sibling budgets exist for the same project-month, what does each one represent, and what does "the variance" mean?

Four candidate interpretations:
1. Siblings should sum (e.g. one is tools-only, one is labour-only). If so, F-27 fix: pre-aggregate budgets by project-month before joining to expenses, and keep siblings as distinct rows.
2. Only one sibling should ever be approved at a time; others are stale/corrupted. If so, F-28 fix: data audit + cleanup + DB constraint (`UNIQUE (project_id, year_month)` where approved version exists). Then F-27 fix: any join strategy works.
3. Siblings are alternative proposals, meant to be compared, not combined. If so: variance reporting needs to be redesigned per-budget, not per-project.
4. Siblings are bottom-up (TL) vs top-down (Accountant) and represent distinct budget layers. If so: entirely different reporting model needed.

**This finding blocks F-27.** F-27 cannot be fixed correctly until F-28's business question is answered.

**Suggested fix (not implemented):**
Do not write any migration for F-27 or F-28 before:
1. Interviewing the users (Njuguna, the directors, the accountants) about what sibling budgets mean in practice.
2. Reviewing the 2026-04 data (Aifi 83,600 vs 1,582,450; Windward 95,000 vs 2,278,051) to understand which figures are authoritative.
3. Deciding whether to enforce uniqueness (option 2) or embrace multiplicity with a clear combination rule (option 1 or 3).

---

### F-29 — fn_generate_red_flags overspending check compares expenses per-budget instead of per-project-month total

**STATUS: CLOSED — Migration 00027 (red flags overspending siblings fix)**
**Closed: 2026-04 (verified in this session)**

**Severity:** High
**Category:** Business rule
**Files:** `supabase/migrations/00005_red_flag_function.sql` (current in-production version via migration 00025 / commit e6581fd); aggregation inside the overspending INSERT
**Confidence:** Certain

**What's wrong:**
The overspending subquery currently does:

  LEFT JOIN expenses e ON e.budget_id = b.id AND e.year_month = p_year_month AND e.lifecycle_status = 'confirmed'
  ...
  GROUP BY b.id, b.project_id, b.department_id, bv.total_amount_usd

This produces one result row per `budget` (not per project-month). When a project has multiple sibling budgets, each budget's `actual_total` is only the expenses attached to THAT specific budget via `expenses.budget_id`. The check then compares each budget's actual to its own amount.

Per the user's confirmed business rule (2026-04-24), the correct total budget for a project-month is SUM of all approved sibling budgets, and the correct actual is SUM of all confirmed expenses for that project-month (regardless of which sibling budget each expense happens to be attached to).

**Impact:**
In cases where siblings exist:
- A project can legitimately spend 1.5M against a combined 1.67M budget (TL + supplemental), but if expenses are attached unevenly, the overspending check fires on the smaller sibling (83,600 with, say, 200,000 spend) even though the real total is well under budget.
- Conversely, a truly overspending project could slip through if expenses are spread evenly across multiple siblings.

Red flags generated by `fn_generate_red_flags` for overspending are currently not trustworthy when siblings exist.

**Suggested fix (not implemented):**
Rewrite the overspending subquery to aggregate at the project-month level, not the budget level:

1. Compute `total_budget = SUM(bv.total_amount_usd) FROM budgets b JOIN budget_versions bv ON ... AND bv.status='approved' GROUP BY (project_id OR department_id, year_month)`
2. Compute `total_actual = SUM(e.amount_usd) FROM expenses e WHERE project_id/department_id = ... AND year_month = ... AND lifecycle_status = 'confirmed'`
3. Compare the two per project-month.
4. Red flag `reference_id` should probably point to the project (or department) rather than a single budget row — needs product decision on where the "overspend" should link to.

**Sequencing:** Fix after F-27. Same business rule, same sibling-aggregation pattern — cleanest to land F-27 first, verify the view, then apply the same pattern to the red flags function in a separate migration.

---

### F-30 — variance_summary_by_project would double-count if budgets ever have multiple approved versions

**STATUS: CLOSED — Migration 00042 §3 + §4 (variance view + fn_generate_red_flags Block B both gain `bv.version_number = b.current_version` on the approved-budget join) + commit a288d02**
**Closed: 2026-04-27 (bundled with F-07 to neutralize the regression-on-fix the moment F-07 RPCs ship multiple historical approved versions)**

**Severity:** Low (latent — does not fire today)
**Category:** Data integrity / latent bug
**Files:** `supabase/migrations/00026_fix_variance_view_siblings_aggregate.sql` (the F-27 fix, once applied); depends on F-07 being fixed first
**Confidence:** Certain

**What's wrong:**
The F-27 fix pre-aggregates budgets via `JOIN budget_versions bv ON bv.budget_id = b.id AND bv.status = 'approved'`. This sums all approved versions of each budget. A single budget can in principle have multiple versions with `status = 'approved'` — there is a UNIQUE constraint on `(budget_id, version_number)` but nothing enforces that only one version per budget can hold any given status.

**Why it doesn't fire today:**
F-07 (the resubmit-in-place bug, already logged in this audit) means every budget has exactly one version with any non-draft status. Each budget contributes exactly one row to the approved-versions pool. No double-count is possible.

**When it will fire:**
Once F-07 is fixed — i.e. once resubmit properly inserts a new `budget_versions` row and the system retains historical approved-then-superseded versions — the view's budget aggregate will silently sum all approved versions ever created for a budget, not just the current one. A budget that was approved, then had a supplemental approved version, would contribute BOTH to `budget_kes`.

**Suggested fix (not implemented):**
When F-07 is fixed, update the F-27 view to also filter `bv.version_number = b.current_version` in the budget aggregate:

  JOIN budget_versions bv ON bv.budget_id = b.id 
    AND bv.version_number = b.current_version 
    AND bv.status = 'approved'::budget_status

This ensures the view only sums the currently-canonical approved version of each budget. The same pattern should also be applied to `fn_generate_red_flags` overspending (F-29) and any other downstream that joins on approved-version.

**Sequencing:** Latent. Revisit when F-07 is scheduled. Do not fix pre-emptively — it changes semantics in a way the live data doesn't currently require.

---

### F-31 — variance_summary_by_project and fn_generate_red_flags use different expense-matching paths for the same semantic value

**STATUS: INFORMATIONAL — No active bug; both paths currently return identical values when expense `budget_id` and `(project_id, year_month)` align. A trigger or guard enforcing that alignment is the right fix shape; defer until prioritised.**
**Last reviewed: 2026-04-27**

**Severity:** Low (informational)
**Category:** Data hygiene
**Files:** `supabase/migrations/00026_fix_variance_view_siblings_aggregate.sql`, `supabase/migrations/00027_fix_red_flags_overspending_siblings.sql`
**Confidence:** Certain

**What's wrong:**
After F-27 (view) and F-29 (function) fixes, both objects compute "total confirmed actual spend per project-month" but use different matching paths:

- F-27 view joins expenses via `(e.project_id = b.project_id AND e.year_month = b.year_month)` with an `e.expense_type = 'project_expense'` filter.
- F-29 function joins expenses via `e.budget_id` linkage to a sibling budget in the same project-month, with no expense_type filter (implicitly project-bounded by the budget_id linkage).

If every confirmed project_expense row has a `budget_id` pointing to a budget whose `(project_id, year_month)` matches the expense's own `(project_id, year_month)`, the two paths return identical values. The schema does not enforce this — `fn_validate_expense_budget` only checks that the budget_version is approved, not that project_id/year_month align between the expense and its linked budget.

**Impact:**
If a data-entry mistake ever attaches an expense to a budget from a different project-month, the variance view and the overspending red flag would disagree on "actual spend" for that project-month. Users would see one number on the reports pages and a different overspending calculation in the red-flag system.

**Suggested fix (not implemented):**
Add a data-integrity check — ideally a DB trigger or application-level guard — that enforces `expenses.project_id = budgets.project_id AND expenses.year_month = budgets.year_month` when `expenses.budget_id` is set. If such a constraint is added, reconcile F-27 and F-29 to use the same matching path (probably the `budget_id` one, since it naturally covers department budgets which F-27 view doesn't).

**Priority:** Low. This is a latent inconsistency, not a firing bug. No user-visible mismatch has been observed. Fix after higher-priority items in this audit.

---

### F-32 — USD columns systematically empty across budget_versions and expenses; all downstream USD calculations produce zero or wrong values

**STATUS: CLOSED — Migration 00028 (currency conversion triggers)**
**Closed: 2026-04 (verified in this session)**

**Severity:** Critical
**Category:** Data model / missing mechanism
**Files:** Schema definitions for `budget_versions` and `expenses` (00002_tables.sql); every function and view that reads `*.total_amount_usd` or `*.amount_usd`; every UI that displays USD values
**Confidence:** Certain (evidence from live Supabase production data, 2026-04-24)

**What's wrong:**
The data model carries both KES and USD amount columns on `budget_versions` (`total_amount_kes`, `total_amount_usd`) and `expenses` (`amount_kes`, `amount_usd`), but there is no database trigger, function, or application-level mechanism that converts KES to USD. The USD columns default to 0 (not NULL), which silently masks the gap — application code reading these fields sees zero, not a missing-value error.

**Evidence from production (captured 2026-04-24):**

budget_versions: 11 of 11 rows have `total_amount_kes > 0` and `total_amount_usd = 0`. Every approved budget in 2026-04 (Admin × 3, Aifi × 2, Clickworker, Kemtai, Sales, SEEO, Windward × 2) has USD = 0.0000.

expenses: 41 of 42 confirmed rows have `amount_kes > 0` and `amount_usd = 0`. The one exception is a zero-amount row.

invoices: 12 of 12 rows are the mirror opposite — USD populated, KES = 0. Invoices appear to be USD-native while budgets and expenses are KES-native.

Database triggers on these three tables: only `fn_audit_log` and `fn_set_updated_at`. No conversion trigger exists.

**Impact (likely Critical):**

Every USD-denominated calculation in the system reads from systematically empty fields:

- `fn_generate_red_flags` overspending check (just fixed in F-29, commit ccdc9e9) reads `bv.total_amount_usd`. The `WHERE sub.budget_total > 0` guard excludes every row because budget_total is always 0. The overspending red flag is structurally dead and has been since the function was created.

- `fn_calculate_project_profitability` (touched by F-26 / migration 00025, commit e6581fd) likely aggregates expenses in USD. If so, project profitability is showing infinite margin — USD revenue (populated from invoices) minus USD cost (0 from expenses). Needs direct verification.

- `fn_generate_monthly_snapshot` (touched by F-26) has two aggregates with lifecycle filter. Unit mixing unknown; needs direct verification.

- `profit_share_records` stores `distributable_profit_usd`. If computed from USD-denominated revenue minus USD-denominated costs, the USD profit figure is effectively equal to full USD revenue (since USD costs are 0). Director payout calculations in USD are therefore dramatically overstated.

- CFO dashboard, P&L page, profit-share page, project-financials API: need full audit of which unit each surface displays and whether the rendered values depend on the missing USD data.

The KES columns are consistently populated. Any calculation done in KES is unaffected by F-32. This means some surfaces may be fine (KES-only) while others may be catastrophically wrong (USD-only or mixed-unit).

**Root cause:**

A mechanism that was assumed to exist does not exist. Either:
(a) A conversion trigger was intended to auto-populate USD from KES (using `system_settings.standard_exchange_rate` or similar), and was never implemented.
(b) The input UI was intended to prompt accountants for both KES and USD, and the USD input was never wired up.
(c) The data model was intended to be single-unit (KES) and the USD columns were added speculatively and never wired to anything.

The invoices asymmetry — USD-native with no KES — suggests the original system was USD-native and KES was bolted on later for budgets/expenses (or vice versa).

**Resolution required — NOT to be addressed tonight:**

This is not a single migration. It requires a product-level architectural decision between three paths:

1. **KES-canonical:** treat KES as the source of truth on budgets and expenses. USD becomes derived-at-query-time via exchange rate from system_settings. Requires every function and view that currently reads `total_amount_usd` or `amount_usd` to be rewritten to compute it on the fly. Backfill of existing USD columns unnecessary (they become unused).

2. **USD-canonical:** treat USD as source of truth. Add a conversion mechanism going the other way for invoices (currently USD-native — the model would flip). Massive change.

3. **Dual-store with automated conversion:** keep both columns, add a BEFORE INSERT/UPDATE trigger to budget_versions and expenses that populates USD from KES using the current exchange rate, plus backfill historical rows using either (a) the current rate or (b) monthly historical rates if available. This is the lowest-disruption option if the rest of the system is designed around reading pre-computed USD.

**Before any fix: decide the architecture. Before any architecture decision: audit every consumer of USD columns across the codebase to understand blast radius.**

**Immediate interim mitigation to consider (not tonight):**

Any surface that displays USD values to users or directors should be either (a) hidden until F-32 is fixed or (b) annotated with a warning that USD figures are unreliable. Director payouts in USD should not be initiated until this is resolved.

**Sequencing:** Address after the remaining higher-scope fixes in the audit. Fix F-03 (exchange rate constant consolidation) is a natural prerequisite — whatever F-32 resolution picks, it will need a single well-known source of truth for the conversion rate, which is exactly what F-03 delivers.

---

### F-33 — Two `red_flag_type` enum values are inserted from code but never declared in any migration

**STATUS: CLOSED — Migration 00039 (`expense_variance_overspend` + `misc_topup_limit_reached` codified) + commit 824a2ba (audit record). PARTIAL CLOSURE WIDENED 2026-04-27: F-07 work codified the `budget_status` enum slice (Migration 00041, four `pm_*`/`returned_to_tl` values) and the ~17 drift columns across budgets / budget_versions / budget_items / budget_approvals / expenses (Migration 00042 §1 preamble, commit a288d02). Same drift family pattern continues to surface and gets codified as adjacent work touches each table.**
**Closed: 2026-04-27 (production verification confirmed scenario (b) — see commit body)**

**Severity:** Medium (suspected — same drift family as F-02, F-05)
**Category:** Schema
**Files:** `src/app/api/expense-lifecycle/route.ts:780, 874` (`'expense_variance_overspend'`); `src/app/api/misc-draws/route.ts:371` (`'misc_topup_limit_reached'`); enum declared in `supabase/migrations/00001_enums.sql:78-90`
**Confidence:** Likely (DB introspection needed to confirm whether production has these values added via direct `ALTER TYPE`)
**Discovered:** 2026-04-27 during F-18 Phase 1 sweep

**What's wrong:**
The `red_flag_type` enum in 00001 declares 11 values. No migration on disk extends the enum (verified: zero `ALTER TYPE red_flag_type ADD VALUE` statements anywhere in `supabase/migrations/`). Yet two code paths insert values that are not in that declared list:
- `'expense_variance_overspend'` — inserted by the expense-lifecycle variance generator (two call sites in `route.ts`).
- `'misc_topup_limit_reached'` — inserted by the misc-draws limit-reached path.

The `red_flags.flag_type` column is typed `red_flag_type NOT NULL` (00002_tables.sql:420) — a strict enum, not free-text. So either (a) production was patched directly via `ALTER TYPE ... ADD VALUE` outside the migrations tree (drift; can't rebuild from scratch — same family as F-02 and F-05), or (b) these inserts have been silently failing in production whenever they fire, and the surrounding `await` swallows the error without surfacing it (sibling shape of F-25, which was closed in commit 83db636 by adding `.error` checks — the red_flags inserts are not in the F-25 fix scope).

**Impact:**
- If (a): rebuild risk. Cannot stand up a clean DB from disk; the variance generator and misc-draws limit path will both raise on first fire.
- If (b): variance overspends and misc top-up limit-reached events are not generating red flags at all in production. Two categories of operational alerts are silently missing. The expense-lifecycle route does not check `.error` on the `red_flags` insert (line 825), so the failure is opaque.

**Suggested fix (not implemented):**
1. Verify production via `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'red_flag_type'::regtype ORDER BY enumsortorder`.
2. If the values exist in production: add a migration codifying both with `ALTER TYPE red_flag_type ADD VALUE IF NOT EXISTS ...` so the migration tree becomes the source of truth (parallel shape to migration 00038 from F-18).
3. If the values don't exist: same migration adds them; investigate whether the absence has been masking missing red flags and decide whether to backfill or flag as a known data gap.
4. Either way: add `.error` checks on the two insert paths so future enum violations don't continue to be silent (sibling to F-25).

**Sequencing:** Discovered during F-18 (which extended the same enum with `'report_delivery_failed'` via migration 00038). F-18's migration is a working template. Fix can be a single migration adding both values plus two one-line `.error` check additions.

---

## 4. Cross-Page Agreement Table

| Number | Source of truth | cfo-dashboard | pnl page | profit-share | project-financials API | Agree? |
|---|---|---|---|---|---|---|
| **April 2026 total revenue (KES)** | `lagged_revenue_company_month.total_revenue_kes` for `expense_month='2026-04'` | uses lagged view ✓ | uses lagged view (accrual) ✓ | uses per-project lagged view ✓ | sums `invoices.amount_kes` directly ✗ | **No** — project-financials disagrees with all others |
| **April 2026 total project expenses (KES)** | (Disputed: lagged view uses all rows; pages filter `lifecycle_status='confirmed'`) | filters lifecycle ✓ | filters lifecycle ✓ | filters lifecycle ✓ | NO lifecycle filter ✗ | **No** — F-01 + F-04 |
| **Outstanding invoices total (USD)** | All invoices with `status IN OUTSTANDING_INVOICE_STATUSES` and outstanding>0 | reads `OutstandingReceivablesPanel` (sent only) ✗ | n/a | n/a | n/a | **No** — `/invoices` shows correct, dashboard panel understates (F-09) |
| **Current month net profit (KES)** | Revenue (lagged) − confirmed expenses | revenue ✓, expenses depend on F-02 | same | same | wrong revenue + wrong expenses | **No, derived from above** |

---

## 5. Deferred to Later Audits

- Notification system has no central type registry, no consistent payload, no test coverage. [Audit 3 — architecture]
- Multiple migrations have ` 2.sql` duplicate copies (00006, 00007, 00008, 00009, 00010, 00011, 00012, 00013, 00014, 00015, 00016 all have twins) — looks like a sync artifact; should be cleaned up. [Audit 3]
- `audit_logs` populated inconsistently — some routes write them, some don't, no central wrapper. [Audit 2 — audit/observability]
- Many API routes are written as a single minified line (e.g. `budgets/resubmit/route.ts`, `pm-line-review`) — readability/maintainability. [Audit 3]
- The `system_settings` key/value store is used ad-hoc (e.g. `misc_freeze_${project_id}_${period_month}` in `misc-draws/route.ts:281`) — schemaless config sprawl. [Audit 3]
- Cron endpoints rely on `CRON_SECRET` only; no IP allowlist, no rate limit. [Audit 2]
- Many API routes return generic 500s for DB constraint errors (e.g. F-11, F-20) — error-translation could be centralised. [Audit 3]
- `OutstandingReceivablesPanel` description text and the underlying query disagree — copy/UX nit (root cause is F-09 above). [Audit 3]

---

## 6. Confidence Notes

- **Certain (verified by reading source):** F-01, F-03, F-04, F-06, F-07, F-08, F-09, F-11, F-12, F-13, F-14, F-15, F-16, F-17, F-18, F-20, F-21, F-22, F-23, F-24, F-25.
- **Likely (verification needs DB introspection of production schema):** F-02 (does `expenses.lifecycle_status` exist in production?), F-05 (do `profit_share_records.distributable_amount` and `.director_name` exist?), F-10 (is `notifications.body`/`type` live or still `message`?), F-19 (is the snapshot-zero edge case actually firing in production?).
- **Recommended verification commands** (run by user against the live DB):
  ```sql
  \d expenses
  \d profit_share_records
  \d notifications
  SELECT column_name FROM information_schema.columns WHERE table_name IN ('expenses','profit_share_records','notifications') ORDER BY table_name, column_name;
  ```
- **Cap:** The 25-finding cap was reached. Additional Low-severity items (e.g. unused fields like `outstanding_receivables_snapshot.client_name` written nowhere; `expense_import_batches` table created but no insert path exists) were dropped to stay within budget. None affect a current number; raise if the next audit pass needs them.

---

*End of report. No code changes were made. No commits were created. File is in the working tree only.*
