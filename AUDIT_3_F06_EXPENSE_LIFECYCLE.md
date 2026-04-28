# AUDIT_3 — F-06 Expense Lifecycle Atomicity Audit

Read-only diagnosis. Authored 2026-04-26 (Phase 1, follow-up to AUDIT_1 F-06 / F-12 / F-13). No source files or migrations were modified.

**Verification status (2026-04-28):** §14 verification queries executed against production. 9 of 10 returned clean / expected. Q-9 surfaced a missing `validate_expense_budget` trigger on `public.expenses` — confirmed as the deferred R-8 from `00029:54`, not a regression. R-8 closed via `supabase/migrations/00044_f08_r8_restore_validate_expense_budget_trigger.sql` (INSERT-only scope; the new `version_number = b.current_version` filter accommodates F-07 budget version history). See §14 "Verification Findings" below.

---

## 1. Background

### F-06 in one paragraph (from AUDIT_1)

The expense lifecycle (`pending_auth` → `under_review` → `modified` → `confirmed` → `voided` / `carried_forward`) is implemented as a chain of separate `supabase.from(...).insert/update(...)` calls in `/api/expense-lifecycle/route.ts`. There is no transaction wrapper, no advisory lock, no row-level lock, and no idempotency key. The two state transitions that materialize a real `expenses` row (confirm, modify) are two-step writes: `INSERT INTO expenses` followed by `UPDATE pending_expenses SET status, expense_id`. Either step can fail in isolation. The void transition is a one-step write that does NOT cascade to the linked `expenses` row (F-13).

### Related findings
- **F-12**: same root pattern (multi-write API flows have no transaction boundaries) — F-06 is the worst exemplar.
- **F-13**: void doesn't cascade — the linked `expenses` row keeps contributing to aggregates after the pending row is "voided".

### Schema facts (from `00007_expense_lifecycle.sql`)

`pending_expenses` carries:
- `status TEXT NOT NULL DEFAULT 'pending_auth' CHECK (status IN ('pending_auth','confirmed','under_review','modified','voided','carried_forward'))`
- `expense_id UUID REFERENCES expenses(id)` — nullable, intended to point at the materialized expense row when `status='confirmed'`
- `budget_id`, `budget_version_id`, `budget_item_id` — required, FK to budget data
- `actual_amount_kes` (nullable until confirm) and `budgeted_amount_kes` (set at populate)
- `variance_kes` and `variance_pct` are GENERATED columns (computed at row-write)
- audit columns: `confirmed_by/at`, `voided_by/at`, `reviewed_by/at`, `modified_reason`, `void_reason`, `carry_reason`, `review_notes`

`expenses.lifecycle_status TEXT` (not in any visible migration — see §11) is the column every aggregate filters on. Its valid values are `'pending'`, `'confirmed'`, `'modified'`, `'voided'` per the F-26 lifecycle filter migrations (00024, 00025, 00026, 00027, 00028) — but no migration defines it, so the column was added live via the Supabase dashboard. **Drift hazard.**

### Live-data evidence (recommended SQL in §14)

We don't yet have live counts. The §14 verification queries return:
- count of pending_expenses by status
- count of expenses without a parent pending_expenses row
- count of expenses whose `lifecycle_status` is not `'confirmed'` (potential silent contributors to aggregates)
- count of pending_expenses rows whose `expense_id` is non-null but the referenced `expenses` row no longer exists
- count of "voided" pending rows whose linked expenses still exist (the F-13 footprint)

These should be run via Claude in Chrome before Phase 2 to size the cleanup scope.

---

## 2. Methodology

1. Re-read F-06 / F-12 / F-13 entries in `AUDIT_1_CORRECTNESS.md`.
2. Read `supabase/migrations/00007_expense_lifecycle.sql` end-to-end (the schema definition).
3. Read `src/app/api/expense-lifecycle/route.ts` in full (944 lines, 1 GET + 10 POST handlers + 2 helpers).
4. Read `src/lib/expense-lifecycle.ts` (autoPopulateExpenses helper, 195 lines).
5. Read `src/app/api/expense-lifecycle/rollover-cron/route.ts` (60 lines).
6. Read `/api/expenses/delete/route.ts`, `/api/budgets/delete/route.ts`, `/api/budgets/cfo-revert/route.ts` for cross-table delete cascades.
7. Read every UI consumer found via grep:

   ```
   grep -rln 'pending_expenses\|lifecycle_status' src/ supabase/
   ```

   Returned 22 distinct files in `src/`, plus 5 migrations.
8. Cross-referenced with §3.4 of AUDIT_2 for shape.

Total time: ~75 minutes of focused reading.

---

## 3. Lifecycle State Machine

### 3.1 Authoritative status set (DB CHECK constraint, `00007:28-36`)

```
pending_expenses.status ∈ {
  pending_auth   -- default at populate
  under_review   -- flagged for further inspection
  modified       -- (declared but never set by any API handler — see §3.4)
  confirmed      -- materialized expense row exists; expense_id set
  voided         -- (does NOT cascade — F-13)
  carried_forward -- pending row supersededby a new pending row in the next month
}
```

`expenses.lifecycle_status` is unconstrained-by-CHECK (no migration defines the column at all — drift). In practice the values used in the codebase are `'confirmed'` (filtered by every aggregate) and implicitly `'pending'` for any row not filtered out. Voided expenses do not exist as separate rows because void doesn't touch the `expenses` table (F-13).

### 3.2 Valid transitions (per `route.ts` guards)

```
                                                    ┌─────────────┐
                                                    │     ▼       │
populate ──► pending_auth ─┬─► under_review ──► confirmed ◄──┐
                           │       │                        │
                           ├──────► modify ─────► confirmed │
                           │   (sets='confirmed' )           │
                           │                                 │
                           └──► void  ─► voided              │
                                                              │
populate ──► pending_auth ──► carry_forward                  │
                              │                              │
                              │  Marks original 'carried_forward'
                              │  Creates NEW pending_auth row in target month
                              ▼
                          carried_forward (source)

                           [also valid input to confirm: 'modified']
                                       ↑
                                       └── but no API handler writes 'modified'
                                           → unreachable through the API
```

Status guards (verbatim from code):
- `confirm` accepts: `['pending_auth', 'under_review', 'modified']` (route.ts:227)
- `modify` accepts: `['pending_auth', 'under_review']` (route.ts:338)
- `under_review` accepts: any (route.ts:412 — no guard at all; will overwrite confirmed/voided rows!)
- `void` accepts: any (route.ts:461 — no guard either; will overwrite confirmed rows!)
- `carry_forward` accepts: any (route.ts:512 — no guard)
- `bulk_confirm`'s loop applies the same `confirm` guard per item

**Finding 3-A (new — not in F-06).** `under_review`, `void`, `carry_forward` lack status guards. A confirmed expense (with materialized `expenses` row) can be retroactively voided / re-flagged / carried-forward via a direct API call, leaving the expense row untouched but the pending row now showing inconsistent status. Combine with F-13 and the orphan inflates aggregates indefinitely.

### 3.3 What happens after a state change

- **confirm**: a new `expenses` row is INSERTed; pending row is updated `status='confirmed'`, `expense_id=newexpense.id`. Pending row stays around as audit history.
- **modify**: a new `expenses` row is INSERTed (NOT an UPDATE of any prior expense); pending row is updated `status='confirmed'`, `actual_amount_kes`, `modified_reason`, `expense_id=newexpense.id`. **End state of modify is `confirmed`, not `modified`.**
- **under_review**: pending row is updated; no expense row touched. Reversibility: yes (subsequent confirm or modify is allowed by guard).
- **void**: pending row is updated `status='voided'`, `void_reason`, `voided_at`. **No touch to `expenses` table** (F-13).
- **carry_forward**: original pending row is updated `status='carried_forward'`, `carry_reason`. A NEW pending row is INSERTed in the target month with `status='pending_auth'`, `carry_from_month=oldmonth`, fresh `expense_id=null`. Source row stays around.
- **bulk_confirm**: loop of `confirm` per item; each iteration is independent (no shared transaction).
- **recompute_variances**: pure aggregation query, recomputes `expense_variances` (UPSERT) and inserts new `red_flags` rows. Does not touch pending_expenses or expenses.

### 3.4 The "modified" status anomaly

DB CHECK allows `'modified'`. UI consumers (queue page, TL panel, expense-queue-panel) handle it as a distinct visual state with badge color and label. `recompute_variances` counts `g.modified++` separately. **But no API handler ever sets `status='modified'`.** Greppable confirmation:

```
$ grep -rn "status.*'modified'" src/app/api/
src/app/api/expense-lifecycle/route.ts:400:      new_values: { status: 'confirmed', ... } // audit log new_values, NOT a write to pending_expenses
```

The only write to `status='modified'` is in an audit log payload, not an actual table update. So the value is reachable today only via:
- Manual SQL/dashboard edit
- Future feature
- Past code paths that have been removed

**Finding 3-B.** `'modified'` is dead-but-not-orphaned in the API. UI surfaces filter and display it. RPC design needs to either (a) keep the value reachable and define when it fires, or (b) drop the value from CHECK and remove the UI handling.

### 3.5 Pending → Expenses cardinality

In nominal flow: 1 pending → 0..1 expense (the `expense_id` FK on pending_expenses).

In failure / retry flows: 1 pending → 1..N expenses. Examples:
- partial-failure of confirm-then-update: insert succeeds, update fails, user retries → exp2 created, exp1 orphan
- modify after confirm via delete-expense → resets PE to `pending_auth`, but the original expense was deleted, so no orphan in this specific path
- bulk_confirm with mid-batch failure: some items get expense+pendingupdate, others get expense+no-pending-update (orphans)

Cardinality is **not** enforced by any constraint. There is no UNIQUE on `pending_expenses.expense_id`, and no UNIQUE on `expenses` for any "originating pending" key.

---

## 4. Code Walkthrough — `/api/expense-lifecycle/route.ts`

The file is 944 lines. 10 POST actions plus a GET. For each action below: HTTP method, what it reads/writes, whether it's wrapped in a transaction (none are), and the specific partial-failure scenarios.

### 4.1 GET (listing)
**Method:** GET. **Reads:** `pending_expenses` filtered by query params. **Writes:** none. **Atomicity:** N/A. **Partial-failure scenarios:** none.

### 4.2 POST `auto_populate` (route.ts:113-150)

**Reads:** `budget_versions(*, budget_items(*))`, `budgets`, `month_closures` (via `assertMonthOpen`), `user_project_assignments`, `pending_expenses (existing)`.
**Writes:** `pending_expenses` (batch INSERT of all eligible budget items as `pending_auth`), `misc_draws` (auto-log misc lines), `audit_logs`, `notifications` (via `notifyRole` x2).
**Transaction:** none. The INSERTs into `pending_expenses` and `misc_draws` are separate calls; `audit_logs` and `notifications` are separate.

**Partial-failure scenarios:**
1. `pending_expenses` batch INSERT succeeds, then `autoLogBudgetMiscDraws` throws inside `try/catch` (the catch swallows it with `console.error` only — line 191 in `expense-lifecycle.ts`). End state: pending rows exist, misc draws missing. Fine for downstream — misc_draws is independently reconcilable. **Severity: Low.**
2. `pending_expenses` INSERT succeeds, audit_log INSERT fails (e.g. RLS or DB hiccup). End state: pending rows exist, no audit log. **Severity: Medium** (audit gap).
3. Audit log INSERT succeeds, notifyRole INSERT fails for some users. End state: some users notified, some not. **Severity: Low** (cosmetic).
4. autoPopulateExpenses returns `success: false` mid-loop in `backfill` action — partial budgets get populated, others don't. **Severity: Medium** (but `backfill` is CFO-only and idempotent; re-running fixes it).

### 4.3 POST `backfill` / `backfill_approved` (route.ts:155-199)

**Reads:** all approved `budget_versions` + their items. **Writes:** loops `autoPopulateExpenses` per version. Audit log at the end.
**Transaction:** none — but each `autoPopulateExpenses` call is itself non-atomic (above). The outer loop just keeps going on failure (it doesn't even check `populate.success`'s error path; line 188 only counts on success).

**Partial-failure scenarios:**
1. Mid-loop crash: some budgets populated, others not. Audit log records the partial count. **Severity: Low** (idempotent re-run).
2. The same orphan-misc-draws and notification scenarios as `auto_populate`, multiplied by budget count.

### 4.4 POST `confirm` (route.ts:204-311) — the canonical F-06 path

Step-by-step trace:

```
[1] SELECT pending_expenses WHERE id = $id                       (read)
[2] assertMonthOpen($pending.year_month)                         (read month_closures)
[3] guard: pending.status IN ('pending_auth','under_review','modified')
[4] SELECT expense_categories WHERE name = $pending.category    (read)  ← may be 0 rows
[5] SELECT overhead_categories WHERE name = $pending.category   (read; only for shared)
[6] INSERT INTO expenses (... amount_kes, notes='Confirmed from pending expense $id') ← STEP A
[7] UPDATE pending_expenses SET status='confirmed', expense_id=$expense.id, ...  ← STEP B
[8] checkVarianceRedFlag → may INSERT red_flags
[9] INSERT audit_logs
[10] notifyRole('cfo', ...)                                      (loop INSERT notifications)
[11] recomputeExpenseVariancesForMonth → loop UPSERT expense_variances
```

**Transaction:** none.

**Partial-failure scenarios (severity-ordered):**

1. **Step A succeeds, Step B fails (network blip, RLS edge, DB timeout).** End state: an `expenses` row exists with `notes='Confirmed from pending expense $id'`, but `pending_expenses` still shows `status='pending_auth'` with `expense_id=NULL`. The user retries confirm. New `expenses` row inserted. Step B succeeds. End: TWO expenses rows for the same pending row, only the second one is linked. The first is an **invisible orphan** that contributes to every `SUM(amount_kes)` aggregate (P&L, /financials, lagged view, profit-share live branch, snapshots, fn_calculate_project_profitability, etc.). **Severity: Critical.** This is the F-06 headline scenario. Detection: the orphan's `notes` column references a pending_id that has its own different `expense_id` — it's locatable via SQL but not visible in the UI.

2. **Step A succeeds, then a concurrent confirm on the same pending (race).** Two simultaneous confirms: T1 reads pending, T2 reads pending (same status='pending_auth'); both INSERT `expenses`; both UPDATE pending. End: TWO expenses rows, only the second update's `expense_id` survives. **Severity: Critical** (same orphan footprint as the partial-failure case).

3. **Step A succeeds, Step B succeeds, then `audit_logs` INSERT fails.** End state: state mutation is correct, audit trail missing. **Severity: Medium.**

4. **Step A succeeds, Step B succeeds, audit succeeds, then `notifyRole` partially fails.** End state: data correct, notifications inconsistent. **Severity: Low.**

5. **`recomputeExpenseVariancesForMonth` fails (line 308).** End state: data correct, `expense_variances` aggregate stale. Recomputable on demand. **Severity: Low.**

6. **`fn_validate_expense_budget` trigger fires on Step A (the budget version is no longer `approved`, e.g. CFO reverted it between populate and confirm).** Step A throws. Step B never fires. End state: no orphan, but the user sees "Expenses can only be linked to APPROVED budget versions" — error message confusing because the user thought the budget was approved when they opened the queue. **Severity: Low** (no data corruption, just UX).

### 4.5 POST `modify` (route.ts:316-407)

Step-by-step trace:

```
[1] SELECT pending_expenses                                       (read)
[2] assertMonthOpen                                               (read)
[3] guard: pending.status IN ('pending_auth','under_review')
[4] SELECT expense_categories                                     (read)
[5] SELECT overhead_categories                                    (read; only for shared)
[6] INSERT INTO expenses (... amount_kes=actual_amount_kes,       ← STEP A
        notes='Modified & confirmed from pending expense $id. Reason: $reason')
[7] UPDATE pending_expenses SET status='confirmed' (NOT 'modified')
        actual_amount_kes, modified_reason, expense_id=$exp.id   ← STEP B
[8] checkVarianceRedFlag
[9] INSERT audit_logs (with audit-log-text status='confirmed' BUT modified_reason captured)
[10] notifyRole('cfo')
[11] recomputeExpenseVariancesForMonth
```

**Transaction:** none. **Same five partial-failure scenarios as confirm.**

**Specific to modify:**
- The handler ends with `status='confirmed'`, NOT `'modified'`. The `modified_reason` is captured but the *status* is collapsed. Confusing for any consumer that filters `status='modified'` (none in API code, but UI state machines may behave unexpectedly).
- The handler does NOT check `pending.expense_id IS NULL`. If a confirmed PE were ever returned to `pending_auth` without deleting its expense (no API path does this; only DB-direct), modify would create a duplicate.

**Finding 4-A.** `modify`'s expense row is INSERTed with the same shape as `confirm`'s — the only difference is the `notes` text and the `modified_reason` field on `pending_expenses`. There is no way after the fact to tell from the `expenses` table alone whether a row was confirmed-clean or confirmed-via-modify. The audit trail is ad-hoc.

### 4.6 POST `under_review` (route.ts:412-456)

Step-by-step trace:

```
[1] SELECT pending_expenses
[2] assertMonthOpen
[3] (no status guard)
[4] UPDATE pending_expenses SET status='under_review', review_notes, reviewed_by/at  ← single write
[5] INSERT audit_logs
[6] notifyRole('accountant')
[7] recomputeExpenseVariancesForMonth
```

**Transaction:** none. Single write, so no INSERT/UPDATE atomicity issue — but downstream side effects (audit, notify, recompute) can fail independently. **Severity of partial failures: Low to Medium.**

**Finding 4-B (already noted in 3.2).** No status guard. Calling `under_review` on a `confirmed` row is allowed. The pending row's status flips to `under_review`, but the linked `expenses` row still exists. End state: pending shows `under_review`, there's an actual `expenses` row contributing to aggregates, and `expense_id` on PE is still set. The UI's queue page would show this as a "Review" badge with no path back to confirmed (the queue page only shows "Confirm" and "Void" buttons for under_review, lines 700-725). The expense row keeps inflating aggregates. **Severity: High** (silent data inconsistency reachable through the UI).

### 4.7 POST `void` (route.ts:461-507) — the F-13 path

Step-by-step trace:

```
[1] SELECT pending_expenses
[2] assertMonthOpen
[3] (no status guard)
[4] UPDATE pending_expenses SET status='voided', void_reason, voided_by/at  ← single write
[5] INSERT audit_logs
[6] notifyRole('accountant')
[7] recomputeExpenseVariancesForMonth
```

**Transaction:** none. **No cascade to `expenses` even when `pending.expense_id IS NOT NULL`.**

**Partial-failure scenarios:**
1. **Void on a confirmed PE.** End state: PE.status='voided', PE.expense_id still points at the live `expenses` row, `expenses.lifecycle_status` still `'confirmed'` (no app path updates it). The expense row continues to contribute to every aggregate. **Severity: Critical.** This is F-13.
2. **Void on a pending_auth PE.** No expense_id, so nothing to cascade. Clean. **Severity: None.**
3. **Audit/notify/recompute downstream failures:** Severity: Low to Medium.

**Finding 4-C.** F-13's worst manifestation: a CFO clicks "void" with a strong reason, the UI shows the pending row as voided (red badge), the user moves on — but the expense is silently still there. The CFO has no signal that the void was incomplete.

### 4.8 POST `carry_forward` (route.ts:512-580)

Step-by-step trace:

```
[1] SELECT pending_expenses
[2] assertMonthOpen (source month)
[3] guard: target_month > pending.year_month
[4] UPDATE pending_expenses (source) SET status='carried_forward', carry_reason  ← STEP A
[5] INSERT pending_expenses (target month, status='pending_auth', carry_from_month=source) ← STEP B
[6] INSERT audit_logs
[7] notifyRole('cfo')
[8] recomputeExpenseVariancesForMonth (source)
```

**Transaction:** none.

**Partial-failure scenarios:**
1. **Step A succeeds, Step B fails.** End state: source row marked `carried_forward`, no target row exists. The cron (rollover-cron) will eventually pick it up next month-boundary and create the target row — but the original carry_forward call returns 500. Until cron fires, the carry is one-sided. **Severity: Medium.**
2. **No `assertMonthOpen` on the target month.** A user could carry forward INTO a closed month. The target row INSERTs successfully with `pending_auth` status. Closed-month invariant broken. **Severity: High** (silent boundary violation).
3. **carry_forward on an already-confirmed PE** — guard is missing (line 512). The source PE flips to `carried_forward`, but its `expense_id` still points at the materialized expense. End state: the actual expense exists in the source month AND a fresh pending exists in the target month → double-counting if the target gets confirmed too. **Severity: High.**

### 4.9 POST `bulk_confirm` (route.ts:585-698)

Step-by-step trace:

```
For each item in body.items[]:
  [1] SELECT pending_expenses
  [2] guard: pending.status IN ('pending_auth','under_review','modified')
  [3] assertMonthOpen
  [4] SELECT expense_categories
  [5] SELECT overhead_categories
  [6] INSERT INTO expenses                                      ← STEP A
  [7] UPDATE pending_expenses status='confirmed', expense_id ← STEP B
  [8] checkVarianceRedFlag
  [9] INSERT audit_logs (per item)
End: notifyRole('cfo') x1, recomputeExpenseVariancesForMonth x1
```

**Transaction:** none — neither between items nor within an item. Each item independently has the same A+B partial-failure surface as `confirm`.

**Partial-failure scenarios:**
1. **Item k's STEP A succeeds, STEP B fails.** Items 1..k-1 are fine; item k has an orphan expense; items k+1..N continue processing. Final response includes `errors[]` with item k's error message. The orphan persists. **Severity: Critical** (multiplied — easy to miss in a 30-item batch).
2. **Concurrent calls** — same race as confirm, multiplied by item count.
3. **Mid-loop process termination (Vercel timeout, OOM).** Items 1..k done, items k+1..N never processed. No error response. Some pending rows confirmed, others still pending. **Severity: Medium.**

**Finding 4-D.** `bulk_confirm` is the highest-volume orphan generator in the system because it's the path the queue page's "Confirm All Selected" button hits.

### 4.10 POST `recompute_variances` (route.ts:703-844)

**Reads:** `pending_expenses` for the month, system_settings (threshold).
**Writes:** UPSERT `expense_variances`, INSERT `red_flags`, INSERT `audit_logs`, INSERT `notifications`.
**Transaction:** none. Each `expense_variances` UPSERT is a separate call (the loop at line 791-820 does SELECT-then-INSERT-or-UPDATE for each group — three round trips per group).

**Partial-failure scenarios:**
1. Some groups upserted, others not. End state: partial recompute. Re-runnable, idempotent. **Severity: Low.**
2. SELECT-then-INSERT race with another concurrent recompute. Two INSERTs with the same key violate the unique constraint `idx_expense_variances_unique` (00007:88-89). Both fail. **Severity: Low** (but visible 500 to user).

### 4.11 GET `/api/expense-lifecycle/rollover-cron`

Cron loop. Reads `pending_expenses (status='carried_forward', year_month=previous)`. For each, checks for an existing target row, INSERTs a fresh `pending_auth` row in the current month if not. **Transaction:** none. **Idempotent** (the existence check at line 30-35 protects against re-runs). **Severity: Low.**

### 4.12 Summary table — partial-failure surface area

| Action | DB writes | Transaction? | Worst-case severity |
|---|---|---|---|
| auto_populate | `pending_expenses` (batch) + misc_draws + audit + notifications | No | Low |
| backfill / backfill_approved | loops auto_populate | No | Low |
| **confirm** | **expenses + pending_expenses + audit + notifications + variances** | **No** | **Critical (orphan)** |
| **modify** | **expenses + pending_expenses + audit + notifications + variances** | **No** | **Critical (orphan)** |
| under_review | pending_expenses + audit + notifications + variances | No | High (silent inconsistency on already-confirmed PEs) |
| **void** | **pending_expenses + audit + notifications + variances** (NOT expenses) | **No** | **Critical (F-13 cascade)** |
| **carry_forward** | **pending_expenses (source) + pending_expenses (target) + audit + notifications + variances** | **No** | **High** |
| **bulk_confirm** | **expenses × N + pending_expenses × N + audit × N + notifications + variances** | **No (per-item)** | **Critical (multiplied)** |
| recompute_variances | expense_variances upsert + red_flags + audit + notifications | No | Low |
| rollover-cron | pending_expenses INSERT (per row) | No | Low |

**6 actions are non-atomic and have Critical or High partial-failure outcomes.**

---

## 5. Data Reads — Who Depends on Lifecycle State?

22 distinct files read `pending_expenses` or `expenses.lifecycle_status`. Grouped by what they assume.

### 5.1 Aggregators that filter `expenses.lifecycle_status='confirmed'`

Every consumer in this category will silently mis-aggregate if F-13 / F-06 produce orphans (because orphan expense rows have `lifecycle_status='confirmed'` since the confirm INSERT writes whatever default the DB has, which is presumably 'confirmed' or whatever the column's default is).

| File:line | What it does | F-06 impact | F-13 impact |
|---|---|---|---|
| `src/app/api/project-financials/route.ts:80` | `expenses` filter for /financials | Orphan expense double-counts | Voided expense still counts |
| `src/app/(dashboard)/_components/cfo-dashboard.tsx:135` | confirmed expenses for current month | Same | Same |
| `src/app/(dashboard)/profit-share/page.tsx:159` | live branch direct costs | Same | Same |
| `src/app/(dashboard)/reports/monthly/page.tsx:111-112` | proj+shared expenses | Same | Same |
| `src/app/(dashboard)/reports/pnl/page.tsx:135,137` | live-mode P&L | Same | Same |
| `src/app/(dashboard)/reports/profitability/page.tsx:68` | per-project profitability | Same | Same |
| `src/app/(dashboard)/reports/projects/page.tsx:87,88` | projects-overview | Same | Same |
| `src/app/(dashboard)/reports/trends/page.tsx:179,180` | 6-month trends | Same | Same |
| `src/hooks/use-monthly-pl-summary.ts:48,54` | Home company totals | Same | Same |
| `src/lib/queries/expenses.ts:13` | `getConfirmedExpensesByMonth` utility | Same | Same |
| `lagged_revenue_by_project_month` view (00024 + 00028) | every page reading lagged revenue | Same | Same |
| `variance_summary_by_project` view (00026) | /reports/budget-vs-actual | Same | Same |
| `fn_calculate_project_profitability` (00025) | closed-month profitability | Same | Same |
| `fn_calculate_overhead_allocations` (00025) | closed-month overhead allocation | Same | Same |
| `fn_generate_monthly_snapshot` (00025) | closed-month snapshot | Same | Same |
| `fn_generate_red_flags` (00025/00027) | overspending check | Same | Same |

**16 distinct aggregators** all assume that "lifecycle_status = 'confirmed'" means the expense is real. F-13 violates that. F-06 means there can be more than one "real" expense per pending.

### 5.2 Consumers reading `pending_expenses` directly

| File:line | What it filters / aggregates | Status assumption |
|---|---|---|
| `src/app/(dashboard)/expenses/queue/page.tsx:163-188` | full pending list with realtime subscription | All statuses, branches per status for buttons |
| `src/app/(dashboard)/expenses/variance/page.tsx:145-313` | variance computation per project/dept/category | All non-voided rows count toward actual; counts modified, voided, confirmed separately |
| `src/app/(dashboard)/budgets/page.tsx:194` | per-budget pending count for budgets list | All statuses |
| `src/app/api/budgets/delete/route.ts:54,94` | delete pending + count for audit | All statuses (cascade-deleted) |
| `src/app/api/budgets/cfo-revert/route.ts:115` | delete pending on CFO revert | All statuses (cascade-deleted) |
| `src/app/api/expenses/delete/route.ts:43-55` | reset PE link when expense deleted | Reset to `pending_auth` regardless of current status |
| `src/components/expenses/expense-queue-panel.tsx:57-83` | home queue panel summary | All statuses, computes by status |
| `src/components/expenses/tl-budget-vs-expenses-panel.tsx:58` | TL home variance panel | confirmed+modified count toward actuals; pending; voided |
| `src/lib/queries/expenses.ts:32` | `getPendingExpensesByMonth` utility | All statuses |
| `src/app/api/expense-lifecycle/route.ts` itself | many handlers + recompute | per-handler status guards |
| `src/app/api/expense-lifecycle/rollover-cron/route.ts` | only `carried_forward` rows | Status-specific |

### 5.3 Status-value coupling map

UI consumers reference these literal status strings:

```
'pending_auth'    → queue, variance page, panels, audit page filters, rollover insert, recompute
'confirmed'       → queue, panels, variance, recompute
'under_review'    → queue, panels, recompute
'modified'        → queue, panels, recompute, tl-panel (counted toward actuals!)
'voided'          → queue, panels, variance, recompute (excluded from actuals)
'carried_forward' → queue, panels, rollover-cron
```

**Finding 5-A.** `tl-budget-vs-expenses-panel.tsx:83` includes `'modified'` in the actuals total: `confirmed = items.filter(i => ['confirmed', 'modified'].includes(i.status))`. Combined with §3.4, this means the TL panel allocates a budget bucket for a status no API path produces — dead code in the API, dead UI affordance for it.

**Finding 5-B.** `expenses/variance/page.tsx:212` excludes `'confirmed'` and `'voided'` from `totalPending` — so `under_review` and `modified` (and `pending_auth`) are all counted as "pending". A confirmed PE that gets `under_review` slammed onto it (per Finding 4-B) would fall back into "totalPending" while its expense row continues contributing to actuals. UI shows pending + visible expense counts that don't tie out.

### 5.4 expenses.lifecycle_status — the missing migration

`expenses.lifecycle_status` is referenced in 5 migrations (00024, 00025, 00026, 00027, 00028) and ~10 src files, but **no migration declares the column**. Search:

```
grep -rE "ADD COLUMN.*lifecycle_status|lifecycle_status.*TEXT|lifecycle_status.*VARCHAR" supabase/
→ no matches
```

The column was added live via the Supabase dashboard. Per AGENTS.md ("Drift between migrations on disk and live production has been observed historically") this is a known pattern, but it's a verification debt: a fresh production rebuild would fail every aggregate that filters `lifecycle_status='confirmed'`.

**Finding 5-C.** Schema-tree-vs-live drift on `expenses.lifecycle_status`. **Severity: High** (latent — only manifests on a clean rebuild, but every aggregate touches it).

---

## 6. Budget Interaction Analysis

### 6.1 Does confirming an expense update budget aggregates?

**No direct write to `budget_versions` or `budget_items` from the lifecycle code.** Budget aggregates are read-only computed on the fly:
- `total_amount_kes` on `budget_versions` is set at budget create / line review and never adjusted by expense confirmation.
- `pm_approved_total` on `budgets` is set at PM line review.

The system relies on aggregating `expenses.amount_kes` per `(project_id, year_month)` and comparing to `budget_versions.total_amount_kes`. No double-bookkeeping. F-32's currency triggers are the only triggers that fire on `expenses` writes.

### 6.2 Does voiding cascade to the variance view?

**Yes, transitively.**
- `variance_summary_by_project` (post-F-27, migration 00026) sums `expenses.amount_kes WHERE lifecycle_status = 'confirmed'`.
- A voided pending whose expense_id row still has `lifecycle_status='confirmed'` (F-13) → counts in variance.
- `recompute_variances` (in the same route) reads `pending_expenses` and ignores voided correctly: the recompute does `if (item.status === 'voided') g.voided++; else if (item.status === 'modified') g.modified++; ... `, so voided's `actual_amount_kes` is included in the actual total (line 916: `g.actual += Number(item.actual_amount_kes || 0)` UNCONDITIONALLY before the status branch). **Finding 6-A**: `recomputeExpenseVariancesForMonth` adds voided rows' `actual_amount_kes` to the `actual_total_kes`. The aggregate is wrong.

### 6.3 What happens if a budget is closed/locked and an expense modify is attempted?

Each handler calls `assertMonthOpen(admin, pending.year_month)`. If the month is closed/locked, the handler returns 400 before any write. **Closed-month protection is consistent across confirm, modify, under_review, void, carry_forward.**

But there's a catch: `carry_forward` only checks the SOURCE month, not the TARGET month (Finding 4-C). And `bulk_confirm` checks per-item but doesn't fail the whole batch — the loop continues with `errors.push({ id, error: ... })` (route.ts:617-621).

### 6.4 What happens if a budget version is superseded?

Scenarios:
- Budget revoked via `/api/budgets/cfo-revert`: line 101 sets `expenses.budget_approval_revoked = true` for the budget's expenses, then **deletes all `pending_expenses` for that budget** (line 115). The expenses themselves are NOT deleted (they remain orphaned with the new flag). A red flag is created. The deletion of pending_expenses is a hard DELETE; any `expense_id` link from PE to expense is severed forever.
- Budget hard-deleted via `/api/budgets/delete`: refuses if any `expenses` row links to it (line 46-50). Pending rows are then hard-deleted (line 94). So there's a guard. But pending rows in `confirmed` status with `expense_id` are still inside this delete sweep — meaning the audit trail of "this PE was confirmed, here's the expense_id" is lost on delete.

**Finding 6-B.** `/api/budgets/cfo-revert` deletes `pending_expenses` rows but leaves `expenses` rows behind (with a `budget_approval_revoked` boolean and a red flag). The deleted PE's `expense_id` link is gone forever. If anyone later wants to know "which pending led to this expense," the link is unrecoverable. The notes column ("Confirmed from pending expense $id") survives, but the PE row is gone.

### 6.5 Interaction with `variance_summary_by_project` (post-F-27 view)

The view (00026:75-107) is keyed off `expenses` directly, filtering `lifecycle_status='confirmed'`. It does NOT read `pending_expenses` at all. So:
- Orphan expense from F-06 → counted twice (once for the orphan, once for the linked).
- Voided expense from F-13 → still counted (lifecycle_status remains 'confirmed').
- Carried-forward source PE that was already confirmed (Finding 4-C) → counted.

**The view is structurally correct given a clean lifecycle. F-06 and F-13 break the assumed invariant.**

---

## 7. Concurrency and Race Condition Analysis

The API runs in Next.js / Node serverless (Vercel). Each POST is its own invocation. Supabase via PostgREST: writes are auto-committed per call, no app-level locking. RLS policies allow all authenticated reads/writes (00007:96-98 — `USING (true) WITH CHECK (true)` on `pending_expenses`).

### 7.1 Race scenarios

| Scenario | Probability | Severity | Behavior today | RPC fixes? |
|---|---|---|---|---|
| **Two confirms on same PE simultaneously** (e.g. two CFOs in different tabs) | Possible (queue page is realtime; CFO + accountant could both click in <1s) | Critical (orphan) | Both pass guard, both INSERT expense, both UPDATE pending. Two expenses, only second `expense_id` survives. | YES — `SELECT ... FOR UPDATE` inside RPC serializes |
| **Confirm + concurrent `modify` on same PE** | Possible | Critical (orphan + reason mismatch) | Both pass guard; both INSERT expense; both UPDATE pending. Two expenses; second update wins. The "winner" is non-deterministic. | YES — same locking |
| **Confirm + concurrent `void` on same PE** | Edge (CFO voids same row CFO is confirming) | Critical (orphan + status confusion) | Confirm INSERTs expense. Void UPDATEs status='voided'. End: voided PE with confirmed expense. F-13 cascade. | YES |
| **Confirm + concurrent EOD report generation** | Edge | Low | EOD reads `expenses` independently; if it reads after Step A but before Step B, it sees the new expense before the PE knows about it. EOD count is consistent since it reads expenses, not pending. | N/A (EOD is read-only) |
| **bulk_confirm in two tabs simultaneously, overlapping selections** | Possible | Critical | Same as item 1, multiplied per overlapping item. | YES — RPC must process the batch atomically OR per-item with locking |
| **carry_forward + concurrent confirm on same PE** | Edge | High | Confirm INSERTs expense; carry_forward updates status='carried_forward' (there's no guard at line 512). End: confirmed expense exists, PE marked carried_forward, target-month PE created. Triple-state inconsistency. | YES |
| **Two simultaneous `recompute_variances` for same month** | Likely (race on dashboard refresh) | Low | The SELECT-INSERT-or-UPDATE pattern in lines 791-820 races; one INSERT may fail with unique violation. Some groups may end up missing if their UPSERT race lost. | YES — UPSERT-only or function-level lock |
| **Concurrent `auto_populate` on same budget version** | Edge (only CFO/accountant; would need two clicks) | Low | Both check existing items via `existingItemIds` (line 146-156), both find no overlap, both INSERT. Duplicate pending_expenses rows for the same budget_item_id. There's no UNIQUE constraint on `(budget_id, budget_item_id)`. | YES — RPC could enforce uniqueness |
| **rollover-cron + manual carry_forward on same source** | Edge | Low | Both check for existing target row at line 30-35. Race: both pass the check, both INSERT. Two target rows. | YES — UNIQUE constraint or RPC lock |

### 7.2 Database constraints that prevent (or fail to prevent) races

**Currently in place:**
- `expenses` UNIQUE: none on a "pending parent" key, so duplicates are not rejected.
- `pending_expenses` UNIQUE: none on `(budget_id, budget_item_id)` or `(budget_item_id, year_month)`. Duplicates allowed.
- `expense_variances` UNIQUE: `(year_month, project_id, department_id, category)` — prevents duplicate variance rows but causes UPSERT contention.

**Missing constraints that would matter:**
- `UNIQUE(pending_expenses.budget_item_id, year_month)` would prevent populate / backfill duplicates and rollover-cron duplicates.
- No `UNIQUE` on `expenses` for "originating pending" because `pending_expenses_id` doesn't exist as an FK on expenses (the link is one-way: pending → expense, not the reverse).

### 7.3 What an RPC architecture provides

Postgres functions run in a single transaction by default. `SELECT ... FOR UPDATE` inside the function row-locks the targeted `pending_expenses` row, serializing concurrent confirms. The INSERT-then-UPDATE pair becomes a single atomic unit. Failure of any step raises and rolls back the entire RPC — no orphans possible.

The remaining race-prone parts (notifications, audit_logs) can stay outside the RPC (or move inside if the user wants stricter atomicity for the audit trail). Per AGENTS.md the audit log already has its own DB trigger (`audit_*`) that fires on every INSERT/UPDATE/DELETE on the relevant tables — **so the application-level audit_logs INSERT in the route is double-bookkeeping with the trigger.** Worth flagging (see §13 Q-3).

---

## 8. Modify Semantics

### 8.1 What modify does today

Looking at route.ts:357-373:

```ts
const { data: expense, error: expErr } = await admin.from('expenses').insert({
  // ... full row, with notes='Modified & confirmed from pending expense $id. Reason: $reason'
  amount_kes: actual_amount_kes,
}).select().single();
// then UPDATE pending_expenses SET status='confirmed', expense_id=expense.id
```

**Modify = create a new `expenses` row, not update an existing one.** Even if the PE had a prior `expense_id` (which can't happen via API alone given the status guard, but could happen via DB-direct edit), the prior expense is NOT updated and NOT deleted. The new row replaces it on the PE pointer.

### 8.2 How is audit history preserved?

Three layers:
1. **`audit_logs` table** — manual INSERT in the route (line 394-401) records `old_values` and `new_values`. The `modified_reason` is captured.
2. **`fn_audit_log` trigger** (00004:9-23) — fires on every INSERT/UPDATE/DELETE on `pending_expenses` and `expenses`, writes a JSONB snapshot to `audit_logs`. So there's also an automatic record.
3. **`expenses.notes` column** — text trace ("Modified & confirmed from pending expense $id. Reason: $reason"). Free text, not queryable structurally.

**No version table.** Modify-then-modify-again would:
- First modify: creates exp1, PE.expense_id=exp1, status=confirmed.
- Second modify: rejected by status guard (line 338) — pending is `confirmed`, not in `['pending_auth','under_review']`.

So in normal flow, modify only fires once per PE. Modifying a confirmed PE is impossible via API.

To reverse a modification, the only path is:
1. Delete the expense (`/api/expenses/delete`) — resets PE to `pending_auth`, `expense_id=null`.
2. Re-confirm or re-modify the PE.

### 8.3 Implications for RPC design

- "Modify" semantically means "create the canonical expense row with a corrected amount and a reason." It's not an UPDATE in the OOP sense.
- An RPC `fn_expense_confirm(p_pending_id, p_actual, p_reason?)` could unify confirm and modify (modify is `confirm` with a `reason` argument). The `expenses.notes` can carry the reason; the audit log captures `old_values`.
- If the user wants modify to UPDATE an existing expense in-place (e.g. for legal/accounting reasons — same expense ID, amended amount), the RPC needs a different shape: `fn_expense_amend(p_expense_id, p_new_amount, p_reason)`. **This is a Q-1 in §13.**

### 8.4 UI surfaces that need pre-modify values

- `audit/page.tsx` displays `audit_logs.old_values` for modified expenses → requires the JSONB.
- `expenses/queue/page.tsx` and the panels show only the *current* pending row, no historical pre-modify amount.
- `expenses/variance/page.tsx` does the same — current actual_amount_kes only.
- No UI surface today shows "this expense was originally KES X, modified to KES Y at time T by user U with reason R." The data is in `audit_logs` (twice — once from the trigger, once from the manual INSERT) but no page renders it.

---

## 9. Void Semantics and the F-13 Cascade

### 9.1 What void does today (from §4.7)

`UPDATE pending_expenses SET status='voided', void_reason, voided_by, voided_at`. **No touch to `expenses`.** The linked expense row remains:
- in the `expenses` table
- with `lifecycle_status` = whatever it was (presumably `'confirmed'`)
- with `notes='Confirmed from pending expense $id'`

### 9.2 What downstream values are affected

Every aggregate from §5.1 includes the voided expense in its sum. Specifically:

| Surface | F-13 effect |
|---|---|
| `/financials` | Voided expense's KES amount inflates project costs |
| `/reports/pnl` (live mode) | Voided expense inflates `directCosts` and `sharedOverhead` |
| `/reports/pnl` (snapshot mode) | Already-closed months' snapshots include voided expenses (no recompute path) |
| `/reports/profitability` | Voided expense lowers profit |
| `/reports/projects` | Voided expense lowers profit |
| `/reports/trends` | Voided expense persists in 6-month trends |
| `/reports/monthly` | Voided expense in by-category breakdown |
| `/reports/budget-vs-actual` | `variance_summary_by_project` view includes voided expense |
| `cfo-dashboard` | Live-month total expenses inflated |
| `home-performance-strip` | Net profit understated |
| `profit-share` (live branch) | Direct costs inflated, distributable_profit lowered, director shares (70%) reduced |
| `profit-share` (record branch, post-closure) | Same baked into profit_share_records.distributable_profit_kes |
| `lagged_revenue_by_project_month` | `current_expenses_kes` inflated |
| `monthly_financial_snapshots` | Closed months include voided as cost |
| `project_profitability` | Same |
| `EOD Slack report` | The void itself doesn't appear; the still-existing expense was already reported when first confirmed |
| `red_flags` / `fn_generate_red_flags` | Overspend check uses `expenses.amount_usd` and counts voided as spend |

### 9.3 Are these recomputed automatically?

Most are computed at read time from `expenses` rows. So **F-13 is not "stale snapshot" — it's "wrong source data."** Recomputing post-fix won't help unless the underlying `expenses` row is deleted or its `lifecycle_status` flipped to `'voided'`.

`recomputeExpenseVariancesForMonth` reads `pending_expenses` (not `expenses`), so it correctly excludes voided rows from confirmed_count but incorrectly INCLUDES their `actual_amount_kes` in the total (Finding 6-A).

`monthly_financial_snapshots` and `project_profitability` are written by `fn_close_month`, which calls `fn_calculate_project_profitability` and `fn_generate_monthly_snapshot` — both read `expenses WHERE lifecycle_status='confirmed'`. So a closed month's snapshot is wrong if any voided PE's underlying expense remains.

### 9.4 What if the month has been closed at void time

`assertMonthOpen` blocks the void at the API level. The user can't void a closed month's PE. Good. But:
- If the void happened BEFORE close: the snapshot was generated WITH the orphan expense in the totals.
- If the user reopens the month, voids the PE, re-closes: the recompute (`fn_close_month` → cascade of fn_calculate_*) STILL uses the orphan expense because no path deletes/flips it.

**Finding 9-A.** Reopening a month and voiding does not fix prior month-close snapshots even after re-close, because the underlying `expenses` row is not touched.

### 9.5 RPC requirement

A `fn_expense_void(p_pending_id, p_reason)` RPC must:
1. Lock the PE row.
2. UPDATE `pending_expenses SET status='voided', ...`.
3. If `pending.expense_id IS NOT NULL`: choose between
   - **Hard delete** the `expenses` row.
   - **Soft delete** by flipping `expenses.lifecycle_status` to `'voided'` (requires the column to actually be writable as `'voided'` — needs verification that aggregates also exclude `'voided'`, currently they only filter `='confirmed'` so any non-confirmed value is excluded, including 'voided').
4. Single transaction.

Soft delete is preferred for audit-trail reasons (the expenses row stays for forensics) and because `audit_logs` will then carry the OLD/NEW snapshot of the lifecycle_status flip.

---

## 10. RPC Design Options

### Option A — Single mega-RPC per transition

Three functions: `fn_expense_confirm`, `fn_expense_modify`, `fn_expense_void`. Plus possibly `fn_expense_under_review` and `fn_expense_carry_forward`. Each:

- Takes the pending_id + the action's parameters.
- `SELECT ... FOR UPDATE` on `pending_expenses` (row lock).
- Re-checks status guard inside the lock (TOCTOU-safe).
- Re-checks `assertMonthOpen` equivalent inline.
- Looks up `expense_categories` / `overhead_categories` by name.
- Runs the INSERT into `expenses` (when applicable).
- Runs the UPDATE on `pending_expenses`.
- Optionally inserts a red_flag (variance check) and recomputes one row of `expense_variances`.
- Returns the updated `pending_expenses` row.

API route becomes a thin auth + parameter-validation wrapper that calls `admin.rpc('fn_expense_confirm', { ... })`.

**Pros:**
- Each RPC is atomic by default.
- Race-free via row lock.
- Idempotent if combined with an idempotency token (optional).
- Follows the same architecture as our F-32 fix (functions + triggers).
- Audit log via `fn_audit_log` trigger automatically captures the OLD/NEW snapshots — eliminates the manual `audit_logs.insert` in the route.
- Easy to test (one entry point per action).

**Cons:**
- Lifts business logic into Postgres. Future changes require migration.
- Notification and Slack side effects can't trivially live inside the RPC (they're async, third-party). Side effects stay in the route, fire AFTER the RPC succeeds.
- Multi-row operations like `bulk_confirm` need a wrapper RPC `fn_expense_bulk_confirm(p_items jsonb)` that loops internally.

**Risks:**
- Migration must include the lifecycle_status column definition (it's currently un-migrated — see Finding 5-C).
- `expense_categories` / `overhead_categories` lookups can fail (returning NULL) — the RPC needs to handle that exactly as the route does today.

**Effort:** 12–18 hours.
- 4–6h: write the 5 RPCs (confirm, modify, under_review, void, carry_forward) and bulk_confirm wrapper.
- 1h: write the migration that also formalizes `expenses.lifecycle_status` column (close Finding 5-C).
- 3–4h: rewrite the API route to be thin RPC callers.
- 2h: update all UI consumers to use the new route shape (probably no change — same `success: true, data: {...}` envelope).
- 2–3h: smoke tests + end-to-end verification on `/expenses/queue`.
- 1h: regenerate any closed-month snapshots if F-13 cleanup affects them (likely zero today per AUDIT_2 verification).

**Compatibility with existing data:** F-06 / F-13 footprint queries (§14) reveal current orphans; a one-time data-cleanup migration runs alongside the RPC migration to delete orphans / flip voided.

### Option B — Granular RPCs with composition

Smaller building blocks: `fn_create_expense_from_pending`, `fn_update_pending_status`, `fn_resolve_categories`. Composed in the API route with explicit `BEGIN` / `COMMIT` (Supabase's `.rpc()` doesn't expose explicit transaction boundaries — would require a wrapper RPC anyway, which collapses Option B back into Option A).

**Pros:**
- More flexible (e.g. "confirm without recomputing variances right away").
- Smaller individual functions, easier to review.

**Cons:**
- Postgres functions run in a single transaction by default; calling several in a row from PostgREST does NOT chain them into one transaction. To get atomicity across multiple RPCs, you need a wrapper RPC, which collapses to Option A. **Option B is a strictly worse Option A unless we adopt server-side composition (a stored procedure that calls procedures).**
- More moving pieces; more RLS/grants to manage.

**Risks:** higher than Option A.

**Effort:** 18–25 hours. **Not recommended.**

### Option C — Database trigger-based approach

Triggers on `pending_expenses` propagate to `expenses` automatically.

- BEFORE UPDATE on `pending_expenses` for status='confirmed' → INSERT INTO expenses with computed values.
- BEFORE UPDATE on `pending_expenses` for status='voided' → DELETE / flip the linked expense.
- BEFORE UPDATE on `pending_expenses` for status='carried_forward' → INSERT a copy in target month.

**Pros:**
- Application code becomes very thin: just `UPDATE pending_expenses SET status=... WHERE id=...`.
- Atomicity inherited from the implicit transaction.

**Cons:**
- Trigger semantics get tangled fast. Modifying a triggered status from within a trigger requires either RAISE EXCEPTION or careful ordering. Re-entrant triggers (a confirm fires expense INSERT → audit_logs INSERT → audit trigger) can cause hard-to-debug behavior.
- Reading required side parameters (modified_reason, void_reason, target_month for carry_forward) from the UPDATE payload is awkward — they're columns on `pending_expenses` that need to be SET in the same UPDATE. Doable but non-obvious.
- Discoverability: a developer reading the API code can't see what happens. The behavior is in the triggers. New devs would need a "where's the magic?" map.
- Bulk operations (bulk_confirm) trigger N times with N expense INSERTs. No batch optimization opportunity.
- Notification and Slack still have to live in the application route, which means we're back to non-atomic on those side effects anyway.

**Risks:**
- Triggers are hard to test atomically.
- Future schema changes (e.g. adding a column to expenses) need to also update the trigger.

**Effort:** 15–20 hours, plus higher debugging risk.

**Not recommended.** Triggers are great for purely-data invariants (like F-32 currency sync). They are an awkward fit for business workflow steps that involve named operations with parameters.

---

## 11. Failure Modes Already in Production

Without DB access I can't enumerate live rows. The §14 SQL probes the four most likely footprints:

1. Pending in `'confirmed'` status with `expense_id IS NULL` → the partial-failure orphan (STEP A failed before STEP B → user retried → caught by status guard)
2. Pending in `'voided'` status with `expense_id IS NOT NULL` AND the linked expense exists → the F-13 footprint
3. `expenses` rows whose `notes` matches "Confirmed from pending expense %" but whose UUID is NOT the `expense_id` of the referenced pending → the F-06 orphan
4. Multiple `expenses` rows with `notes` referencing the same pending_expense_id → multi-orphan

Until we run those, we can't size the cleanup migration. AUDIT_2's pattern was: "0 closed months, 0 manual corrections" — F-32's blast radius was uniform. F-06's may not be — modify and bulk_confirm have shipped for months and any partial failure or race in that time leaves a footprint.

---

## 12. Recommendation

**Option A — single RPC per transition, with the migration also formalizing `expenses.lifecycle_status` and a one-time orphan-cleanup CTE.**

One-line rationale: it's the smallest change that closes F-06 / F-12 / F-13 atomically and fits the architecture pattern we just landed for F-32. Triggers are wrong for workflow steps; granular composition collapses to Option A in practice.

Order of operations in the migration file (`00029_f06_expense_lifecycle_rpcs.sql`):

1. (Schema repair) `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (lifecycle_status IN ('pending','confirmed','voided'))` — formalizes the live drift. Default `'confirmed'` matches current behavior since the column was retrofitted.
2. (One-time cleanup, gated on §14 results) DELETE orphan expenses and/or flip voided-PE-linked expenses to `lifecycle_status='voided'`. Audit-logged via the existing trigger.
3. (RPCs) `fn_expense_confirm`, `fn_expense_modify` (could be unified — see Q-1), `fn_expense_under_review`, `fn_expense_void`, `fn_expense_carry_forward`, `fn_expense_bulk_confirm`.
4. (No new triggers — the existing `fn_audit_log` already covers audit history.)

The API route becomes a thin auth/validation/RPC-dispatch wrapper. Notification and `recompute_variances` calls stay outside the RPC (they're idempotent and re-runnable).

---

## 13. Open Questions for Njuguna

1. **Should `modify` create a new expenses row or UPDATE the existing one in-place?** (§8.3) Today it creates new. If we keep that, `fn_expense_modify` is essentially `fn_expense_confirm` with a reason. If we want in-place amend, the RPC shape changes — and we need to decide whether prior amounts go into a side history table or just into `audit_logs`.

2. **Should `void` delete the linked `expenses` row (hard) or flip its `lifecycle_status` to `'voided'` (soft)?** (§9.5) Soft is preferred for forensics; needs the schema repair above to land first.

3. **Drop the redundant `audit_logs.insert` calls from the route?** (§7.3) The `fn_audit_log` trigger already captures every INSERT/UPDATE/DELETE on `pending_expenses` and `expenses`. The application-level inserts are duplicate work. RPC migration is a clean opportunity to remove them and standardize on the trigger.

4. **Is the `'modified'` status on `pending_expenses` reachable through any UI / data-entry path I missed?** (§3.4) If no, drop it from the CHECK constraint and clean up the UI labels. If yes, document when it fires so the RPC handles it.

5. **Should `under_review`, `void`, `carry_forward` enforce a status guard?** (§3.2 Finding 3-A) Today any status can be voided. If we want to forbid voiding a `voided` row, voiding a `carried_forward` row, or under-review-ing a `confirmed` row, the RPC should add explicit checks.

6. **Should `bulk_confirm` be all-or-nothing, or best-effort with per-item errors?** Today it's best-effort. Atomic-batch is simpler to reason about; best-effort handles "30 items, 2 typos" gracefully. Either is implementable in an RPC.

7. **Does `carry_forward` need to assert the TARGET month is open?** (Finding 4-C) Strongly recommend yes, per the closed-month invariant.

8. **What's the policy on modifying expenses after a budget is closed/superseded?** Today's `fn_validate_expense_budget` trigger requires the budget version to be `approved`. If a budget is later reverted, the trigger doesn't retroactively block — it only fires on INSERT/UPDATE. Should the RPC re-validate at confirm time? (It already does, transitively.)

9. **Should the RPC return a structured error code (e.g. `'PE_NOT_FOUND'`, `'STATUS_GUARD_FAILED'`, `'MONTH_LOCKED'`) or raise an exception with a free-text message?** Structured codes are easier for the client to handle. RAISE EXCEPTION ... USING ERRCODE = 'P0001', DETAIL = '...' is the Postgres pattern.

10. **Should we add a UNIQUE on `pending_expenses(budget_item_id, year_month)`?** (§7.2) Would prevent duplicate populates and rollover-cron races. Slight cost: forces auto_populate to UPSERT or skip-on-conflict.

11. **F-13 fix: should we hard-delete the orphan `expenses` rows from the existing voided-PE chain, or leave them with `lifecycle_status='voided'` for audit?** Soft preferred. Either is a one-liner in the migration's cleanup CTE.

12. **Should `fn_validate_expense_budget` be relaxed to allow lifecycle_status='voided' inserts?** Today it requires `bv.status='approved'`. Soft-delete via UPDATE doesn't INSERT, so no impact — but worth flagging.

---

## 14. Verification SQL (read-only)

Run via Claude in Chrome. All read-only.

### Q-1: pending_expenses by status (size the lifecycle population)

```sql
SELECT status, COUNT(*) AS row_count
FROM pending_expenses
GROUP BY status
ORDER BY status;
```

### Q-2: confirmed PEs with NULL expense_id (the partial-failure footprint)

```sql
SELECT COUNT(*) AS confirmed_pe_with_null_expense_id
FROM pending_expenses
WHERE status = 'confirmed' AND expense_id IS NULL;
-- Expected for clean DB: 0
-- Anything > 0 = past confirm/modify partial-failure orphans
```

### Q-3: voided PEs with linked expense still alive (F-13 footprint)

```sql
SELECT pe.id AS pending_id,
       pe.year_month,
       pe.expense_id,
       e.amount_kes,
       e.lifecycle_status,
       e.notes
FROM pending_expenses pe
JOIN expenses e ON e.id = pe.expense_id
WHERE pe.status = 'voided'
  AND pe.expense_id IS NOT NULL
ORDER BY pe.year_month DESC;
-- Anything returned = a voided pending whose underlying expense is still inflating aggregates
```

### Q-4: F-06 orphans — expenses rows whose notes reference a pending whose own expense_id is different

```sql
SELECT e.id AS expense_id,
       e.year_month,
       e.amount_kes,
       e.notes,
       pe.id AS referenced_pending_id,
       pe.expense_id AS pending_currently_links_to
FROM expenses e
LEFT JOIN pending_expenses pe
  ON pe.id::text = substring(e.notes FROM 'pending expense ([0-9a-f-]+)')
WHERE e.notes ~ 'from pending expense [0-9a-f-]+'
  AND (pe.id IS NULL OR pe.expense_id IS DISTINCT FROM e.id)
ORDER BY e.year_month DESC, e.id;
-- Anything returned = an expenses row whose originating pending either no longer exists
-- or has been re-pointed to a different expense (the F-06 orphan)
```

### Q-5: Multi-orphan — same pending referenced by 2+ expense rows

```sql
SELECT pe_id, COUNT(*) AS expense_rows_referencing
FROM (
  SELECT substring(e.notes FROM 'pending expense ([0-9a-f-]+)') AS pe_id
  FROM expenses e
  WHERE e.notes ~ 'from pending expense [0-9a-f-]+'
) t
GROUP BY pe_id
HAVING COUNT(*) > 1
ORDER BY expense_rows_referencing DESC;
```

### Q-6: Confirm `expenses.lifecycle_status` exists and what values are present

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'expenses'
  AND column_name = 'lifecycle_status';

-- Then:
SELECT lifecycle_status, COUNT(*)
FROM expenses
GROUP BY lifecycle_status
ORDER BY lifecycle_status;
-- Confirms whether 'voided' is even a value present today, or only 'confirmed'
```

### Q-7: Carry-forward chains — sources marked carried_forward whose target row is missing (cron didn't run / failed)

```sql
SELECT src.id AS source_pe,
       src.year_month AS source_month,
       src.budget_item_id
FROM pending_expenses src
LEFT JOIN pending_expenses tgt
  ON tgt.budget_item_id = src.budget_item_id
 AND tgt.carry_from_month = src.year_month
WHERE src.status = 'carried_forward'
  AND tgt.id IS NULL;
-- Anything returned = a carry-forward that lost its target (Step B failed in §4.8)
```

### Q-8: Duplicate auto-populate footprint — multiple PEs for same (budget_item_id, year_month)

```sql
SELECT budget_item_id, year_month, COUNT(*) AS dup_count
FROM pending_expenses
GROUP BY budget_item_id, year_month
HAVING COUNT(*) > 1
ORDER BY dup_count DESC;
-- Expected for clean DB: 0 rows
```

### Q-9: Triggers currently on pending_expenses and expenses

```sql
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('pending_expenses','expenses')
ORDER BY event_object_table, trigger_name;
-- Expected: audit_*, set_updated_at_*, validate_expense_budget on expenses,
-- plus the F-32 currency triggers (tr_currency_sync_expenses).
-- Anything else = surprise.
```

### Q-10: How many rows would the RPC migration touch in cleanup

```sql
WITH orphans AS (
  SELECT e.id
  FROM expenses e
  LEFT JOIN pending_expenses pe
    ON pe.id::text = substring(e.notes FROM 'pending expense ([0-9a-f-]+)')
  WHERE e.notes ~ 'from pending expense [0-9a-f-]+'
    AND (pe.id IS NULL OR pe.expense_id IS DISTINCT FROM e.id)
), voided_with_expense AS (
  SELECT pe.expense_id AS id
  FROM pending_expenses pe
  WHERE pe.status = 'voided' AND pe.expense_id IS NOT NULL
)
SELECT 'orphans' AS category, COUNT(*) FROM orphans
UNION ALL
SELECT 'voided_with_live_expense', COUNT(*) FROM voided_with_expense;
```

### 14.1 Verification Findings (executed 2026-04-28)

| Query | Result | Action |
|---|---|---|
| Q-1 status counts | clean (expected distribution) | none |
| Q-2 confirmed PE w/ NULL expense_id | 0 | none |
| Q-3 voided PE w/ live expense (F-13) | clean | none |
| Q-4 F-06 orphans (notes-mismatch) | clean | none |
| Q-5 multi-orphan (1 pending → ≥2 expenses) | 0 | none |
| Q-6 lifecycle_status column + values | column present, expected values only | none |
| Q-7 broken carry-forward chains | 0 | none |
| Q-8 duplicate auto-populate | 0 | none |
| **Q-9 triggers on expenses / pending_expenses** | **`validate_expense_budget` MISSING from `expenses`** | **R-8 closure** |
| Q-10 RPC migration cleanup footprint | 0 in both buckets | none |

**Q-9 finding detail.** The `validate_expense_budget` BEFORE INSERT/UPDATE trigger originally installed in `00004_functions.sql:109` was not present in production at verification time. Investigation confirmed:

- No migration drops or alters the trigger (`grep DROP TRIGGER…validate_expense` across `supabase/migrations/` returned nothing).
- `00029_f06_expense_lifecycle_rpcs.sql:54` explicitly tags the re-installation as "R-8 deferred", indicating an intentional out-of-band drop ahead of F-07.
- The original trigger body validates only `bv.status = 'approved' AND bv.budget_id = NEW.budget_id` — under F-07's version-history model this becomes too permissive (silently accepts links to historical-but-once-approved versions).

**Closure.** `supabase/migrations/00044_f08_r8_restore_validate_expense_budget_trigger.sql` reinstalls the trigger with corrected logic:

- `bv.version_number = b.current_version` filter added (rejects stale-approved versions).
- Trigger fires on **INSERT only**. UPDATE is deliberately unguarded because F-07 flag-mutation flows (`budgets/cfo-revert/route.ts:120`, `00042_f07_budget_lifecycle_rpcs.sql:818` setting `budget_approval_revoked`) legitimately touch rows whose pinned `budget_version_id` is historical evidence by design — guarding UPDATE would self-block those flows.
- NULL allowance dropped: `expenses.budget_id` and `expenses.budget_version_id` are NOT NULL in schema (`00002_tables.sql:206-207`).
- Self-verify DO block at end of migration confirms trigger present and INSERT-only at apply time.

---

## 15. Implementation Risk Estimate

### 15.1 Hours of focused work

- **Phase 1 verification (Claude in Chrome)**: 30 min — Q-1 through Q-10 above.
- **Phase 2 migration writing**: 8–12 h.
  - 1 h: lifecycle_status column ALTER + CHECK constraint
  - 1 h: cleanup CTE for orphans + voided cascade (sized by Q-4, Q-5, Q-3)
  - 4 h: 5 RPCs (confirm/modify can be unified per Q-1)
  - 1 h: bulk_confirm wrapper RPC
  - 1 h: smoke tests in transactional sandbox
- **Phase 3 route rewrite**: 3–4 h. Each handler becomes ~15 lines (auth, validate, RPC call, side-effect dispatch).
- **Phase 4 verification**: 2–3 h. Smoke tests on `/expenses/queue` (confirm, modify, void, carry-forward, bulk_confirm). Variance recompute. Audit log diff before/after.
- **Phase 5 build + commit + push**: 30 min.

**Total: 14–20 h. Largest single migration after F-32.**

### 15.2 Riskiest part of the change

**Three risks, ordered:**

1. **The cleanup CTE.** If Q-4 returns hundreds of rows, hard-deleting is a real data event. Soft-delete (lifecycle_status='voided') is reversible. The cleanup migration MUST log every row it touches via `audit_logs` so post-hoc reconciliation is possible. Recommend wrapping the cleanup in an explicit BEGIN/COMMIT inside the migration (Supabase dashboard apply IS one transaction by default, so this is mostly belt-and-suspenders).

2. **Concurrency tests in production.** The new RPCs serialize via `SELECT ... FOR UPDATE`. We have no end-to-end test harness today that verifies "two concurrent confirms produce one expense, not two." The smoke test at minimum should script two parallel `psql` calls hitting the same PE. **This needs to be a manual production smoke after deploy.**

3. **The `'modified'` status decision (Q-4 of §13).** If we drop it from CHECK and a row exists with that status (per Q-1), the migration fails. If we keep it, we need to define when it fires (or it stays as orphan-but-allowed code).

### 15.3 Parallel vs sequential

**Parallel-safe:**
- Drafting RPC SQL ↔ drafting cleanup CTE.
- Writing the route rewrite ↔ writing the migration.

**Sequential (must-be-ordered):**
1. Q-1..Q-10 verification → sizes the cleanup.
2. Cleanup migration applied → DB is in a known state.
3. RPC migration applied → atomic functions in place.
4. Route rewrite deployed → app uses the RPCs.
5. Smoke + concurrency tests in production.

Reverse order would expose users to inconsistent behavior. The route deploy should land AFTER the migration — Supabase dashboard apply is fast, and Vercel deploy is independent.

### 15.4 New tests / smoke tests

- **Unit-equivalent**: a transactional smoke for each RPC (BEGIN; INSERT a fake PE via raw SQL; CALL the RPC; SELECT the result; ROLLBACK).
- **Concurrency**: two parallel CALLs on the same PE — only one expense should land.
- **F-13 cleanup verification**: post-migration, every row from Q-3's pre-state should be either gone or have `lifecycle_status='voided'`.
- **Aggregate parity**: pre-migration vs post-migration sum of `expenses WHERE lifecycle_status='confirmed'` for each (project_id, year_month) — should differ by exactly the orphan + voided amounts.
- **End-to-end UI smoke**: confirm one PE, modify one PE, void one confirmed PE, carry-forward one PE. Verify each pending status, each expense (or absence), audit log delta.
- **`/profit-share` live branch**: should now read a smaller `direct_costs` if any voided expenses were cleaned up.

### 15.5 Comparison to F-32

F-32 was **5 tables, 3 trigger functions, 5 triggers, 6 backfill UPDATEs, 1 view rewrite — single file, ~330 lines**.

F-06 is bigger:
- 1 schema repair (lifecycle_status column)
- 1 cleanup CTE (sized by §14)
- 5–6 RPC functions (each 30–80 lines)
- Route rewrite (944 → ~300 lines)
- More moving pieces in the deploy: migration + code.

Estimated migration file size: **400–600 lines.** Comparable structural complexity to F-32 but more semantic surface (workflow, not just data sync). The F-32 audit + Phase 1 + Phase 2 took ~6 h of focused work this session; F-06 will be **roughly 2× that.**

---

*End of audit. Save unstaged at repo root, same pattern as AUDIT_1 / AUDIT_2. No source files modified, no migrations created.*
