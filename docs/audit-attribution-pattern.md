# Audit-log attribution pattern

This note explains how `audit_logs` rows pick up an actor in this codebase, and which path a new mutating route should follow. It exists because the obvious choice — letting the generic Postgres trigger handle it — silently drops the actor under our deployment model.

## The two paths

**Path A — trigger-driven.** Migration `supabase/migrations/00004_functions.sql:9-23` defines a generic `fn_audit_log()` function that fires `AFTER INSERT OR UPDATE OR DELETE` on a fixed set of tables (`budgets`, `budget_versions`, `budget_items`, `expenses`, `invoices`, `payments`, `withdrawals`, `month_closures`, `profit_share_records`, `agent_counts`, `projects`). The function reads `auth.uid()` to populate `audit_logs.user_id`, captures `to_jsonb(OLD)` / `to_jsonb(NEW)` for old and new values, and sets `action = TG_OP` ('INSERT' / 'UPDATE' / 'DELETE'). Any direct table write to one of these tables produces an audit row automatically.

**Path B — route-driven.** The route handler itself inserts into `audit_logs` after the primary mutation succeeds. The `user_id` comes from the authenticated user resolved by `getAuthUserProfile(request)` and the action label is whatever the route picks (we use SQL-style `'INSERT'` / `'UPDATE'` / `'DELETE'` to match Path A, but custom action strings like `'profit_share_recomputed'` are used too — see `src/app/api/profit-share/recompute/route.ts:106-124`). The route uses the `admin` (service-role) Supabase client for the insert and wraps it in `try/catch` so an audit failure can't break the user-facing request.

## Why Path A drops the actor

Every API route under `src/app/api/` runs server-side. Mutations go through the Supabase admin client (`getAuthUserProfile` returns `{ profile, user, admin }`; `admin` is the service-role-keyed client). Under a service-role JWT, `auth.uid()` evaluates to `NULL` inside the database — there is no end-user Postgres role context. The `fn_audit_log()` trigger therefore inserts `user_id = NULL` for every mutation that originates from a route.

This was a deliberate trade-off when the trigger was introduced — it captures **what** changed without requiring any route plumbing — but the consequence is that the audit log cannot answer **who** did it for any direct-table-write path. Audit 1 surfaced this as A1-AUDIT-004 in `audits/audit-01/report.md`.

For routes that funnel their mutation through a PL/pgSQL RPC (e.g. `fn_withdrawal_record`, `fn_expense_confirm`, `fn_budget_cfo_approve`), the RPC itself does an explicit `INSERT INTO audit_logs` with `user_id = p_caller_id` (or `p_recorded_by`, depending on the RPC's parameter name). The trigger still fires on the underlying table write with `user_id = NULL`, producing a known dual-row pattern: one trigger row with no actor, one RPC row with the real actor. That's acceptable; one of the two rows attributes the change.

## Why `director_payouts` is Path B only

The `director_payouts` table has no `fn_audit_log` trigger attached. Migration 00018 attaches only `trg_director_payouts_updated_at` (maintains `updated_at`), `trg_payout_auto_paid` (status mirror when `withdrawal_id` is set), and `trg_sync_ps_payout_totals` (updates the parent profit-share-record totals after any change). None of those write to `audit_logs`.

So for director payouts, Path A doesn't fire at all. The three mutating routes — `POST /api/director-payouts`, `PATCH /api/director-payouts/[id]/mark-paid`, `PATCH /api/director-payouts/[id]/link-withdrawal` — each do a route-level `audit_logs` insert (Path B). There is exactly one attributed audit row per mutation, with no NULL companion. This is the cleanest of the three coverage shapes in the codebase: trigger-only (NULL actor), trigger + RPC (dual rows, one attributed), route-level only (single attributed row).

## When to use which path for a new route

A new mutating route should pick a path based on the table it writes to:

If the table has a `fn_audit_log` trigger AND the route writes via an RPC that itself inserts an attributed `audit_logs` row: rely on both — Path A gives the trigger row, the RPC gives the attributed row. No route-level audit code needed.

If the table has a `fn_audit_log` trigger AND the route writes directly via `admin.from('table').update(...)` (no attributed RPC): add a route-level `audit_logs` insert using Path B. Otherwise the only audit record will be the trigger row with `user_id = NULL`, which is functionally untraceable. Today this case applies to `src/app/api/invoices/update/route.ts`; see A1-AUDIT-005.

If the table has no `fn_audit_log` trigger (like `director_payouts`, `predated_payouts`, `notifications`, `red_flags`, `eod_reports`, `forex_logs`, `misc_draws`): the route MUST do a Path B insert. No fallback exists. For routes that go through an RPC that already writes its own audit row (most predated-payouts paths), the RPC's insert is sufficient; the route does not need to duplicate it. For routes that write the table directly, the route is the only attribution opportunity.

## Shape of a route-level audit insert

The canonical reference is `src/app/api/profit-share/recompute/route.ts:106-124`. The recipe:

1. Resolve the user via `getAuthUserProfile(request)` and destructure `user` from the result.
2. Perform the primary mutation. If it fails, return the error to the client and do not write an audit row — there is nothing to attribute.
3. Inside a `try/catch`, call `admin.from('audit_logs').insert({ user_id: user.id, action, table_name, record_id, old_values, new_values })`.
4. On audit failure, `console.error(...)` with enough context to debug (route name, user id, record id, raw error). Do not rethrow.
5. Return the success response as before.

For UPDATE-style routes, capture `old_values` by reading the row before the update — a single-column `.select(...).eq('id', id).single()` is enough. The `new_values` blob should contain only the fields the route actually changed; do not include `updated_at`-style auto-maintained columns. Action labels follow `TG_OP` semantics (`'INSERT'`, `'UPDATE'`, `'DELETE'`) so future log queries can union trigger rows and route rows. For semantically distinct operations on the same table — e.g. `mark-paid` vs `link-withdrawal` on `director_payouts` — the `new_values` payload differentiates them; the action label stays `'UPDATE'`.

## Operational verification

After a deploy, smoke-check that a known mutation lands an attributed row. For director payouts:

```sql
SELECT id, user_id, action, table_name, record_id, created_at
FROM audit_logs
WHERE table_name = 'director_payouts'
ORDER BY created_at DESC
LIMIT 5;
```

Any row with `user_id IS NULL` for `table_name = 'director_payouts'` is a regression — either the route lost its `audit_logs` insert or someone added a `fn_audit_log` trigger to the table without removing the route-level write. (Adding the trigger would be a regression because it would re-introduce the NULL-actor row alongside the attributed one for no benefit.)
