# IO Finance Hub — Agent Rules

This is the project-specific guidance for any AI assistant (Claude Code, etc.) working in this repo. Read before making changes.

## About the app

IO Finance Hub is a Nairobi-based internal financial operations web app for Impact Outsourcing Ltd. Five directors share profit 70/30. Active client projects include Windward, AIFI, SEEO, and Kemtai. The app handles real money; correctness matters.

## Stack

- Next.js 14 App Router (standard — no non-standard patches, no custom forks)
- Tailwind CSS with shadcn/ui primitives
- Supabase (Postgres) for DB + auth + RLS
- Vercel for deployment
- TypeScript strict mode

## Hard architectural rules

These are load-bearing. Breaking any of these produces wrong numbers on the dashboards.

1. **Revenue queries MUST use `lagged_revenue_by_project_month`** or `lagged_revenue_company_month`. Never `SELECT ... FROM invoices WHERE billing_period = ...` directly for revenue — that bypasses the lagged-revenue model and produces numbers that disagree with every other page.

2. **Expense queries feeding financial calculations MUST filter `lifecycle_status = 'confirmed'`.** Every aggregate that sums `expenses.amount_kes` or `expenses.amount_usd` needs this filter. Exception: integrity checks that exist specifically to surface non-confirmed expenses (e.g. `fn_month_closure_warnings` orphan check).

3. **Outstanding invoice queries MUST NOT be filtered by `period_month`.** Outstanding is a cash-state property, not a period-attribution property. Use `.in('status', OUTSTANDING_INVOICE_STATUSES)` from `src/lib/constants/status.ts`.

4. **Date formatting uses `en-KE` locale and `Africa/Nairobi` timezone.** Use `formatDate()` from `src/lib/format.ts`. Never use raw `new Date().toLocaleDateString()` without locale/timezone, and never use server-local time to compute "current month" — use `Intl.DateTimeFormat` with explicit timeZone.

5. **Currency formatting uses `formatKES()` / `formatCurrency()` from `src/lib/format.ts`.** Never raw `toLocaleString()` without `'en-KE'`. No hand-rolled "KES X,XXX" string concatenation.

6. **P&L label format for lagged display: `"March 2026 (paid in April)"`.** If changing a revenue label, match this format.

## Database

- Migrations live in `supabase/migrations/`, 5-digit zero-padded prefix (e.g. `00024_fix_foo.sql`).
- Migrations are applied via the Supabase Dashboard SQL Editor (not CLI). The file in the tree is the audit record; the user applies it manually.
- Drift between migrations on disk and live production has been observed historically. When editing a view or function via migration, verify the LIVE definition via `pg_get_functiondef` / `pg_get_viewdef` first — do not assume the file on disk matches production.

## Working style expected from AI assistants

- Two-phase for non-trivial changes: Phase 1 read-only diagnosis, pause for approval, then Phase 2 implementation.
- Minimum scope. Do not "clean up" adjacent code unless asked. Flag additional findings as deferred; don't fix them in the same commit.
- Stage files by exact path. Never `git add .` or `git add -A`. Pre-existing working-tree noise (`.agents/`, `.claude/settings.local.json`, `prototypes/`, audit artifacts) must stay unstaged.
- Every significant fix ends with: stage, diff-cached check, commit with structured message, push to `origin/main`, report the hash.
- Run `npm run build` before committing code changes. Build must pass clean.

## Things NOT to do

- Do not add new dependencies without checking the trade-off first.
- Do not refactor "while we're here." Every touch expands the blast radius.
- Do not use browser storage APIs (`localStorage`, `sessionStorage`) in React artifacts or components unless explicitly requested.
- Do not hardcode the USD→KES exchange rate. The system has `system_settings.standard_exchange_rate`; fallbacks live in one place (currently drifted across the codebase — being consolidated as F-03).
- Do not bypass the lagged revenue view. (Repeating for emphasis.)

## Known active issues

An audit document lives at the repo root as `AUDIT_1_CORRECTNESS.md` (uncommitted, intentionally). It tracks known correctness issues and their fix status. Read it before touching anything financial. Findings are prefixed `F-NN`.
