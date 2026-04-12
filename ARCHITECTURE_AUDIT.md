# ARCHITECTURE_AUDIT

## Executive Summary
- **Critical auth mismatch:** login PIN suffixing is performed client-side (`password: pin + 'io'`) rather than server-side, so the transformation is exposed and contradicts the stated server-side model. Evidence: `src/app/(auth)/login/page.tsx:31-35`.
- **API surface has multiple unauthenticated endpoints using service-role paths** (`/api/eod/auto-send`, cron re-export paths, signout route) and no global rate limiter/origin checks across API handlers. Evidence: `src/app/api/eod/auto-send/route.ts:8-18`, `src/app/api/expense-lifecycle/rollover-cron/route.ts:16-23`, `src/app/api/misc-draws/standing-cron/route.ts:28-35`, `src/app/api/auth/signout/route.ts:21-28`.
- **Migration chain integrity risk:** duplicate migration prefix `00013` exists, and many migrations are non-idempotent (plain `CREATE TRIGGER/CREATE POLICY` without consistent guards), increasing replay drift risk. Evidence: `supabase/migrations/00013_misc_budget_item_link.sql`, `supabase/migrations/00013_withdrawal_company_ops.sql`, `supabase/migrations/00004_functions.sql:26-57`.
- **Schema/code mismatch:** app code references tables not created in migrations (`forex_bureaus`, `payment_methods`, `project_expenses`, `shared_overhead_entries`)—likely runtime failures or stale code paths. Evidence: code references via `.from(...)` scan; migration table declarations in `supabase/migrations/*.sql`.
- **Build currently succeeds only because type-checking is skipped in Next build config (`ignoreBuildErrors: true`) and `next lint` command path is broken in this repo context. Evidence: `next.config.ts:7-11`, raw command output in Appendix.

## 1) TypeScript & Build Health

### Command Results
- `npx tsc --noEmit`: **0 TypeScript errors** (raw output in Appendix).
- `npx next lint`: **failed** with `Invalid project directory provided, no such directory: /workspace/io-finance-hub/lint` (raw output in Appendix).
- `npx next build`: success, but logs show `Skipping validation of types`, meaning build does not enforce TS correctness. Evidence: `next.config.ts:9-11` and build output.

### `ignoreBuildErrors` Impact
`next.config.ts` explicitly disables TS build blocking:
- `typescript.ignoreBuildErrors: true` at `next.config.ts:9-11`.
- With current `tsc --noEmit` run, hidden error count is **0 now**, but this setting still masks future regressions.

### Lint/Type Suppression Markers
`@ts-ignore`, `@ts-expect-error`, `as any`, `eslint-disable` scan:
- Broad `as any` usage found in multiple files, especially minified one-line budget routes and UI forms.
- Significant concentration in `src/app/api/budgets/cfo-approve/route.ts:1` and `src/app/api/budgets/resubmit/route.ts:1` (both single-line files containing many `(x as any)` expressions).
- Example UI casting: `src/components/withdrawals/withdrawal-form-dialog.tsx:201`.
- No `@ts-ignore` / `@ts-expect-error` markers were found in this scan.

### TS Error Table
| File | Error Count | Category | Severity |
|---|---:|---|---|
| *(none)* | 0 | N/A | Low |

**Assessment:** TS compile health is currently good via `tsc`, but operational lint health is inconclusive due to command failure and Next build not enforcing type failures.

## 2) Supabase Schema & Migration Integrity

### Migration Graph (00001 → 00021)
1. `00001_enums.sql` → foundational enums.
2. `00002_tables.sql` → core tables.
3. `00003_rls_policies.sql` → baseline RLS.
4. `00004_functions.sql` → triggers/functions.
5. `00005_red_flag_function.sql`.
6. `00006_misc_draws.sql`.
7. `00007_expense_lifecycle.sql`.
8. `00008_accountant_misc_delegation.sql`.
9. `00009_appendix_o_fixes.sql`.
10. `00010_notifications_and_preferences.sql`.
11. `00011_accountant_budget_submission.sql`.
12. `00012_rls_policy_fixes.sql`.
13. **Duplicate prefix**: `00013_misc_budget_item_link.sql`, `00013_withdrawal_company_ops.sql`.
14. `00014_finance_roles_view_all_budgets.sql`.
15. `00015_role_and_budget_submission_alignment.sql`.
16. `00016_feature_table_coverage.sql`.
17. `00017_withdrawal_type.sql`.
18. `00018_director_payouts.sql`.
19. `00019_director_payouts_accountant_update.sql`.
20. `00020_fix_submitted_by_role.sql`.
21. `00021_fix_lagged_revenue_views.sql`.

### Integrity Findings
- **Duplicate migration number (High):** two `00013` files can cause non-deterministic ordering in some pipelines.
- **Replay safety gaps (Medium):** many trigger/function creates in `00004_functions.sql` use plain `CREATE TRIGGER` without pre-drop guards (e.g., lines `26-57`, `72-89`, `109-111`), making reruns fragile.
- **Controlled destructive operations (Low/Medium):** `DROP ... IF EXISTS` is mostly used safely (`00021_fix_lagged_revenue_views.sql:1-2`, `00018_director_payouts.sql:32,49,105`, etc.).

### RLS Coverage Matrix
From migration scan:
- Tables with RLS enabled: **34**.
- RLS-enabled tables with no policies: **0**.
- Tables created but no explicit RLS enable (potentially open depending on defaults):
  - `accountant_misc_report`, `accountant_misc_report_items`, `accountant_misc_requests`, `budget_withdrawal_log`, `eod_reports`, `expense_import_batches`, `misc_allocations`, `misc_report_items`, `misc_reports`, `project_health_scores`.

### Schema Reference Coverage
App `.from(...)` references objects not found in migration `CREATE TABLE/VIEW` chain:
- `forex_bureaus`
- `payment_methods`
- `project_expenses`
- `shared_overhead_entries`

This is a **High** consistency risk (runtime query failures or legacy code drift).

### Function Audit (`00004`, `00005`)
- Multiple functions are `SECURITY DEFINER` (`00004_functions.sql:23,241,337,382,459,514,561,595`; `00005_red_flag_function.sql:103`).
- No obvious string-concatenated dynamic SQL/`EXECUTE` found in audited files.
- **Risk:** privileged functions should pin `search_path` defensively; no explicit `SET search_path` hardening was found.

### Seed File Check
- `supabase/seed.sql` contains commented placeholder identities/emails only; no hardcoded passwords/secrets observed. Evidence: `supabase/seed.sql:10-52`.

## 3) Authentication & Authorization

### Auth Flow (text diagram)
`Login page (client)` → `supabase.auth.signInWithPassword` using `pin + 'io'` → middleware `updateSession()` refresh on request → route/page access gated by middleware redirect + client session checks → API routes verify bearer via `getAuthUserProfile()` (where implemented) → DB RLS/policies.

### PIN Transformation Audit
- Implemented **client-side**, not server-side:
  - `password: pin + 'io'` in `src/app/(auth)/login/page.tsx:31-35`.
- Security implication: transformation logic is exposed and replayable by any client.

### Role Resolution
- API authorization uses `users` table lookup after token verification (`src/lib/supabase/admin.ts:44-55`), then role checks via `assertRole` (`:62-69`).
- Roles are **not** sourced from JWT claims in this helper.

### Route Protection Gaps
- Middleware matcher is broad (`src/middleware.ts:9-11`) and redirects unauthenticated non-auth paths (`src/lib/supabase/middleware.ts:44-47`).
- Explicit public bypass includes `/design-sample` (`src/lib/supabase/middleware.ts:42-44`).
- API-level auth is inconsistent (see Section 4 inventory).

### Unprotected/partially protected APIs (not calling `supabase.auth.getUser` equivalent)
- `src/app/api/eod/auto-send/route.ts` (cron path; no auth, no secret check).
- `src/app/api/auth/signout/route.ts` (signout utility route; no auth check).
- Re-exported cron routes rely on downstream check (`rollover-carry-forward`, `create-monthly`).

## 4) API Route Audit

### Inventory
(Generated by static scan; verify edge cases manually.)

| Route | Methods | Auth check | Input validation | Error handling | Key risk |
|---|---|---|---|---|---|
| `/api/auth/signout` | GET, POST | No | No | No try/catch | Session manipulation without auth gate (Low) |
| `/api/eod/auto-send` | GET | No | Minimal | try/catch | Public cron trigger (High) |
| `/api/expense-lifecycle/rollover-cron` | GET | Secret header only | Minimal | no try/catch | GET mutation + N+1 loop (Medium) |
| `/api/misc-draws/standing-cron` | GET | Secret header only | Minimal | no try/catch | GET mutation + N+1 loop (Medium) |
| `/api/eod` | GET, POST | Yes | Partial | mixed | large `any` use + possible N+1 |
| `/api/budgets/*` | POST | Yes | Partial/manual | mostly try/catch | one-line minified handlers reduce maintainability |
| `/api/month-closure` | POST | Yes (CFO) | Yes | try/catch + shared formatter | strongest pattern |

### Findings
- **No centralized rate limiting** detected across API routes (High).
- **GET used for mutation/cron operations** (Medium): rollover and standing draw creation perform inserts in GET handlers.
- **Possible N+1 loops** in budget and cron handlers (e.g., per-item existence checks + inserts): `rollover-cron` `:38-67`, `standing-cron` `:53-78`.
- **Raw/internal error leakage** appears in some routes returning `error.message` directly (e.g., `rollover-cron:33`, `standing-cron:47`).

## 5) Client-Side Data Fetching Patterns

### Pattern Summary
- Dashboard pages are predominantly client components (`'use client'`), with `useEffect` + browser Supabase client fetches.
- 85 `use client` directives found across `src/app` and `src/components`; most dashboard pages are client-rendered.

### Risks
- **Stale data/revalidation:** many pages fetch once on mount or on local state change; no server revalidation strategy.
- **Waterfalls:** some pages still run sequential dependent fetches (e.g., month-closure extra checks after initial queries, `src/app/(dashboard)/month-closure/page.tsx:53-90`).
- **N+1 client loops:** variance trend fetch loops month-by-month (`src/app/(dashboard)/expenses/variance/page.tsx:173-188`).
- **Client-side auth gating in layout** duplicates middleware and can flash states (`src/app/(dashboard)/layout.tsx:30-49`).

### Supabase Client Instantiation
- Server-side client is request-scoped (`src/lib/supabase/server.ts:4-26`).
- Middleware uses per-request server client (`src/lib/supabase/middleware.ts:16-35`).
- Client-side `createClient()` called inside components/effects; no obvious singleton SSR leakage.

## 6) Component Architecture

### Inventory and Boundaries
- Shared components: `src/components/*`.
- Dashboard-specific pages/components: `src/app/(dashboard)/*` and `src/app/(dashboard)/_components/*`.

### Size Heatmap (>500 LOC)
- `src/app/(dashboard)/misc/page.tsx` — 2810
- `src/app/api/expense-lifecycle/route.ts` — 1119
- `src/app/design-sample/page.tsx` — 932
- `src/app/(dashboard)/expenses/queue/page.tsx` — 900
- `src/app/(dashboard)/budgets/[id]/page.tsx` — 892
- `src/app/api/misc-draws/route.ts` — 868
- `src/app/(dashboard)/revenue/page.tsx` — 759
- `src/app/(dashboard)/_components/cfo-dashboard.tsx` — 734

### Findings
- **Oversized files** indicate high cognitive load and testing difficulty (Medium/High).
- **Business logic mixed with UI** in several pages/components (e.g., `cfo-dashboard`, `variance`, `misc`).
- **UI library consistency:** design system wrappers are in `src/components/ui`, but many wrappers are Base UI primitives underneath (e.g., `src/components/ui/select.tsx`, `dialog.tsx`, `button.tsx`), which is acceptable if intentional.

### Accessibility Notes
- Positive: explicit labels/aria usage in login form (`src/app/(auth)/login/page.tsx:83-113`).
- Needs investigation: broad dashboard/table/chart surfaces may require keyboard-navigation and chart a11y audits (not fully inferable statically).

## 7) Performance & Bundle Size

### Build Summary
- `npx next build` succeeded.
- Middleware deprecation warning present: use `proxy` convention (`build output`).
- All app routes listed as static (`○`) or dynamic (`ƒ`) successfully.

### Opportunities
- Heavy chart imports (`recharts`) are static in multiple client pages; consider dynamic/lazy splits for less-used reports.
- `xlsx` is server-side in import API route (`src/app/api/expenses/import/route.ts:3`) which is acceptable for client bundle, but monitor function cold start.
- `jsPDF` already dynamically imported (`src/lib/pdf-export.ts:2`).
- Very high number of client pages suggests larger client JS footprint than necessary.

## 8) Business Logic Correctness

### Lagged Revenue Model
- One-month lag is implemented by joining invoice month = `expense_month - 1 month` (`00021_fix_lagged_revenue_views.sql:8,40`).
- USD→KES fallback is implemented in view using `COALESCE(NULLIF(...), usd * 128.5, 0)` (`:9,12`).
- **Inconsistency risk:** other app areas use `129.5` or settings-driven rates (`cfo-dashboard:205`, `project-financials` default), not always the same fallback constant. Severity: **High**.

### Expense Lifecycle
- Status model includes `pending_auth`, `confirmed`, `carried_forward`, `voided` in lifecycle route logic (see large route file).
- Enforcement appears primarily API-side; database-level transition constraints/triggers are not clearly comprehensive from migration scan. Severity: **Needs Investigation / Medium**.

### Month Closure
- API calls `fn_close_month` / `fn_reopen_month` (`src/app/api/month-closure/route.ts:29-45`).
- DB functions exist (`supabase/migrations/00004_functions.sql:520-595`), but edit-prevention enforcement outside specific guarded APIs appears partial. Severity: **High** if writes can bypass guarded routes.

### Profit Share / Director Payouts
- Director payout logic introduced (`00018`, `00019`) with triggers/policies.
- Potential rounding/currency consistency concerns where snapshot/revenue fallbacks mix different rates and ad hoc rounding (`cfo-dashboard:205-233`). Severity: **Medium**.

### Budget vs Actual Consistency
- Budget-vs-actual uses `variance_summary_by_project` view and lagged company revenue (`reports/budget-vs-actual/page.tsx:59-65`).
- Expenses variance page uses `pending_expenses` directly and custom aggregation (`expenses/variance/page.tsx:144-205`).
- CFO dashboard uses separate direct expenses + lagged revenue approach (`cfo-dashboard:192-233`).
- **Risk:** multiple independent formulas may diverge. Severity: **High**.

### Business Logic Risk Register
| Item | Severity | Rationale |
|---|---|---|
| PIN suffix logic client-exposed | Critical | Authentication secret derivation visible client-side |
| Revenue FX fallback inconsistency (128.5 vs 129.5/settings) | High | Financial reporting drift |
| Multi-source variance/profit calculations | High | Inconsistent executive metrics |
| Month closure enforcement scope unclear | High | Potential post-close mutation paths |
| Expense status transition DB hardening unclear | Medium | API-only enforcement may be bypassed |

## 9) Error Handling & Observability

### Error Boundaries
- Segment-level and global error components exist and log to console:
  - `src/app/(dashboard)/error.tsx:1-20`
  - `src/app/error.tsx:1-20`
- They catch render errors, but async/unhandled promise rejection coverage still depends on local try/catch and browser runtime.

### API Error Handling
- Mixed patterns: some routes use `apiErrorResponse`, others return ad hoc JSON, some lack try/catch entirely.
- No unified typed error envelope across all routes.

### Observability
- Logging is mostly `console.error`; no Sentry/LogRocket/etc integration observed in scanned files.
- Critical workflows (cron, lifecycle mutations) would benefit from structured error events and alerting.

## 10) Security Audit (OWASP-aligned)

| Category | Finding | Severity | Evidence |
|---|---|---|---|
| A01 Broken Access Control | Unauthenticated cron-capable endpoint (`/api/eod/auto-send`) | High | `src/app/api/eod/auto-send/route.ts:16-18` |
| A01 Broken Access Control | Inconsistent auth checks across API routes | Medium | API inventory in Section 4 |
| A05 Security Misconfiguration | No CSP/CORS/security headers configured in `vercel.json` | Medium | `vercel.json:1-16` |
| A08 Software/Data Integrity | Client-side PIN→password transformation | Critical | `src/app/(auth)/login/page.tsx:31-35` |
| A09 Security Logging & Monitoring Failures | Console-only logging, no central monitoring | Medium | `src/app/error.tsx:16`, `src/app/(dashboard)/error.tsx:16` |

Additional checks:
- No `dangerouslySetInnerHTML` found in scan.
- No obvious secret literals in client code; `.env.local.example` documents keys only.

## 11) Code Quality & Maintainability

### LOC by Major Directory
- `src/app`: 23,337 LOC
- `src/components`: 8,586 LOC
- `src/lib`: 1,225 LOC
- `supabase/migrations`: 2,940 LOC
- `scripts`: 819 LOC

### Findings
- 15 files exceed 500 LOC (see Section 6 heatmap).
- Minified/one-line API handlers (`cfo-approve`, `resubmit`) are difficult to review/test.
- No test files/framework artifacts detected (`__tests__`, `.test.*`, jest/vitest/playwright/cypress scans returned none).
- Naming conventions are mostly consistent, with kebab-case route folders and camelCase/PascalCase usage in code.

## 12) Deployment & Infrastructure

### Deployment Architecture (text)
Vercel-hosted Next.js app → middleware session refresh (deprecated convention warning) → app/API routes (mostly Node runtime) → Supabase PostgreSQL (RLS + service role routes) → scheduled cron invocations via `vercel.json` for EOD/misc/rollover.

### Findings
- `vercel.json` defines cron jobs only; no explicit security headers/CSP. Evidence: `vercel.json:1-16`.
- `next.config.ts` intentionally ignores TS build errors. Evidence: `next.config.ts:9-11`.
- `.env.local.example` includes required Supabase URL/anon/service keys, but no additional env docs for cron/webhooks (`CRON_SECRET`, `EOD_SLACK_WEBHOOK_URL`, etc.). Evidence: `.env.local.example:1-4` and API route env usage.
- No CI/CD migration automation evidence found in scanned repo files (Needs Investigation).

## Priority Action Items
1. **Move PIN→password transformation to server-side auth API** and remove client suffixing logic. **Risk: Critical. Effort: M**.
2. **Lock down unauthenticated cron endpoints** (`/api/eod/auto-send` especially) with mandatory secret verification and method hardening. **Risk: High. Effort: S**.
3. **Unify financial FX fallback logic** (single source of truth for USD→KES rate and lagged revenue conversion). **Risk: High. Effort: M**.
4. **Resolve migration numbering collision (`00013`) and add idempotent guards for triggers/policies/functions.** **Risk: High. Effort: M/L**.
5. **Consolidate budget/variance/profit computations into shared DB views or shared library utilities** to prevent KPI drift. **Risk: High. Effort: L**.
6. **Introduce API rate limiting + standardized error envelope + structured observability (e.g., Sentry + request IDs).** **Risk: Medium. Effort: M**.
7. **Refactor oversized files (>500 LOC)** starting with `misc/page.tsx`, `expense-lifecycle/route.ts`, and dashboard monoliths. **Risk: Medium. Effort: L**.
8. **Fix lint invocation/config path issue and reinstate TS build enforcement once stable.** **Risk: Medium. Effort: S/M**.

## Appendix

### Raw `npx tsc --noEmit` output
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

### Raw `npx next lint` output
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
Invalid project directory provided, no such directory: /workspace/io-finance-hub/lint
```

### Raw `npx next build` output
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry

▲ Next.js 16.2.2 (Turbopack)

⚠ The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  Creating an optimized production build ...
✓ Compiled successfully in 45s
  Skipping validation of types
  Finished TypeScript config validation in 12ms ...
  Collecting page data using 2 workers ...
  Generating static pages using 2 workers (0/66) ...
  Generating static pages using 2 workers (16/66) 
  Generating static pages using 2 workers (32/66) 
  Generating static pages using 2 workers (49/66) 
✓ Generating static pages using 2 workers (66/66) in 4.5s
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /agent-counts
├ ƒ /api/auth/signout
├ ƒ /api/budgets/accountant-submit-notify
├ ƒ /api/budgets/auto-reject-sibling
├ ƒ /api/budgets/cfo-approve
├ ƒ /api/budgets/cfo-revert
├ ƒ /api/budgets/create
├ ƒ /api/budgets/delete
├ ƒ /api/budgets/pm-line-review
├ ƒ /api/budgets/pm-review
├ ƒ /api/budgets/resubmit
├ ƒ /api/budgets/withdraw
├ ƒ /api/director-payouts
├ ƒ /api/director-payouts/[id]/link-withdrawal
├ ƒ /api/director-payouts/[id]/mark-paid
├ ƒ /api/eod
├ ƒ /api/eod/auto-send
├ ƒ /api/expense-lifecycle
├ ƒ /api/expense-lifecycle/rollover-carry-forward
├ ƒ /api/expense-lifecycle/rollover-cron
├ ƒ /api/expenses/delete
├ ƒ /api/expenses/import
├ ƒ /api/historical-seed
├ ƒ /api/misc-draws
├ ƒ /api/misc-draws/create-monthly
├ ƒ /api/misc-draws/standing-cron
├ ƒ /api/month-closure
├ ƒ /api/project-financials
├ ƒ /api/users
├ ƒ /api/withdrawals/create
├ ○ /audit
├ ƒ /auth/callback
├ ƒ /auth/signout
├ ○ /budgets
├ ƒ /budgets/[id]
├ ○ /budgets/new
├ ○ /departments
├ ○ /design-sample
├ ○ /expenses
├ ○ /expenses/import
├ ○ /expenses/queue
├ ○ /expenses/variance
├ ○ /financials
├ ○ /invoices
├ ○ /login
├ ○ /misc
├ ○ /month-closure
├ ○ /notifications
├ ○ /profit-share
├ ○ /profit-share/payouts
├ ○ /projects
├ ○ /red-flags
├ ○ /reports/budget-accuracy
├ ○ /reports/budget-vs-actual
├ ○ /reports/monthly
├ ○ /reports/outstanding
├ ○ /reports/pnl
├ ○ /reports/profitability
├ ○ /reports/projects
├ ○ /reports/trends
├ ○ /reset-password
├ ○ /revenue
├ ○ /settings
├ ○ /users
└ ○ /withdrawals


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```
