# IO Finance Hub — Architecture & Deployment Guide

## Product Architecture Overview

IO Finance Hub is an internal financial operations system for Impact Outsourcing Limited, built as a Next.js 14+ application backed by Supabase (PostgreSQL, Auth, RLS).

### Architecture Layers

```
┌─────────────────────────────────────────┐
│           Frontend (Vercel)             │
│  Next.js 14 App Router + Tailwind +    │
│  shadcn/ui + Role-based dashboards     │
├─────────────────────────────────────────┤
│         Supabase Client SDK            │
│  Browser client + Server client + SSR  │
├─────────────────────────────────────────┤
│          Supabase Cloud                │
│  PostgreSQL + Auth + RLS + Functions   │
└─────────────────────────────────────────┘
```

### Key Design Decisions

1. **RLS-first security** — All data access enforced at database level via Supabase Row-Level Security, not frontend-only authorization
2. **Dual currency** — All financial records store both USD (4 decimal places) and KES (2 decimal places)
3. **Accrual + Cash reporting** — Revenue recognized via invoices (accrual) or payments (cash) with a reporting toggle
4. **Budget versioning** — Immutable approved versions; new versions created on rejection/resubmission or CFO override
5. **Month closure workflow** — Warnings (soft blocks), CFO confirmation, auto-calculation of allocations and profit shares

---

## Database Schema Summary

### Enums (00001_enums.sql)
- `user_role`: cfo, accountant, team_leader, project_manager
- `director_enum`: kelvin, evans, dan, gidraph, victor
- `budget_status`: draft, submitted, under_review, approved, rejected
- `expense_type`: project_expense, shared_expense
- `allocation_method`: revenue_based, headcount_based, hybrid
- `month_status`: open, under_review, closed, locked
- `profit_share_status`: pending_review, approved, disputed
- `invoice_status`: draft, sent, partially_paid, paid, overdue, cancelled

### Core Tables (00002_tables.sql)

| Category | Tables |
|----------|--------|
| Users & Auth | `users`, `user_project_assignments`, `user_department_assignments` |
| Organization | `departments`, `projects`, `agent_counts` |
| Budgeting | `budgets`, `budget_versions`, `budget_items`, `budget_approvals` |
| Expenses | `expenses`, `expense_categories`, `overhead_categories` |
| Revenue | `invoices`, `payments` |
| Withdrawals | `withdrawals`, `forex_logs` |
| Allocations | `allocation_rules`, `overhead_allocations` |
| Profitability | `project_profitability`, `profit_share_records`, `monthly_financial_snapshots` |
| System | `red_flags`, `system_settings`, `audit_logs`, `month_closures` |

### Key Constraints
- `budgets.budget_scope_check` — links to exactly one project OR department
- `expenses.expense_scope_check` — project expenses have project_id; shared expenses have overhead_category_id
- `allocation_rules.weights_sum_100` — hybrid weights must sum to 100
- `fn_validate_expense_budget` trigger — expenses can only link to APPROVED budget versions
- `fn_protect_director_assignment` trigger — director change blocked after first invoice (CFO override allowed)

---

## RLS Policies (00003_rls_policies.sql)

| Table | CFO | Accountant | Team Leader | Project Manager |
|-------|-----|------------|-------------|-----------------|
| users | Full | Read all | Read self only | Read self only |
| departments | Full CRUD | Read only | No access | Read all, write own |
| projects | Full CRUD | Read all | Read assigned | No access |
| budgets | Full | Read/write (no approve) | Read/write assigned project | Read/write assigned dept |
| expenses | Full | Read/write | Read assigned project | No access |
| invoices | Full | Read/write | Read assigned project | No access |
| withdrawals | Full | Read/write | No access | No access |
| profit_share | Full | Read only | No access | No access |
| red_flags | Full | No access | No access | No access |
| audit_logs | Read only | No access | No access | No access |

---

## Database Functions (00004_functions.sql)

| Function | Purpose |
|----------|---------|
| `fn_audit_log()` | Generic trigger for audit logging on all key tables |
| `fn_set_updated_at()` | Auto-update `updated_at` timestamps |
| `fn_validate_expense_budget()` | Hard block: expenses must link to approved budget |
| `fn_protect_director_assignment()` | Prevent director change after first invoice |
| `fn_calculate_project_profitability()` | Revenue - direct costs - allocated overhead per project |
| `fn_calculate_overhead_allocations()` | Revenue/headcount/hybrid allocation per project |
| `fn_generate_profit_shares()` | 70/30 split with pending_review status |
| `fn_generate_monthly_snapshot()` | Company-level P&L aggregation |
| `fn_month_closure_warnings()` | Returns pre-closure warning list |
| `fn_close_month()` | Full closure: allocations + profitability + profit share + locks |
| `fn_reopen_month()` | CFO override with reason, unlocks all records |
| `fn_generate_red_flags()` | Scans for all alert conditions using configurable thresholds |

---

## Frontend Routes

| Route | Role Access | Purpose |
|-------|-------------|---------|
| `/` | All | Role-based dashboard |
| `/login` | Public | Authentication |
| `/budgets` | All (scoped) | Budget listing and management |
| `/expenses` | CFO, Accountant | Expense tracking |
| `/revenue` | CFO, Accountant, TL | Invoices and payments |
| `/withdrawals` | CFO, Accountant | USD withdrawals and forex |
| `/reports/pnl` | CFO, Accountant | Company P&L statement |
| `/reports/profitability` | CFO, Accountant | Per-project P&L |
| `/reports/budget-vs-actual` | CFO, Accountant | Budget utilization |
| `/profit-share` | CFO | 70/30 distribution with approval |
| `/month-closure` | CFO | Close/lock/reopen periods |
| `/red-flags` | CFO | Alert management |
| `/agent-counts` | CFO, Accountant, TL | Per-project agent counts |
| `/projects` | CFO | Project CRUD |
| `/departments` | CFO | Department CRUD |
| `/users` | CFO | User management |
| `/settings` | CFO | System thresholds |

---

## Deployment Steps

### 1. Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Run migrations in order:
   ```sql
   -- In Supabase SQL Editor, run each file:
   00001_enums.sql
   00002_tables.sql
   00003_rls_policies.sql
   00004_functions.sql
   00005_red_flag_function.sql
   ```
3. Create auth users via Supabase Dashboard > Authentication > Users
4. Insert matching rows into `users` table (see `supabase/seed.sql`)
5. Copy your project URL and anon key

### 2. Vercel Deployment

1. Push code to GitHub
2. Connect repo to Vercel
3. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

### 3. Post-Deployment

1. Create initial users (CFO accounts first)
2. Set up projects and departments
3. Configure system settings thresholds
4. Assign users to projects/departments via the access mapping tables

---

## Assumptions Made

1. **Auth flow**: Email/password authentication via Supabase Auth; no SSO in Phase 1
2. **Signup disabled**: Users are created by CFO only; no self-registration
3. **Director identity**: Directors are identified via `director_tag` enum on the `users` table, and also stored on `projects` for FK constraint
4. **Budget approval**: At the version header level, not per line-item
5. **Forex variance**: Calculated as difference between actual KES received and (USD amount * reference rate) when a reference rate is provided
6. **Month closure**: Generates all calculations in a single transaction; no partial closure
7. **Red flag generation**: Called on-demand (not real-time); CFO can trigger via the month-closure flow or manually

---

## Unresolved Design Decisions (Phase 1 Defaults)

| Decision | Default | Notes |
|----------|---------|-------|
| Cash-basis revenue calculation | Filter payments by `payment_date` within selected month | Alternative: filter by billing_period of linked invoice |
| Overhead allocation timing | Calculated at month closure | Could be real-time preview |
| Profit share adjustments | CFO can dispute with reason | No automatic recalculation after dispute |
| Red flag notification | In-app only, CFO dashboard | No email/Slack (Phase 1 scope) |
| Budget categories | Free text on budget items | Could be standardized dropdown |
| Multi-month budgets | Not supported | Each budget is single-month |
| Partial payments on invoices | Invoice status manually updated | Could auto-update based on payment totals |
| Audit log retention | Unlimited | May need archival policy |
