# AUDIT_2 — F-32 USD/KES Architecture Audit

Read-only diagnosis. Authored 2026-04-25 (Phase 1, follow-up to AUDIT_1_CORRECTNESS.md F-32). No source files or migrations were modified.

**Verification status (2026-04-28):** §11 verification queries executed against production. 9 of 10 clean / better than audit's framing. Q11.5 surfaced empty `forex_rates` table — latent gap, not a regression. The schema/code drift family Audit 2 was tracking has converged; 00028 was significantly more thorough than the audit framed (currency-sync triggers landed on all 5 financial tables, not just expenses). F-32 closure confirmed end-to-end. Logged as deferred follow-up: F-32.1 (forex_rates backfill — out of scope tonight; rate has been stable, dataset is recent). See §11 "Verification Findings" below.

---

## 1. Background

### F-32 in one paragraph (from AUDIT_1)

The data model carries a USD/KES amount pair on `budget_versions`, `budget_items`, `expenses`, `invoices`, `payments`, `withdrawals`, `overhead_allocations`, `project_profitability`, `profit_share_records`, and `monthly_financial_snapshots`. There is no DB trigger, function, or application-level mechanism that converts KES to USD or USD to KES on those rows. All "amount" columns default to `0` (NOT NULL DEFAULT 0), so an unfilled column reads as zero — never `NULL` — and downstream aggregates silently produce zero or wrong figures with no error path. Data flow today, captured 2026-04-25:

| Table | KES | USD |
|---|---|---|
| `budget_versions.total_amount_*` | populated (11/11) | 0 (11/11) |
| `budget_items.amount_*` | populated | 0 (the API explicitly writes `amount_usd: 0`) |
| `expenses.amount_*` | populated (41/42, the one zero-row is a true zero-amount) | 0 (41/42) |
| `invoices.amount_*` | 0 (12/12) | populated (12/12) — **USD-native** |
| `payments.amount_*` | 0 (mirrors invoices) | populated |
| `withdrawals.amount_*` | populated (computed = USD × exchange_rate at entry) | populated (manual entry) |

Budgets and expenses are KES-native at the data-entry surface (the form labels say "Amount (KES)" and the API writes `amount_usd: 0` literally). Invoices and payments are USD-native at the data-entry surface. Withdrawals capture both, multiplied at entry time using the user-selected forex bureau rate. The architecture conflict is that there is no boundary in the system that translates one side into the other, but functions, views, and pages reach across that boundary and assume the other side is populated.

### Key facts at a glance

- **`fn_calculate_project_profitability`** subtracts `expenses.amount_kes` from `invoices.amount_kes`. After F-32: `invoices.amount_kes = 0`, so `revenue_kes = 0` and `gross_profit_kes = -direct_expenses_kes` (sharply negative for every project). On the USD side: `invoices.amount_usd` is populated, `expenses.amount_usd = 0`, so `gross_profit_usd ≈ revenue_usd` (margins look ~100%).
- **`fn_generate_profit_shares`** copies those values into `profit_share_records.distributable_profit_kes/usd`. The KES side is hugely negative; the USD side is hugely overstated. Director shares (70%) and company shares (30%) inherit both errors.
- **`fn_generate_monthly_snapshot`** does the same arithmetic for company-wide totals.
- **`fn_generate_red_flags`** overspending check compares `expenses.amount_usd` to `bv.total_amount_usd`. Both are 0 for every row → check is structurally dead (already noted as F-29 / F-32).
- **`fn_calculate_overhead_allocations`** uses `expenses.amount_usd` for shared-overhead totals. Result: `overhead_allocations.allocated_amount_usd = 0` for every row, and `allocated_amount_kes = 0` (because `v_total_overhead_kes` is computed from confirmed shared expenses, which IS populated, but the allocation share % is computed from invoice-USD revenue ratios, which IS populated — so KES allocations ARE correct, USD ones are zero).
- **The lagged_revenue view** is the only place in the system that does a USD→KES conversion: `COALESCE(NULLIF(inv.total_invoice_kes, 0), inv.total_invoice_usd * 128.5, 0)`. This is the load-bearing piece of code that hides F-32 from most user-facing pages.
- **`use-monthly-invoice-revenue`** sums `payments.amount_kes` on the home dashboard. `payments.amount_kes = 0` for every row, so the "Invoice Revenue — current month" KPI on every Home dashboard reads `KES 0`.

---

## 2. Methodology

1. Wide grep across `src/` and `supabase/`:

   ```
   grep -rEn "amount_kes|amount_usd|total_amount_kes|total_amount_usd|distributable_profit_usd|total_revenue_usd|total_revenue_kes" src/ supabase/
   ```

   That returned 566 lines across 73 distinct files (57 in `src/`, 14 migration / sql, 2 type files).

2. Read each consumer in context. Where the file was large and the hits were scattered, grep'd a window around each hit to determine read vs. write, what the code does with the value, and whether it lands on a UI surface.

3. Cross-referenced with AUDIT_1's F-32 evidence (production-data screenshots from 2026-04-24/25) to mark "currently broken" vs. "naturally avoids the issue".

4. Walked each financial page (`/financials`, `/profit-share`, `/profit-share/payouts`, `/reports/pnl`, `/reports/projects`, `/reports/profitability`, `/reports/trends`, `/reports/monthly`, `/reports/budget-vs-actual`, `/reports/outstanding`, `/cfo-dashboard`, `/withdrawals`, `/revenue`, `/invoices`, `/expenses`, `/budgets`) end-to-end from API → DB → UI to classify each surface.

5. Walked the director-payout flow from `/profit-share` → `PayoutDialog` → `/api/director-payouts` → `director_payouts` table → `withdrawals` linkage → `update_profit_share_payout_totals` trigger → `profit_share_records` columns.

Total time on the audit: ~80 minutes of reading.

---

## 3. Column-Level Inventory

### 3.1 `budget_versions.total_amount_kes`

- **Schema (`00002_tables.sql:138`):** `NUMERIC(16,2) NOT NULL DEFAULT 0`.
- **Migration history:** introduced in `00002_tables.sql`. Untouched since.
- **Population:** populated by `/api/budgets/create` (`route.ts:183`) from `totalKes` (computed JS-side from items). Re-summed and updated by `/budgets/[id]/page.tsx:269,283` after item edits, by `/api/budgets/cfo-approve/route.ts:69`, and by `/api/budgets/pm-line-review/route.ts:146`. **11/11 production rows populated.**

### 3.2 `budget_versions.total_amount_usd`

- **Schema (`00002_tables.sql:137`):** `NUMERIC(16,4) NOT NULL DEFAULT 0`.
- **Migration history:** introduced in `00002_tables.sql`. Untouched since.
- **Population:** `/api/budgets/create/route.ts:182` writes literal `0`. No other writer. **11/11 production rows = 0.0000.**

### 3.3 `budget_items.amount_kes`

- **Schema (`00002_tables.sql:156`):** `NUMERIC(16,2) NOT NULL DEFAULT 0`. Plus `unit_cost_kes NUMERIC(16,2)` nullable.
- **Migration history:** untouched.
- **Population:** `/api/budgets/create/route.ts:203` writes `(item.quantity || 1) * (item.unit_cost_kes || 0)`. Edited inline at `/budgets/[id]/page.tsx:262` (CFO/Accountant edit). Always KES-derived.

### 3.4 `budget_items.amount_usd`

- **Schema (`00002_tables.sql:155`):** `NUMERIC(16,4) NOT NULL DEFAULT 0`. Plus `unit_cost_usd NUMERIC(16,4)` nullable.
- **Migration history:** untouched.
- **Population:** `/api/budgets/create/route.ts:202` writes literal `0`, `unit_cost_usd: 0` at `:205`. No other writer. Always 0.

### 3.5 `expenses.amount_kes`

- **Schema (`00002_tables.sql:214`):** `NUMERIC(16,2) NOT NULL DEFAULT 0`.
- **Migration history:** untouched. (00009 added unrelated `period_month` and `imported_by` columns; 00007 added `lifecycle_status`; none touched the amount columns.)
- **Population:** four writers — `/api/expenses/import/route.ts:252` (xlsx import), `/api/expense-lifecycle/route.ts:267` (lifecycle confirm — copies `actual_amount_kes` from `pending_expenses`), `expense-form-dialog.tsx:138` (manual entry, only KES is exposed), `/api/misc-draws/route.ts:975` (when CFO finalizes a misc report, line items are converted to expenses with `amount_kes: lineItem.amount`). **41/42 production rows populated (one zero-amount row).**

### 3.6 `expenses.amount_usd`

- **Schema (`00002_tables.sql:213`):** `NUMERIC(16,4) NOT NULL DEFAULT 0`.
- **Migration history:** untouched.
- **Population:** every writer (above) writes `amount_usd: 0` literally. The expense-form dialog has dead state (`amountUsd`, `setAmountUsd`) but no input field for it (`expense-form-dialog.tsx:47,102,137`). **41/42 production rows = 0.0000.**

### 3.7 `invoices.amount_usd`

- **Schema (`00002_tables.sql:242`):** `NUMERIC(16,4) NOT NULL` (no default).
- **Migration history:** untouched.
- **Population:** invoice form dialog (`invoice-form-dialog.tsx:188`) — required input. Invoices are USD-native by intentional UX. **12/12 production rows populated.**

### 3.8 `invoices.amount_kes`

- **Schema (`00002_tables.sql:243`):** `NUMERIC(16,2) NOT NULL DEFAULT 0`.
- **Migration history:** untouched.
- **Population:** invoice form dialog (`invoice-form-dialog.tsx:193`) — explicitly marked "Optional KES equivalent for local reconciliation". Practice has been to leave it 0. **12/12 production rows = 0.00.**

### 3.9 `payments.amount_usd`

- **Schema (`00002_tables.sql:257`):** `NUMERIC(16,4) NOT NULL`.
- **Migration history:** untouched. (`00023_relax_payments_select_rls.sql` only changed RLS.)
- **Population:** `payment-form-dialog.tsx:86`, also written by `/reports/outstanding/page.tsx:208`. Required field. Populated.

### 3.10 `payments.amount_kes`

- **Schema (`00002_tables.sql:258`):** `NUMERIC(16,2) NOT NULL DEFAULT 0`.
- **Migration history:** untouched.
- **Population:** `payment-form-dialog.tsx:87` ("optional KES equivalent"). In practice, 0. **Status: not directly verified; data inferred to mirror invoices given the optional UX.**

(Withdrawals carry both columns and capture them at entry via USD × exchange_rate; not part of F-32's defect set.)

---

## 4. Consumer Inventory

73 distinct files reference the seven F-32 columns. Below is the consolidated inventory grouped by consumer category. "Currently broken?" is judged against today's data state (KES populated for budgets/expenses, USD populated for invoices, KES = 0 on invoices, USD = 0 on budgets/expenses). "Severity" follows the rubric in the prompt.

### 4.1 Database functions and views (highest blast radius)

| File:line | Reads | Does what | UI surface | Broken? | Severity |
|---|---|---|---|---|---|
| `00004_functions.sql:180-183` & `00025_fix_..:76-79` (`fn_calculate_project_profitability`) | `invoices.amount_usd`, `invoices.amount_kes` | sets `revenue_usd`, `revenue_kes` for the project-month | feeds `project_profitability.*` → `/reports/profitability`, `/profit-share` (record path), `cfo-dashboard` snapshot path | **YES (KES side)** — `revenue_kes = 0` for every closed month because `invoices.amount_kes = 0` | Critical |
| `00025_fix_..:82-88` (`fn_calculate_project_profitability`) | `expenses.amount_usd`, `expenses.amount_kes` | sets `direct_expenses_usd`, `direct_expenses_kes` (with lifecycle filter, post-F-26) | same as above | **YES (USD side)** — `direct_expenses_usd = 0` makes `gross_profit_usd ≈ revenue_usd` (margin ~100%) | Critical |
| `00025_fix_..:91-94` | `overhead_allocations.allocated_amount_usd/kes` | reads back the per-project allocation written by `fn_calculate_overhead_allocations` | same | YES (USD), partial (KES — see B below) | High |
| `00025_fix_..:173-187` (`fn_calculate_overhead_allocations`) | `invoices.amount_usd` (revenue ratio), `expenses.amount_usd`, `expenses.amount_kes` (shared overhead totals) | computes `v_total_overhead_usd = 0` and `v_total_overhead_kes = populated`. Allocations: `allocated_amount_usd = 0` (by-product); `allocated_amount_kes = correct` (because USD ratio works as a percentage even when paired with a KES total) | feeds `project_profitability` → reports | YES (USD only) | High |
| `00004_functions.sql:343-381` (`fn_generate_profit_shares`) | `project_profitability.distributable_profit_usd`, `distributable_profit_kes` | inserts/updates `profit_share_records.distributable_profit_*`, `director_share_*` (70%), `company_share_*` (30%) | `/profit-share` (record path), `/profit-share/payouts`, withdrawal-form-dialog payout linkage | **YES (both sides)** — KES distributable is hugely negative, USD distributable is ~100% of revenue | **Critical (director payouts depend on this)** |
| `00025_fix_..:257-269` (`fn_generate_monthly_snapshot`) | `invoices.amount_usd/kes`, `expenses.amount_usd/kes` (proj+shared, lifecycle-filtered) | writes `monthly_financial_snapshots.total_revenue_*`, `total_direct_costs_*`, `gross_profit_*`, `total_shared_overhead_*`, `operating_profit_*`, `net_profit_*` | only consumed when month is closed; cfo-dashboard, /reports/pnl, /reports/monthly | YES (both sides, both directions) | High |
| `00027_fix_..:117-125` (`fn_generate_red_flags`, overspending check) | `bv.total_amount_usd`, `expenses.amount_usd` | computes `actual_total / budget_total * 100`; both = 0 → division by NULLIF guard, no flag fires | red-flags table → /alerts page | **YES — the entire overspending red flag is structurally dead** | High (silent — flag never fires) |
| `00021_fix_..:34-35`, `00024_fix_..:60-61` (`lagged_revenue_by_project_month` view) | `invoices.amount_kes`, `invoices.amount_usd` | `total_invoice_kes` (always 0 today), `total_invoice_usd` (populated). Outer COALESCE: `NULLIF(kes,0), usd*128.5, 0` | every page that reads the lagged view (the safe path) | **NO — the COALESCE+128.5 fallback hides F-32**; also exposes `revenue_kes_estimated` boolean for the UI to indicate the fallback fired | (Cosmetic — the rate is hardcoded; see §8) |
| `00026_fix_..:93,100` (`variance_summary_by_project`) | `bv.total_amount_kes`, `expenses.amount_kes` | KES-only path | `/reports/budget-vs-actual` (any consumer) | NO | (None — KES path) |
| `supabase/sql/unified_accrual_snapshot.sql:18-31` | same as monthly snapshot, but with payment-month-shifted expenses | optional patched version of `fn_generate_monthly_snapshot` (file in repo, not in migrations directory) | dependents of monthly snapshot | YES (both sides) — same defect as `fn_generate_monthly_snapshot` | High (only if applied; current applied state is `00025`) |

Notes:
- **`fn_calculate_overhead_allocations` is the one accidentally-correct one for KES.** The revenue ratio (USD÷USD) is dimensionless, so multiplying it by `v_total_overhead_kes` (which IS populated) yields a real KES allocation per project. The USD allocation is mathematically zero but isn't visibly displayed anywhere (overhead_allocations USD is only re-read by `fn_calculate_project_profitability`).
- The view-level `* 128.5` fallback is the only path that masks F-32 successfully. Any function or page that does NOT go through the lagged view sees raw zeros.

### 4.2 API routes (writers and computed-on-read consumers)

| File:line | Reads/Writes | Does what | UI surface | Broken? | Severity |
|---|---|---|---|---|---|
| `src/app/api/project-financials/route.ts:48-83` | reads `lagged_revenue_by_project_month.lagged_revenue_kes/usd` (safe), `expenses.amount_kes` (sums confirmed expenses), `budget_versions.total_amount_kes` | computes headline revenue, expenses, budget for /financials | `/financials` page (project finance for TL/PM/CFO) | NO (already fixed in F-04 to go through the lagged view) | None |
| `src/app/api/project-financials/route.ts:71` | reads `payments.amount_usd` to compute `totalPaid` and `outstanding` | per-project outstanding USD on /financials | `/financials` outstanding tile | NO — payments are USD-native | None |
| `src/app/api/budgets/create/route.ts:182,202,205` | writes `total_amount_usd: 0`, `amount_usd: 0`, `unit_cost_usd: 0` | all USD literals zero | n/a | YES (writes the zero that breaks downstream) | Critical (root cause) |
| `src/app/api/budgets/create/route.ts:183,203,206` | writes `total_amount_kes`, `amount_kes`, `unit_cost_kes` from form | populates KES from form | feeds budget pages | NO | None |
| `src/app/api/budgets/cfo-approve/route.ts:69-72` | reads `budget_items.amount_kes`, `pm_approved_amount` | recomputes total when CFO approves | budget detail | NO (KES path) | None |
| `src/app/api/budgets/pm-line-review/route.ts:61-146` | reads `budget_items.amount_kes`; updates `budget_versions.total_amount_kes` | PM line review math | /budgets/[id] | NO (KES path) | None |
| `src/app/api/budgets/delete/route.ts:72` | reads `total_amount_kes` for audit log | audit | n/a | NO | None |
| `src/app/api/expenses/import/route.ts:54,150,251-252` | writes `amount_usd: 0`, `amount_kes: amountKes` | xlsx import → expenses | n/a | YES (writes zero USD) | Critical (root cause) |
| `src/app/api/expense-lifecycle/route.ts:266-267` | writes `amount_usd: 0`, `amount_kes: actual_amount_kes` (from pending_expenses confirm) | confirm pending expense → real expense row | feeds reports | YES (writes zero USD) | Critical (root cause) |
| `src/app/api/expense-lifecycle/route.ts:209-294,321...` | reads/writes `pending_expenses.actual_amount_kes`, `budgeted_amount_kes` | KES-only lifecycle | /expenses/queue | NO | None |
| `src/app/api/misc-draws/route.ts:975` | writes `amount_kes: lineItem.amount` (USD implicitly 0 via default) | misc-report finalize → expense | feeds reports | YES (USD = 0 by default) | Critical (root cause, indirect) |
| `src/app/api/director-payouts/route.ts:7-99` | reads `profit_share_records.balance_remaining`, `director_share_kes`; writes `director_payouts.amount_kes` (KES only) | initiate director payout | /profit-share/payouts | **NO if month is open (live calc uses lagged view path)**; **YES if month is closed (`balance_remaining` derives from `distributable_profit_kes` which is wrong)** | **Critical — see §6** |
| `src/app/api/withdrawals/create/route.ts:73-86,127-138` | reads `profit_share_records.balance_remaining`; writes `withdrawals.amount_usd/kes/exchange_rate` | record director payout via withdrawal | /withdrawals page | Same as above; also accepts USD/KES from form (both real) | **Critical — see §6** |
| `src/app/api/withdrawals/update/route.ts:61-261` | reads/writes `withdrawals.amount_usd/kes`; reads `profit_share_records.balance_remaining/total_paid_out` | edit withdrawal, replays trigger | /withdrawals | Same as above | High |
| `src/app/api/eod/route.ts:33-44,92-134,174` | reads `expenses.amount_kes`, `withdrawals.amount_usd/kes`, `payments.amount_usd/kes` | builds Slack EOD message | EOD Slack channel + /cfo dashboard EOD log dialog | NO for expenses (KES path); NO for withdrawals (both real); **payments line at `:134` displays `formatUSD(amount_usd)` and `formatKES(amount_kes)` — KES will read as `KES 0` in the Slack message because `payments.amount_kes = 0`** | Medium (one parenthetical "(KES 0)" per cash receipt in EOD Slack) |

### 4.3 Pages (read-only displays)

| File:line | Reads | Does what | UI surface | Broken? | Severity |
|---|---|---|---|---|---|
| `src/app/(dashboard)/_components/cfo-dashboard.tsx:135,151-181` | `expenses.amount_kes` (lifecycle filter); `lagged_revenue_company_month.total_revenue_kes/usd` | overrides snapshot's possibly-wrong values with live computation when month is open | CFO Home (snapshot strip area, KPI strip) | NO (already F-19 patched to override the snapshot path) | None |
| `src/app/(dashboard)/_components/cfo-dashboard.tsx:175` | `monthly_financial_snapshots.total_revenue_usd` (when month closed) | displays as KPI | CFO Home (closed-month branch) | NO — `total_revenue_usd` is correct because invoices have USD populated | None |
| `src/app/(dashboard)/_components/cfo-dashboard.tsx` (closed-month: `snapshot.total_direct_costs_kes`, `gross_profit_kes`, `operating_profit_kes`, `net_profit_kes`) | snapshot KES columns | displays | CFO Home | **YES if any closed month exists** — KES revenue in snapshot was 0 at close time, so all KES profit/cost columns are wrong | High (conditional on month closure) |
| `src/app/(dashboard)/_components/project-manager-dashboard.tsx:134-165` | `invoices.amount_usd/kes` (with USD * stdRate fallback when KES=0); `expenses.amount_kes` | per-project revenue+expense + budget overlay | PM Home | NO — has fallback identical to lagged view; bypasses lagged view (technical violation of arch rule 1) but produces correct KES | Cosmetic (architectural drift, not a defect) |
| `src/app/(dashboard)/_components/project-manager-dashboard.tsx:151,197` | `budget_versions.total_amount_kes` | budget overlay | PM Home | NO | None |
| `src/app/(dashboard)/_components/home-kpi-strip.tsx` (`useMonthlyInvoiceRevenue`) | `payments.amount_kes` (sum, current month) | "Invoice Revenue — current month (KES)" KPI card | **CFO + Accountant + PM Home** | **YES — `payments.amount_kes = 0` in production. KPI displays `KES 0` whenever any payment was actually received this month.** | **High — visibly wrong, on the front page** |
| `src/app/(dashboard)/_components/home-kpi-strip.tsx` (`useBankBalance`) | `withdrawals.amount_usd`, `payments.amount_usd` | "Bank Balance" KPI | every Home dashboard | NO | None |
| `src/app/(dashboard)/_components/home-kpi-strip.tsx` (`useMonthlyApprovedBudget`) | `budget_versions.total_amount_kes` (current month, status = approved) | "Approved Budget" KPI | every Home dashboard | NO | None |
| `src/app/(dashboard)/_components/home-kpi-strip.tsx` (`useMonthlyWithdrawn`) | `withdrawals.amount_usd` | "Withdrawn — current month (USD)" KPI | every Home dashboard | NO | None |
| `src/app/(dashboard)/_components/home-performance-strip.tsx` (`useMonthlyPlSummary`) | `lagged_revenue_by_project_month.lagged_revenue_kes` (current month); `expenses.amount_kes` (proj+shared, lifecycle-filtered) | "Total Revenue / Total Costs / Net Profit" company-wide row | every Home dashboard | NO (lagged view path) | None |
| `src/app/(dashboard)/budgets/page.tsx:180-181` | `bv.total_amount_usd`, `bv.total_amount_kes` | budget list, displays both | /budgets list page | YES (USD column always displays "USD 0") | Cosmetic (the page mostly displays KES; USD column may not be rendered — see §5) |
| `src/app/(dashboard)/budgets/[id]/page.tsx:142,447,565,594,624,661,708` | `bv.total_amount_kes`, `budget_items.amount_kes`, `pm_approved_amount` | budget detail, edit | /budgets/[id] | NO (KES path) | None |
| `src/app/(dashboard)/budgets/new/page.tsx:134,162` | `bv.total_amount_kes` (resubmit pre-fill) | new budget composer | /budgets/new | NO (KES path) | None |
| `src/app/(dashboard)/expenses/page.tsx:108,211,247` | `expenses.amount_kes` | expense list | /expenses | NO (KES path) | None |
| `src/app/(dashboard)/expenses/import/page.tsx:28,148,240` | reads imported `amount_kes` from xlsx preview | preview before commit | /expenses/import | NO | None |
| `src/app/(dashboard)/expenses/queue/page.tsx`, `expenses/variance/page.tsx` | `pending_expenses.budgeted_amount_kes`, `actual_amount_kes` | KES-only lifecycle | /expenses/queue, /expenses/variance | NO | None |
| `src/app/(dashboard)/financials/page.tsx:186` | `budget_items.amount_kes` from API payload | line-item rows in Project Financials | /financials | NO | None |
| `src/app/(dashboard)/invoices/page.tsx:34,74-219` | `invoices.amount_usd`, `payments.amount_usd` | invoice list | /invoices | NO (USD path) | None |
| `src/app/(dashboard)/misc/page.tsx:1453-1686,2524` | `expenses.amount_kes` (sums per project, per category, per scope) | misc-draws screens | /misc | NO (KES path) | None |
| `src/app/(dashboard)/profit-share/page.tsx:127-172` | live: `lagged_revenue_by_project_month.lagged_revenue_kes`, `expenses.amount_kes`. Record: `profit_share_records.distributable_profit_kes`, `director_share_kes`, `company_share_kes`, `balance_remaining`, `total_paid_out` | profit-share table; "live" branch when no records exist, "record" branch when month closed | /profit-share | **Live: NO. Record: YES** — `distributable_profit_kes` from a closed month is hugely negative because `revenue_kes = 0` at close time | **Critical (record branch only — once any month is closed, profit-share displays nonsense; director-share figures show negative KES; balance_remaining is wrong)** |
| `src/app/(dashboard)/profit-share/page.tsx:421,431` | `withdrawals.amount_usd`, `withdrawals.amount_kes` (payout history) | per-record payout history table | /profit-share | NO (withdrawals carry both real values) | None |
| `src/app/(dashboard)/profit-share/payouts/page.tsx:43,88,107,118,126-148,201` | `director_payouts.amount_kes` (display); `profit_share_records.balance_remaining`, `director_share_kes` (modal preview); `withdrawals.amount_usd/kes` | payout list, link-withdrawal modal | /profit-share/payouts | **YES** — the "+ New Payout" balance reads from `balance_remaining`, which depends on the (broken) `distributable_amount` once a month is closed | **Critical (closed months)** |
| `src/components/common/payout-dialog.tsx:117,176` | KES amount input only | initiates `/api/director-payouts` POST | reused by /profit-share and /profit-share/payouts | YES (max balance is wrong for closed months) | Critical |
| `src/components/withdrawals/withdrawal-form-dialog.tsx:36,134-203,236-262,360-380` | `profit_share_records.distributable_amount`, `balance_remaining`, `total_paid_out`; `bv.total_amount_kes`; writes `withdrawals.amount_usd/kes` | record-payout-via-withdrawal flow; balance check at line 264 | /withdrawals create/edit dialog | YES (closed-month payouts read wrong balance) | Critical |
| `src/app/(dashboard)/reports/budget-vs-actual/page.tsx` | (no direct hits — uses `variance_summary_by_project` view) | KES-only via the view | /reports/budget-vs-actual | NO (KES path via the F-27 view) | None |
| `src/app/(dashboard)/reports/monthly/page.tsx:111-196` | `expenses.amount_kes` (proj+shared, lifecycle-filtered), invoices via lagged view | monthly P&L breakdown by project + category | /reports/monthly | NO (KES path) | None |
| `src/app/(dashboard)/reports/outstanding/page.tsx:35-148,192-401` | `invoices.amount_usd`, `payments.amount_usd`; writes `payments.amount_usd/kes` | outstanding invoice list + record payment dialog | /reports/outstanding | NO (USD path) | Cosmetic (KES is optional in payment form) |
| `src/app/(dashboard)/reports/pnl/page.tsx:86-178` | live mode: `lagged_revenue_company_month.total_revenue_kes/usd`, `invoices.amount_usd/kes`, `expenses.amount_kes`, `payments.amount_usd`. Snapshot mode: `monthly_financial_snapshots.total_revenue_kes/usd, total_direct_costs_kes, gross_profit_kes, total_shared_overhead_kes, operating_profit_kes, net_profit_kes` | accrual + cash mode P&L | /reports/pnl | **Snapshot mode: YES (snapshot KES columns are wrong for any month closed pre-fix). Live mode: NO.** | **High (closed-month P&L)** |
| `src/app/(dashboard)/reports/profitability/page.tsx:68-82` | `expenses.amount_kes` (lifecycle), invoices via lagged view | per-project profitability table | /reports/profitability | NO (KES path) | None |
| `src/app/(dashboard)/reports/projects/page.tsx:87-127` | `expenses.amount_kes` (proj+shared, lifecycle); `bv.total_amount_kes` | projects-overview report | /reports/projects | NO (KES path) | None |
| `src/app/(dashboard)/reports/trends/page.tsx:179-323` | `expenses.amount_kes`; `payments.amount_usd × 128.5 (HARDCODED!)` for cash received | 6-month trends + per-project trends | /reports/trends | NO for expenses; trend-line "Cash Received" multiplies USD by hardcoded 128.5 (F-21 cosmetic — produces a real KES number) | Cosmetic |
| `src/app/(dashboard)/revenue/page.tsx:72-244` | `invoices.amount_usd/kes`, `payments.amount_usd` | revenue page (invoice list + payment dialog) | /revenue | NO (USD path); UI shows `≈ formatCurrency(usd × 128.5, 'KES')` when KES = 0 (F-21 cosmetic — hardcoded rate) | Cosmetic |
| `src/app/(dashboard)/withdrawals/page.tsx:69-118,432-438` | `withdrawals.amount_usd/kes`, `bv.total_amount_kes/usd`, invoices+payments USD | withdrawals page | /withdrawals | NO (withdrawals carry both real); the budget USD totals on this page (lines 81) read 0 but aren't displayed | None |
| `src/app/(dashboard)/audit/page.tsx:111-112` | `audit_logs.new_values` JSON | summary string for audit-log entries | /audit | NO — picks `total_amount_kes` and `amount_kes` from JSON; reads as expected | None |

### 4.4 Components, hooks, lib utilities

| File:line | Reads | Does what | UI | Broken? | Severity |
|---|---|---|---|---|---|
| `src/components/expenses/expense-form-dialog.tsx:47,102,137` | n/a (writes `amount_usd: 0`) | manual expense entry, KES-only | reused on /expenses, /financials | YES (writes zero) | Critical (root cause) |
| `src/components/expenses/expense-queue-panel.tsx:17-83,149-153` | `pending_expenses.budgeted_amount_kes/actual_amount_kes` | KES-only summary panel on home dashboards | every Home | NO | None |
| `src/components/expenses/tl-budget-vs-expenses-panel.tsx:18-19,59-159` | `pending_expenses.*` (KES) | TL home variance panel | TL home | NO | None |
| `src/components/revenue/invoice-form-dialog.tsx:37-188` | n/a (writes `amount_usd` required, `amount_kes` optional) | invoice creation (USD-native) | /revenue, /invoices | NO | None |
| `src/components/revenue/payment-form-dialog.tsx:21-86,119` | `invoices.amount_usd`; writes `payments.amount_usd/kes` | record payment dialog | reused | NO | Cosmetic (KES still optional → 0) |
| `src/components/withdrawals/withdrawal-form-dialog.tsx` | (see 4.3) | (see 4.3) | (see 4.3) | YES | Critical |
| `src/hooks/use-bank-balance.ts:36-58` | `withdrawals.amount_usd`, `payments.amount_usd` | bank-balance KPI | /home, /withdrawals | NO | None |
| `src/hooks/use-monthly-approved-budget.ts:30-45` | `bv.total_amount_kes` | KPI | /home | NO | None |
| `src/hooks/use-monthly-invoice-revenue.ts:31-46` | **`payments.amount_kes`** | "Invoice Revenue — current month (KES)" KPI | /home for CFO/Accountant/PM | **YES — always reads 0 in production** | **High — visibly wrong on home dashboard** |
| `src/hooks/use-monthly-pl-summary.ts:45-83` | `expenses.amount_kes` (proj+shared, lifecycle); lagged view | company-wide P&L row | /home | NO | None |
| `src/hooks/use-monthly-withdrawn.ts:33-49` | `withdrawals.amount_usd` | KPI | /home | NO | None |
| `src/lib/cash-balance.ts:2-13` | `payments.amount_usd` | utility for bank-balance hook + cfo-dashboard / pnl page | various | NO | None |
| `src/lib/expense-lifecycle.ts:39-173` | `budget_items.amount_kes`, `pm_approved_amount` | builds initial `pending_expenses` rows when a budget is approved | feeds /expenses/queue | NO (KES path) | None |
| `src/lib/queries/budgets.ts:6` | `bv.total_amount_usd, total_amount_kes` (selects both) | shared list query | /budgets, /withdrawals, etc. | NO (callers use KES; USD selected but ignored on most paths) | Cosmetic |
| `src/lib/queries/expenses.ts:11-20` | `expenses.amount_kes` | utility | various | NO | None |
| `src/lib/queries/invoices.ts:5,31-35` | `invoices.amount_usd`, `payments.amount_usd` | utility | /invoices, /financials | NO | None |
| `src/types/database.ts:100-281` | type definitions for all the columns | n/a | n/a | n/a | n/a |

---

## 5. UI Surface Map

This is the layer that decides whether F-32 is visible to a human.

| Surface | Path / file | Source chain | What the user sees today | Classification |
|---|---|---|---|---|
| **Home — "Invoice Revenue — current month"** | `/(dashboard)/page` (CFO/Accountant/PM all see `home-kpi-strip.tsx`) | `useMonthlyInvoiceRevenue` → `payments.amount_kes` | `KES 0` whenever current-month payments exist (because every payment row has `amount_kes = 0` today) | **VISIBLY-WRONG — every role's home dashboard, current month** |
| **Home — Bank Balance / Approved Budget / Withdrawn / Performance row** | `home-kpi-strip` + `home-performance-strip` | USD or lagged-view paths | correct | CORRECT |
| **/profit-share — live data branch** | `profit-share/page.tsx` | lagged view + `expenses.amount_kes` | correct (revenue from view applies 128.5 fallback; expenses populated) | CORRECT |
| **/profit-share — record-data branch (after a month closes)** | `profit-share/page.tsx` (lines 127-172) | `profit_share_records.distributable_profit_kes/director_share_kes/company_share_kes/balance_remaining/total_paid_out` | **Distributable: large negative KES (e.g. ≈ −total_expenses). Director share / company share: also negative or zeroed out. Balance remaining: wrong.** Once a month closes via `fn_close_month`, this page becomes nonsense. | **VISIBLY-WRONG (only after closure; no months are confirmed-closed in the audit, but the next close will trigger this)** |
| **/profit-share/payouts — "+ New Payout" dialog max-balance** | `profit-share/payouts/page.tsx:122-148` + `payout-dialog.tsx` | `profit_share_records.balance_remaining` | **For closed months: the modal will show the wrong "Available balance"; the API enforces it as the upper bound, blocking valid payouts and/or allowing wrong-amount payouts** | **VISIBLY-WRONG and BLOCKING (post-closure)** |
| **/profit-share/payouts — payouts list** | same page | `director_payouts.amount_kes` | already-recorded amounts read correctly (entered by hand) | CORRECT |
| **/withdrawals — director-payout dialog "Available balance"** | `withdrawal-form-dialog.tsx:236-275,320-385` | `profit_share_records.distributable_amount`, `balance_remaining` | same defect as the payout dialog | **VISIBLY-WRONG (post-closure)** |
| **/withdrawals — list** | `/withdrawals/page.tsx:432-438` | `withdrawals.amount_usd/kes` | correct | CORRECT |
| **/cfo-dashboard — month-open snapshot path** | `cfo-dashboard.tsx:172-181` (F-19 patched) | overrides snapshot with live KES from lagged view + confirmed expenses | correct | CORRECT |
| **/cfo-dashboard — month-closed snapshot path** | `cfo-dashboard.tsx:166-171` | reads raw `monthly_financial_snapshots.total_revenue_kes`, `total_direct_costs_kes`, `gross_profit_kes`, `operating_profit_kes`, `net_profit_kes` | **Closed months produce massively negative KES revenue** (snapshot was written by `fn_generate_monthly_snapshot` which sums `invoices.amount_kes = 0`). The KPI strip is overridden by HomeKpiStrip + HomePerformanceStrip which use the safe path, so this defect manifests only on the inline snapshot tile if any | **HIDDEN today (no closed month) → VISIBLY-WRONG once any month closes** |
| **/reports/pnl — accrual mode (current month, no snapshot)** | `pnl/page.tsx:124-181` | lagged view + lifecycle-filtered expenses | correct | CORRECT |
| **/reports/pnl — accrual mode, snapshot present** | `pnl/page.tsx:94-115` | reads `monthly_financial_snapshots.total_revenue_kes/usd, total_direct_costs_kes, gross_profit_kes, total_shared_overhead_kes, operating_profit_kes, net_profit_kes` | **same defect as cfo-dashboard closed branch** | **HIDDEN today (no snapshot for displayed months) → VISIBLY-WRONG post-closure** |
| **/reports/pnl — cash mode** | `pnl/page.tsx:155-162` | `payments.amount_usd × stdRate` | correct (USD path × stdRate) | CORRECT (modulo F-21 fallback constant drift) |
| **/reports/profitability** | `reports/profitability/page.tsx:68-82` | lagged view + `expenses.amount_kes` | correct | CORRECT |
| **/reports/projects** | `reports/projects/page.tsx:87-127` | `expenses.amount_kes` + `bv.total_amount_kes` | correct | CORRECT |
| **/reports/budget-vs-actual** | view-backed | `variance_summary_by_project` (KES-only) | correct (after F-27 fix) | CORRECT |
| **/reports/budget-accuracy** | (didn't appear in §4 grep — see Open Questions §10) | UNKNOWN | UNKNOWN — needs verification | UNKNOWN |
| **/reports/monthly** | `reports/monthly/page.tsx` | `expenses.amount_kes` lifecycle; lagged view | correct | CORRECT |
| **/reports/outstanding** | `reports/outstanding/page.tsx` | `invoices.amount_usd`, `payments.amount_usd` | correct | CORRECT |
| **/reports/trends** | `reports/trends/page.tsx:284` | `payments.amount_usd × 128.5` (hardcoded) | shows a real KES "cash received" trend, but the rate constant drifts vs other pages (F-21) | CORRECT-ish (cosmetic) |
| **/financials (Project Financials)** | `financials/page.tsx` + `/api/project-financials/route.ts` | lagged view + `expenses.amount_kes` (already F-04 fixed) | correct | CORRECT |
| **/budgets list** | `budgets/page.tsx:180-181` | `bv.total_amount_usd` and `total_amount_kes` (selected, used) | the page renders KES; if there's a USD column anywhere it reads `USD 0` (didn't render in my read of the relevant table) | likely SILENTLY-WRONG (USD selected but appears unused in the displayed columns — verify visually) |
| **/budgets/[id] detail** | `budgets/[id]/page.tsx` | `bv.total_amount_kes`, `budget_items.amount_kes` | correct | CORRECT |
| **/budgets/new (composer)** | `budgets/new/page.tsx` | KES-only resubmit pre-fill | correct | CORRECT |
| **/expenses list** | `expenses/page.tsx` | `expenses.amount_kes` | correct | CORRECT |
| **/expenses/import preview** | `expenses/import/page.tsx` | xlsx `amount_kes` | correct | CORRECT |
| **/expenses/queue** | `expenses/queue/page.tsx` + `expense-queue-panel.tsx` | `pending_expenses.*` (KES-only) | correct | CORRECT |
| **/expenses/variance** | `expenses/variance/page.tsx` | `pending_expenses.*` | correct | CORRECT |
| **/invoices list** | `invoices/page.tsx` | `invoices.amount_usd`, `payments.amount_usd` | correct (USD-native) | CORRECT |
| **/revenue** | `revenue/page.tsx` | invoices + payments USD; KES auto-displayed via `≈ usd × 128.5` (F-21) | correct (with cosmetic constant drift) | CORRECT-ish |
| **/misc page** | `misc/page.tsx` | `expenses.amount_kes` aggregations | correct | CORRECT |
| **/audit page** | `audit/page.tsx` | `audit_logs.new_values` | correct (KES path) | CORRECT |
| **/director-payouts (= /profit-share/payouts)** | as above | as above | as above | as above |
| **EOD Slack message — Cash Received line** | `api/eod/route.ts:134` | `payments.amount_kes` | "USD 1,200 (KES 0) — Ref: …" — the parenthetical KES will read as zero | VISIBLY-WRONG (one parenthetical per cash receipt) |
| **EOD Slack message — Expenses & Withdrawals lines** | same file | `expenses.amount_kes`, `withdrawals.amount_usd/kes` | correct (KES populated, withdrawals carry both) | CORRECT |
| **/alerts (red flags)** | `red_flags` table consumer (didn't appear in §4 grep, but `fn_generate_red_flags` writes the rows) | rows + descriptions | the overspending red flag never fires; the EOD page shows fewer red flags than expected | **HIDDEN — silent miss; impossible for users to notice without ground truth** |

**Summary classification (counts):**
- VISIBLY-WRONG today: 3 (Home Invoice Revenue KPI; EOD Slack cash-received KES parenthetical; — these are visible right now in production)
- VISIBLY-WRONG once a month closes: 4 (profit-share record branch; payout dialog max-balance; withdrawal payout-balance check; cfo-dashboard closed-month tile; pnl snapshot mode)
- SILENTLY-WRONG: 1 (red flags overspending check never fires; budgets-list USD column if rendered)
- HIDDEN: ~3 (closed-month surfaces, currently no closed months in displayed range)
- CORRECT (KES path through lagged view): ~25
- CORRECT (USD path natively): ~10

The lagged_revenue view's `* 128.5` fallback is doing extraordinary load-bearing work. Without it, /financials, /reports/pnl-accrual-current-month, /reports/profitability, /reports/projects, /reports/monthly, /profit-share-live, every Home performance strip, every CFO dashboard, and every PM dashboard would all show KES revenue = 0 right now.

---

## 6. Director Payout Analysis (Critical)

### The flow today

1. **CFO opens `/profit-share`** → `profit-share/page.tsx:111` runs `load()`.
2. The page first queries `profit_share_records` for the selected month. If any exist, it switches to the **record branch**; otherwise it switches to the **live branch**.
3. **Live branch (no closed records yet):** revenue from `lagged_revenue_by_project_month.lagged_revenue_kes` (correct via the 128.5 fallback). Expenses from `expenses.amount_kes` (correct). Distributable = revenue − direct_costs. Director share = 70%, company share = 30%. **Numbers are correct.**
4. **Record branch (any month closed):** reads `profit_share_records.distributable_profit_kes`, `director_share_kes`, `company_share_kes`, `balance_remaining`, `total_paid_out`. **All KES values were written by `fn_calculate_project_profitability` + `fn_generate_profit_shares`, which subtract `expenses.amount_kes` from `invoices.amount_kes = 0`.** The result is a large negative number for every project that had any expenses.
5. **CFO clicks "+ Initiate Payout"** → opens `PayoutDialog` (`payout-dialog.tsx`), max-balance = `record.balance_remaining`. POSTs to `/api/director-payouts`.
6. **`/api/director-payouts/route.ts:57-83`** validates `body.amount_kes <= psRecord.balance_remaining`. After closure, that balance is wrong; either valid payouts get rejected or the wrong remaining figure is shown.
7. **Director payout records are stored in KES** in `director_payouts.amount_kes` (`00018:7`). The amount the director eventually receives is settled by linking a withdrawal (or marking as cash-paid). `withdrawals.amount_kes` and `withdrawals.amount_usd` are then both real numbers because the withdrawal form captures USD × exchange_rate.

### Are profit_share_records.distributable_profit_usd correct today?

**No.** The trigger chain is:

```
fn_close_month
 → fn_calculate_overhead_allocations  (writes overhead_allocations: USD=0, KES=correct)
 → fn_calculate_project_profitability (writes project_profitability:
     revenue_usd = correct, revenue_kes = 0,
     direct_expenses_usd = 0, direct_expenses_kes = correct,
     gross_profit_usd = revenue_usd, gross_profit_kes = -direct_expenses_kes,
     distributable_profit_usd = revenue_usd, distributable_profit_kes = -direct_expenses_kes - overhead_kes)
 → fn_generate_profit_shares          (copies above into profit_share_records,
                                       70/30 splits propagate the same errors)
 → fn_generate_monthly_snapshot       (same defect at the company level)
```

So **`distributable_profit_usd` ≈ full USD revenue (i.e. zero costs subtracted)** and **`distributable_profit_kes` is large negative**.

If a director payout in USD were initiated today via a path that read from `profit_share_records.distributable_profit_usd` or `director_share_usd`, the proposed figure would be **70% of full USD revenue** — overstated by ~100% (since costs would be ignored). Fortunately, the existing payout flows use **KES amounts only** (`director_payouts.amount_kes`, `payout-dialog.tsx:175`, `/api/director-payouts/route.ts:53`, `withdrawal-form-dialog.tsx:330` all KES), and the live-branch /profit-share computes balances from the lagged view — so **TODAY**, before any month is closed, payout amounts are right.

### Are there any closed months in production?

UNKNOWN — needs verification (see §11 SQL #1). AUDIT_1's evidence captured 2026-04-25 didn't surface a `month_closures.status = 'closed'` row, but production state at audit time was not cross-checked. **If any closed month exists, F-32 is already producing wrong director-payout balances on that month; if none exists, the next month-close action will produce them.**

### Would today's proposed payout figure be right?

- For the **current open month**, `/profit-share` live branch: **yes**, because revenue comes through the lagged view (which converts USD→KES via the 128.5 fallback) and expenses are populated.
- For **any closed month**, **no**: balance_remaining is the wrong KES number.
- For **a payout that is denominated in USD** by a hypothetical future code path reading `director_share_usd` directly: **no** — the USD share is overstated by roughly 100% (full revenue minus zero costs).

### Recommendation

Until F-32 ships, **block month-close** (or at minimum, block the `fn_generate_profit_shares` step) for any month. The on-disk view-based path is correct; the snapshot/closure path is structurally wrong. Document this in the CFO runbook before any director payout is initiated against a closed month. **No director payout in USD should be initiated against `director_share_usd` from the records table — only KES live-branch figures should be used until F-32 fix lands.**

This is the single highest-stakes finding in the audit.

---

## 7. Architecture Options

Each option is sized against the §4 row count. Where I say "N consumers", I mean rows from §4.1–4.4 that need a behavior change.

### Option A — KES Canonical

**Brief.** KES is the source of truth on `budget_versions`, `budget_items`, `expenses`, `withdrawals`. USD on those tables becomes derived-at-read using `system_settings.standard_exchange_rate`. Invoices and payments stay USD-native (the existing canonical for client billing) — but their `amount_kes` becomes derived-at-read using the same rate. The lagged_revenue view's `× 128.5` fallback gets replaced by `× (SELECT standard_exchange_rate)`.

**Required changes (by §4 row).**

- §4.1 functions: rewrite `fn_calculate_project_profitability` to compute `revenue_kes = SUM(invoices.amount_usd) × rate` and `revenue_usd = SUM(invoices.amount_usd)`. Same pattern for `fn_calculate_overhead_allocations` (overhead totals: KES from `expenses.amount_kes`; USD from `kes/rate`). `fn_generate_monthly_snapshot` same. `fn_generate_profit_shares` propagates the new (correct) `distributable_profit_*` values. `fn_generate_red_flags` overspending check switches to KES (read `bv.total_amount_kes` and `expenses.amount_kes`).
- §4.2 API writers: stop writing `amount_usd: 0` literals in `/api/budgets/create`, `/api/expenses/import`, `/api/expense-lifecycle`, `/api/misc-draws`, `expense-form-dialog`. Best done by removing the literal (let the column default to 0; the column eventually becomes vestigial). Or drop the USD columns entirely in a follow-up.
- §4.3 pages: no changes needed (most are already on the KES path through the view). Snapshot consumers (cfo-dashboard closed branch, /reports/pnl snapshot mode) keep reading `total_revenue_kes` / `gross_profit_kes` / etc., which will now be correct.
- §4.4 hooks: **fix `useMonthlyInvoiceRevenue` to read `lagged_revenue_company_month.total_revenue_kes` for the current calendar month, OR sum `payments.amount_usd × rate`.** This is independently broken regardless of architecture choice — Option A surfaces the fix path most cleanly.
- Lagged view: replace hardcoded 128.5 with `(SELECT value::numeric FROM system_settings WHERE key='standard_exchange_rate')`. Or refactor into an immutable SQL function `fn_usd_to_kes(amount_usd)` for testability.

**Migrations needed.** One migration that redefines the four functions + the lagged view. No structural ALTERs. Optional follow-up: drop the USD columns on `budget_versions`, `budget_items`, `expenses` after a transition period (low value, low cost).

**Pros.**
- Matches current data state — no backfill needed.
- Matches the input UX (every budget/expense form already says "KES").
- Removes the silent "amount_usd: 0" landmine (dead code).
- Aligns with KE accounting reality (invoices to clients are USD; everything else is KES).

**Cons.**
- USD-denominated reports become rate-dependent; if the rate moves between snapshot generation and re-render, USD totals shift. Mitigation: snapshot the rate in `monthly_financial_snapshots` at close time and pin it.
- Invoices remain USD-native, so a single arithmetic boundary still exists (USD revenue → KES). That's load-bearing but small and well-understood.

**Effort estimate.** 8–12 hours: ~3h migration writing/testing, ~2h hook fix, ~2h snapshot regeneration of any closed months, ~3h verification + smoke tests on /profit-share, /reports/pnl, /cfo-dashboard.

**Backfill.** None for budgets/expenses. For any closed `monthly_financial_snapshots` rows — recompute via re-running `fn_close_month` after the fix migration. AUDIT_1's evidence suggests no closed months exist; if any do, they're stale and should be regenerated regardless.

### Option B — USD Canonical

**Brief.** USD is the source of truth everywhere. KES on budgets/expenses becomes derived-at-read. Invoices stay USD-native. KES forms get replaced with USD forms, and budgets/expenses get back-converted from KES to USD using historical or current rate.

**Required changes.**

- §4.2 API writers: every budget/expense form would need to capture USD instead of KES, OR both. Forms expanded.
- §4.1 functions: equivalent rework, but in the opposite direction.
- §4.3 pages: most pages display KES today (Tailwind/copy says "KES" everywhere). Either flip page copy to USD or compute KES at read.
- §4.4 hooks: `useMonthlyInvoiceRevenue` still needs the same fix.

**Migrations needed.** A backfill script that converts every existing `budget_versions.total_amount_kes`, `budget_items.amount_kes`, and `expenses.amount_kes` to USD using a per-month historical rate (or current rate). Then rewrite functions/views.

**Pros.**
- Aligns with revenue currency (clients pay in USD).
- Simplifies director-payout decimals (USD has 4dp in the schema; KES has 2dp).

**Cons.**
- Full backfill of historical KES → USD with rate-history hassle.
- UX rewrite of every input form (5+ forms).
- KE accounting books are KES; flipping the canonical creates ongoing rate-conversion FX-noise on every page.
- High risk of getting historical rates wrong → distorted monthly comparisons retroactively.

**Effort estimate.** 30–60 hours, plus Njuguna's accountant validating the historical rates.

**Backfill.** Required for every existing budget_versions, budget_items, expenses row. Requires a per-month historical USD/KES rate table that doesn't exist today (`forex_rates` table from 00009 exists but is unpopulated — see §10).

### Option C — Dual-store with conversion trigger

**Brief.** Keep both columns. Add a `BEFORE INSERT/UPDATE` trigger on `budget_versions`, `budget_items`, `expenses` that populates `amount_usd` from `amount_kes / rate`. Add a symmetric trigger on `invoices` and `payments` that populates `amount_kes` from `amount_usd × rate`. Backfill historical rows.

**Required changes.**

- §4.1 functions: NO code changes — `fn_calculate_project_profitability` keeps using `amount_usd` and `amount_kes` directly, but both columns are now populated.
- §4.2 API writers: stop writing `amount_usd: 0` literals (the trigger will overwrite anyway, but writing 0 explicitly + having the trigger fire may double-write). Cleanest path: remove the literals.
- §4.3, §4.4: NO changes.
- The `useMonthlyInvoiceRevenue` hook starts working correctly without any code change (because `payments.amount_kes` would now be populated by the symmetric trigger).

**Migrations needed.** One migration with:
1. `fn_usd_to_kes(amount_usd, rate)` and `fn_kes_to_usd(amount_kes, rate)` immutable SQL functions.
2. `BEFORE INSERT/UPDATE` triggers on the five tables.
3. Backfill UPDATE statements for existing rows. **Open question:** do we use the current `standard_exchange_rate` for all historical backfill (simple, but introduces a fictitious rate-as-of-today), or use per-month historical rates from `forex_logs` / `withdrawals.exchange_rate` (accurate, but the rates table is sparse)?

**Pros.**
- Fewest code changes — the §4 grep stays mostly green.
- Preserves the "both columns populated" invariant the original schema seems to assume.
- USD KPIs (cfo-dashboard, etc.) start working without page changes.
- Symmetric: invoice KES gets populated, fixing `useMonthlyInvoiceRevenue` and the EOD Slack KES parenthetical.

**Cons.**
- Triggers on five tables are a moving piece that future migrations have to keep in sync. (Mitigation: a single shared function called from each table's trigger.)
- Need a single source of truth for the rate. If `system_settings.standard_exchange_rate` is updated, all new INSERTs use the new rate while old rows retain the old conversion — fine semantically, but operationally subtle.
- Backfill has to choose between historical rate (correct, requires data) and current rate (simple, slightly wrong).
- Doesn't solve the F-21 hardcoded-128.5 drift in the lagged view (still need to update that separately).

**Backfill question (important).** If we use the **current** rate, every historical row gets a USD value computed at TODAY's rate, which produces nonsensical month-over-month USD comparisons (a USD 100 line in February and a USD 100 line in April would have been very different KES at the time of entry). If we use a **per-month historical** rate, the source must be either the unpopulated `forex_rates` table from `00009` or an aggregate of `withdrawals.exchange_rate`/`forex_logs.rate_usd_to_kes` per month — **neither has guaranteed coverage for every month**. In practice, the only place historical USD comparisons would matter is /reports/trends and the snapshot table, which is already KES-displayed everywhere.

**Symmetry question (also important).** Should invoices also get a USD→KES trigger? **Probably yes** — that's the symmetric move. Two consequences if we do:
1. `useMonthlyInvoiceRevenue` starts returning real numbers (currently sums `payments.amount_kes = 0`).
2. The lagged view's `× 128.5` fallback becomes redundant — `inv.total_invoice_kes` is no longer 0, so the COALESCE picks it up first. (The fallback can stay as a defensive belt-and-suspenders.)
3. Payments `amount_kes` also gets populated by the trigger, fixing the EOD Slack `KES 0` parenthetical.

**Effort estimate.** 6–10 hours: ~3h migration (trigger + backfill), ~1h verification, ~2h regenerating closed-month snapshots if any.

---

## 8. Cross-Cutting Issues

### 8.1 Exchange-rate constant drift (F-03 + F-21)

Five distinct sources of "the rate" exist today:

| Where | Value | Notes |
|---|---|---|
| `system_settings.standard_exchange_rate` | 129.5 (per `settings/page.tsx:76` default) | The intended source of truth |
| `lagged_revenue_by_project_month` view (00021, 00024) | hardcoded **128.5** | Used as USD→KES fallback when invoice KES = 0 |
| `cfo-dashboard.tsx:148` | parses system_setting; falls back to **129.5** if missing | OK if setting populated |
| `pm-dashboard.tsx:130` | parses system_setting; falls back to **129.5** | OK if setting populated |
| `pnl/page.tsx:146` | parses system_setting; falls back to **129.5** | OK |
| `revenue/page.tsx:75` | hardcoded **128.5** | Display-only "≈" badge |
| `reports/trends/page.tsx:173` | hardcoded **128.5** | Trend-line "Cash Received" |

Whichever architecture is chosen, **F-03** must consolidate these into one source. Recommendation: a SQL function `fn_get_standard_rate()` or a single `import { STANDARD_RATE_FALLBACK } from '@/lib/constants/currency'` constant, with the runtime lookup against `system_settings`.

- **Option A interaction:** Option A turns the rate into a per-query lookup; the consolidation is mandatory and easy.
- **Option B interaction:** Same.
- **Option C interaction:** Triggers need the rate at write time. If `system_settings.standard_exchange_rate` is the single source, the consolidation is free.

### 8.2 Has anyone manually corrected USD values in production?

Worth a one-shot read-only check:

```sql
SELECT 'budget_versions' AS table_name, COUNT(*) AS nonzero_usd_count
  FROM budget_versions WHERE total_amount_usd <> 0
UNION ALL
SELECT 'budget_items', COUNT(*) FROM budget_items WHERE amount_usd <> 0
UNION ALL
SELECT 'expenses', COUNT(*) FROM expenses WHERE amount_usd <> 0;
```

AUDIT_1 evidence (11/11 budget_versions zero, 41/42 expenses zero) suggests the answer is "essentially no". If a one-off fix ever did set a non-zero value, an architecture flip would either preserve it (Option A — vestigial column ignored) or overwrite it (Option C trigger). Worth flagging.

### 8.3 Multi-currency invoices

The invoice table has only USD/KES columns. If any historical or future invoice is in EUR, GBP, etc., it has to be expressed as USD. Per `invoice-form-dialog.tsx`, only USD is captured. **Worth confirming with Njuguna:** are there any non-USD invoices? (See §10.)

### 8.4 `fn_calculate_overhead_allocations` is accidentally correct on KES

This is a mild architectural smell — the math works because the USD revenue ratio is dimensionless and the KES overhead total is populated. Whichever architecture is picked, this function should be rewritten so its currency model is explicit (the input ratio and the output total are clearly in the same currency). Today its correctness is structural luck.

### 8.5 The vestigial `forex_rates` table

`00009_appendix_o_fixes.sql:30-39` introduces a `forex_rates` table for historical per-day rates. It is unreferenced in `src/` and presumably empty in production. If Option C with historical-rate backfill is chosen, this table is the natural place to populate the rate timeline; otherwise it can be deferred / dropped.

### 8.6 The "data_source = historical_seed" branch on /reports/pnl

`pnl/page.tsx:71-80` shows that historical seed snapshots are read directly. Whichever option is chosen, those snapshots need to be classified: are they trustworthy (entered correctly at seed time) or do they need recomputation? AUDIT_1 didn't address this. (See §10.)

---

## 9. Recommendation

**Option C (dual-store with conversion trigger), with backfill at the current standard rate, plus invoice-side symmetric trigger.**

Rationale:

1. **Smallest code blast radius.** §4 has 73 files touched. Option A requires editing every function in §4.1; Option C requires no changes there. The risk of a fix migration introducing new defects scales with the number of consumers touched.
2. **Symmetric repair.** The invoice-side trigger fixes `useMonthlyInvoiceRevenue` (the most visible defect — Home dashboard "Invoice Revenue: KES 0") and the EOD Slack parenthetical, both for free.
3. **Preserves the schema's original intent.** The schema has both columns NOT NULL DEFAULT 0 — clearly designed assuming both would be populated. The defect is the missing trigger, not the column choice. Option C is the smallest patch that matches the original intent.
4. **Makes Option A trivially future-reachable.** Once both columns are populated, dropping one in 6 months becomes a no-op decision, not a migration.
5. **The historical-rate question is small.** If Njuguna prefers historical fidelity, the per-month rate can be recovered from `withdrawals.exchange_rate` aggregates (which DO exist). If not, the current rate is fine — we already accept the lagged view's hardcoded 128.5 as an approximation.

Risks I'm betting against:
- Trigger maintenance burden in future migrations. Mitigation: a single SQL function `fn_apply_currency_conversion()` shared by all five triggers.
- Rate updates causing month-to-month inconsistency on USD displays. Mitigation: pin the rate in `monthly_financial_snapshots` at close time.

If Njuguna disagrees and prefers a clean single-currency model, **Option A** is the next-best — small migration, no code-side blast radius, but requires accepting that USD columns become vestigial (ok) or doing a follow-up DROP (more work).

**Option B I would not recommend.** It requires a UI rewrite for accountants who today think in KES, and the historical USD backfill is genuinely uncertain.

One-line recommendation:

> **Option C with both-direction triggers, backfilled at the current standard rate, and `fn_apply_currency_conversion` as the single rate-aware function shared across all triggers and the lagged view.**

---

## 10. Open Questions for Njuguna

1. **Do any closed `month_closures.status = 'closed'` rows exist in production?** This determines whether F-32 has already produced wrong values in `monthly_financial_snapshots` and `profit_share_records` that need regeneration, or whether the next month-close is the first time it would manifest. (AUDIT_1's data dump didn't enumerate this.)

2. **Does any non-USD-non-KES currency invoice exist or is one expected?** EUR/GBP/etc. Today the schema and forms only support USD-native invoicing.

3. **Do directors ever see USD figures, or only KES?** Reading the code, every director-payout surface is KES-only (`director_payouts.amount_kes`, the payout dialog labels say "KES", etc.). But /profit-share/payouts could in principle be extended to show USD shares. If yes, the F-32 USD-overstatement defect becomes Critical-immediate; if no, the existing KES path through the live branch is enough until closure happens.

4. **What's the policy on the historical USD/KES rate for backfill (if Option C)?** Three choices:
   - (a) Current standard rate for all rows (simple, slight historical distortion).
   - (b) Per-month average from `withdrawals.exchange_rate` (more accurate but irregular coverage).
   - (c) Per-day from `forex_logs.rate_usd_to_kes` if populated (most accurate, sparsest data).

5. **Is `system_settings.standard_exchange_rate` actually populated in production?** AUDIT_1 said "likely populated". If empty, the consolidation in §8.1 needs to seed it first.

6. **Does the `forex_rates` table from 00009 hold any data?** If yes, it's the natural input for a historical-rate-aware Option C backfill. If empty, can defer.

7. **Is `/reports/budget-accuracy` an actual page?** AUDIT_1 mentioned it; I didn't find it in `src/app/(dashboard)/reports/`. Could be planned, deferred, or renamed. If it exists somewhere I missed, it needs to be added to §4-§5.

8. **Compliance / external-reporting requirement?** KES is required for KE tax/audit; USD is required for client billing. If there's a compliance need to display *both* currencies on certain reports (e.g. board pack), Option C is the only one that gets there for free; Options A and B require a derived column.

9. **Should `fn_calculate_overhead_allocations` (which is accidentally KES-correct, USD-wrong) be a P1 fix even if the broader F-32 remediation is delayed?** It's dead code in the USD direction — overhead_allocations.allocated_amount_usd reads as 0 everywhere, and `fn_calculate_project_profitability` consumes it. Worth confirming the implicit deferral.

10. **Are there any existing director-payout records that were initiated against a closed month's wrong balance?** If yes, they need to be reconciled by hand. (None expected today since AUDIT_1's data dump showed live-month-only payouts.)

---

## 11. Verification SQL (read-only)

These are ready-to-paste for "Claude in Chrome" or the Supabase SQL Editor.

### 11.1 Has any month been closed?

```sql
SELECT year_month, status, closed_by, closed_at, reopen_reason
FROM month_closures
ORDER BY year_month DESC;
```

### 11.2 Has `fn_calculate_project_profitability` written rows? (i.e. has anyone closed a month or run the function manually?)

```sql
SELECT year_month, COUNT(*) AS project_rows,
       SUM(CASE WHEN distributable_profit_kes < 0 THEN 1 ELSE 0 END) AS rows_with_negative_kes_profit,
       SUM(CASE WHEN distributable_profit_usd > 0 AND direct_expenses_usd = 0 THEN 1 ELSE 0 END) AS rows_with_overstated_usd_profit
FROM project_profitability
GROUP BY year_month
ORDER BY year_month DESC;
```

If any rows show, the §6 finding has already manifested in production data.

### 11.3 Has any USD value been hand-corrected?

```sql
SELECT 'budget_versions' AS table_name,
       COUNT(*) FILTER (WHERE total_amount_usd <> 0) AS nonzero_usd,
       COUNT(*) AS total
FROM budget_versions
UNION ALL
SELECT 'budget_items', COUNT(*) FILTER (WHERE amount_usd <> 0), COUNT(*) FROM budget_items
UNION ALL
SELECT 'expenses', COUNT(*) FILTER (WHERE amount_usd <> 0), COUNT(*) FROM expenses
UNION ALL
SELECT 'invoices_kes', COUNT(*) FILTER (WHERE amount_kes <> 0), COUNT(*) FROM invoices
UNION ALL
SELECT 'payments_kes', COUNT(*) FILTER (WHERE amount_kes <> 0), COUNT(*) FROM payments;
```

### 11.4 What's the live `standard_exchange_rate`?

```sql
SELECT key, value, updated_at
FROM system_settings
WHERE key IN ('standard_exchange_rate', 'bank_balance_usd');
```

### 11.5 Is `forex_rates` (00009) populated?

```sql
SELECT COUNT(*) AS row_count, MIN(rate_date) AS first_date, MAX(rate_date) AS last_date
FROM forex_rates;
```

### 11.6 Per-month average rate from withdrawals (potential Option C backfill source)

```sql
SELECT to_char(withdrawal_date, 'YYYY-MM') AS month,
       AVG(exchange_rate) AS avg_rate,
       MIN(exchange_rate) AS min_rate,
       MAX(exchange_rate) AS max_rate,
       COUNT(*) AS withdrawal_count
FROM withdrawals
WHERE exchange_rate > 0
GROUP BY 1
ORDER BY 1;
```

### 11.7 Is `payments.amount_kes` ever non-zero?

```sql
SELECT COUNT(*) AS total_payments,
       COUNT(*) FILTER (WHERE amount_kes > 0) AS with_kes,
       COUNT(*) FILTER (WHERE amount_kes = 0) AS kes_zero
FROM payments;
```

If `with_kes > 0`, the EOD Slack parenthetical and the `useMonthlyInvoiceRevenue` hook are partially-broken-not-fully-broken — useful to know before fix sequencing.

### 11.8 Confirm no DB triggers exist on the relevant tables besides the audit/updated_at ones

```sql
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('budget_versions', 'budget_items', 'expenses', 'invoices', 'payments')
ORDER BY event_object_table, trigger_name;
```

Expected output (per AUDIT_1): only `audit_*` and `set_updated_at_*` triggers, plus `validate_expense_budget` on expenses. No conversion trigger.

### 11.9 Are `profit_share_records.distributable_amount` and friends actually present?

(The schema in `00002` doesn't define `distributable_amount`, but `00017_withdrawal_type.sql:80` references it. CLAUDE.md / AGENTS.md flags drift between disk migrations and live DB.)

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profit_share_records'
ORDER BY ordinal_position;
```

This will reveal whether `distributable_amount`, `period_month`, `director_name`, etc. (referenced by the withdrawal-form-dialog and the `00018` trigger) actually exist in the live DB and whether they're aliases or real columns.

### 11.10 Snapshot of one project's USD/KES profit values (sanity check the §6 narrative)

```sql
SELECT pp.year_month,
       p.name,
       pp.revenue_usd, pp.revenue_kes,
       pp.direct_expenses_usd, pp.direct_expenses_kes,
       pp.allocated_overhead_usd, pp.allocated_overhead_kes,
       pp.gross_profit_usd, pp.gross_profit_kes,
       pp.distributable_profit_usd, pp.distributable_profit_kes
FROM project_profitability pp
JOIN projects p ON p.id = pp.project_id
ORDER BY pp.year_month DESC, p.name
LIMIT 30;
```

### 11.1 Verification Findings (executed 2026-04-28)

| Query | Result | Action |
|---|---|---|
| Q11.1 closed months | none yet (workflow not exercised) | informational |
| Q11.2 project_profitability sign integrity (2026-04, n=6) | 0 rows with `negative_kes_profit` or `overstated_usd_profit` | none — F-32 working as designed |
| Q11.3 expenses with nonzero amount_usd | 51/52 nonzero; 1 legitimate `$0` shared_expense placeholder (amount_kes=0 → amount_usd=0) | none — correct conversion, not a trigger gap |
| Q11.4 system_settings keys | `standard_exchange_rate=129.5`, `bank_balance_usd=5405` both present | none |
| **Q11.5 forex_rates population** | **table empty (0 rows)** | **latent — log F-32.1 deferred** |
| Q11.6 2026-04 withdrawal rate spread | avg 129.166, min 129.0, max 129.3 (n=3) | none — 23bps intra-month spread, single-rate backfill viable |
| Q11.7 payments with nonzero amount_kes | 7/7 nonzero | none |
| Q11.8 currency-sync triggers (`tr_currency_sync_*`) | present on **all 5** financial tables (budget_versions, budget_items, expenses, invoices, payments) | none — better than audit framed |
| Q11.9 profit_share_records schema | uses post-F-32 names (`distributable_profit_usd/kes`); no `distributable_amount/period_month/director_name` drift | none |
| Q11.10 project_profitability internal math (n=6) | every row's USD × 129.5 = KES exactly; Aifi/Kemtai/SEEO/Windward populated; Clickworker/Signafide all-zero (no 2026-04 budget activity, expected) | none |

**Q11.5 detail (F-32.1 deferred).** `forex_rates` exists as a table but contains zero rows. The currency-sync triggers installed in 00028 read `system_settings.standard_exchange_rate` (live single rate) rather than a per-month historical rate from `forex_rates`. For the current dataset — recent records, KES/USD rate stable around 129 — this is fine and produces internally-consistent numbers (confirmed by Q11.10's exact-math check). Multi-month historical reconstruction across periods of significant FX movement would lose accuracy. Not blocking; logged as **F-32.1** (forex_rates backfill + trigger plumbing to prefer per-month historical rate when available, falling back to `system_settings.standard_exchange_rate`). Out of scope for tonight.

**Q11.8 detail (audit framing was conservative).** Audit 2 framed F-32 as primarily an `expenses`-table problem with currency-sync needed there. The live trigger inventory shows 00028 landed `tr_currency_sync_*` on all five financial-amount tables: `budget_versions`, `budget_items`, `expenses`, `invoices`, and `payments`. The fix that shipped is meaningfully broader than the audit's recommendation; that breadth is what enables Q11.2 / Q11.3 / Q11.7 / Q11.10 to come back clean. The earlier R-8 closure in this session (00044, `validate_expense_budget` restored) is unrelated to currency sync but was confirmed via Q-9 in the parallel Audit 3 verification pass.

**Q11.9 detail.** Audit 2 §3 / §6 had flagged `profit_share_records` columns by their pre-F-32 legacy names (`distributable_amount`, `period_month`, `director_name`). Live schema uses the post-F-32 paired-currency names (`distributable_profit_usd` / `distributable_profit_kes`) and the standard `year_month` / `director_id` foreign-key shape. The schema-drift concern in that part of the audit is resolved; the column references in the audit doc itself are stale relative to current production but not corrected here (would require an in-place text refresh of multiple §3/§6 paragraphs and is out of scope for verification closure).

---

*End of audit. Save unstaged at repo root, same pattern as AUDIT_1_CORRECTNESS.md. No source files modified, no migrations created.*
