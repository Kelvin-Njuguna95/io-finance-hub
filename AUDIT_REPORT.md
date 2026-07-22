# IO Finance Hub — Pre-Launch Audit Report
**Generated**: 2026-04-13 (UTC)  
**Codebase**: branch `work`, commit `3f2b138f4f7a7827d2313111071e11f1876a8394`  
**Auditor**: Codex

## Executive Summary
- **Critical**: Login still derives password client-side (`pin + 'io'`), exposing auth transformation in browser code (`src/app/(auth)/login/page.tsx:31-35`).
- **Critical**: Type safety is still bypassed in production builds (`ignoreBuildErrors: true`), and `tsc` currently reports a real error in withdrawal form editing (`src/components/withdrawals/withdrawal-form-dialog.tsx:608`).
- **High**: Several cron/mutation GET endpoints remain weakly protected (auth optional if `CRON_SECRET` unset), and two cron aliases are pure re-exports without additional guards (`src/app/api/misc-draws/create-monthly/route.ts`, `src/app/api/expense-lifecycle/rollover-carry-forward/route.ts`).
- **High**: Financial logic still has inconsistent FX defaults (`128.5` in SQL views vs `129.5` in dashboard components), creating KPI/report drift risk (`supabase/migrations/00021_fix_lagged_revenue_views.sql:9-12`, `src/app/(dashboard)/_components/cfo-dashboard.tsx:205`, `src/app/(dashboard)/_components/project-manager-dashboard.tsx:89`).
- **High**: Migration ordering and replay reliability risks remain (duplicate `00013` migration prefix; many unconditional `CREATE TRIGGER`/`CREATE POLICY`/`CREATE FUNCTION` statements).

## Scorecard
| Category | Status | Critical | High | Medium | Low |
|---|---|---:|---:|---:|---:|
| 1. Build & Type Safety | At Risk | 1 | 1 | 2 | 1 |
| 2. Authentication & Authorization | At Risk | 1 | 4 | 2 | 1 |
| 3. Database & Migration Integrity | At Risk | 0 | 4 | 4 | 1 |
| 4. API Route Quality | At Risk | 0 | 5 | 6 | 1 |
| 5. Financial Calculation Consistency | At Risk | 1 | 4 | 3 | 0 |
| 6. Withdrawal & Payout Logic | Partially Ready | 0 | 3 | 3 | 1 |
| 7. Client-Side Data Fetching & Performance | At Risk | 0 | 4 | 5 | 1 |
| 8. UI/UX Completeness | Partially Ready | 0 | 1 | 4 | 3 |
| 9. Security | At Risk | 1 | 4 | 3 | 2 |
| 10. Code Quality & Maintainability | At Risk | 0 | 3 | 5 | 2 |
| 11. Deployment & Infrastructure | At Risk | 0 | 3 | 2 | 2 |

## Detailed Findings

### 1. Build & Type Safety

#### 1.1 TypeScript errors still present (**High**)
- `npx tsc --noEmit` fails with:
  - `src/components/withdrawals/withdrawal-form-dialog.tsx(608,43): error TS18047: 'value' is possibly 'null'.`
- **Impact**: Runtime null handling gaps in critical financial form path.
- **Remediation**:
  1. Fix null narrowing at the failing selector branch.
  2. Add guard/unit test for edit form state transitions where `value` can be null.

#### 1.2 Build masks type failures via config (**Critical**)
- `next.config.ts` has `typescript.ignoreBuildErrors = true` (`next.config.ts:9-11`).
- `npx next build` explicitly shows “Skipping validation of types”.
- **Impact**: Broken types can reach production undetected.
- **Remediation**: Set `ignoreBuildErrors: false` after clearing current TS errors and enforce `npx tsc --noEmit` in CI.

#### 1.3 Lint command path/convention still broken (**Medium**)
- `npx next lint` fails with: `Invalid project directory provided, no such directory: /workspace/io-finance-hub/lint`.
- `package.json` uses `"lint": "eslint"` (`package.json:12`), while `next lint` is deprecated/changed in Next 16.
- **Remediation**:
  1. Standardize lint entrypoint to `npm run lint` (eslint flat config).
  2. Remove any stale lint path args from shell aliases/scripts.
  3. Add CI lint step using `npm run lint .`.

#### 1.4 `as any` usage persists in approval/resubmit and form code (**Medium**)
- Instances found:
  - `src/components/withdrawals/withdrawal-form-dialog.tsx:245`
  - `src/app/api/budgets/cfo-approve/route.ts:43,121`
  - `src/app/api/budgets/resubmit/route.ts` (single-line file; contains multiple casts)
- **Assessment**:
  - Budget routes: likely masking relational typing mismatch from nested select payloads.
  - Withdrawal dialog: mostly pragmatic due to supabase response typing.
- **Remediation**: Define typed response interfaces for nested budget queries; remove casts in mutation paths first.

#### 1.5 Build warning: middleware convention deprecation (**Low, non-blocking**)
- Build warns: `"middleware" file convention is deprecated. Please use "proxy" instead.`
- Current file: `src/middleware.ts`.
- **Remediation**: run codemod `npx @next/codemod@latest middleware-to-proxy .` and rename export/file in controlled PR.

---

### 2. Authentication & Authorization

#### 2.1 PIN transformation still client-side (**Critical**)
- Login still submits `password: pin + 'io'` in client component (`src/app/(auth)/login/page.tsx:31-35`).
- **Remediation**: Move transformation/verification server-side (auth API), use opaque credential exchange.

#### 2.2 Middleware route gating is broad but has intentional public bypasses (**Medium**)
- Gatekeeper in `src/lib/supabase/middleware.ts` redirects unauthenticated users unless path starts with `/auth` or `/design-sample` (`:44-47`).
- `src/middleware.ts` applies matcher to almost all app routes (`:9-11`).
- **Bypasses**:
  - `/design-sample` public (documented in code comment).
  - `/login`, `/auth/callback`, `/auth/signout` public.
- **Risk**: acceptable for deliberate public pages; confirm no sensitive data exposed on `/design-sample`.

#### 2.3 API auth coverage table (all routes)
| Route | Methods | Auth Check? | Role Check? | Risk |
|---|---|---|---|---|
| /api/auth/signout | POST,GET | No | No | Medium |
| /api/budgets/accountant-submit-notify | POST | Yes | Indirect | Medium |
| /api/budgets/auto-reject-sibling | POST | Yes | Yes | Low |
| /api/budgets/cfo-approve | POST | Yes | Yes | Low |
| /api/budgets/cfo-revert | POST | Yes | Yes | Low |
| /api/budgets/create | POST | Yes | Yes | Low |
| /api/budgets/delete | POST | Yes | Yes | Low |
| /api/budgets/pm-line-review | POST | Yes | Yes | Low |
| /api/budgets/pm-review | POST | Yes | Yes | Low |
| /api/budgets/resubmit | POST | Yes | Yes | Medium (minified) |
| /api/budgets/withdraw | POST | Yes | Yes | Low |
| /api/director-payouts | POST | Yes | Yes | Medium |
| /api/director-payouts/[id]/link-withdrawal | PATCH | Yes | Partial | Medium |
| /api/director-payouts/[id]/mark-paid | PATCH | Yes | Yes | Low |
| /api/eod | GET,POST | Yes | Yes | Medium (GET mutates) |
| /api/eod/auto-send | GET | No | No | **High** |
| /api/expense-lifecycle | GET,POST | Yes | Yes | Medium |
| /api/expense-lifecycle/rollover-cron | GET | Secret header only | No | **High** |
| /api/expense-lifecycle/rollover-carry-forward | re-export GET | Secret header only | No | **High** |
| /api/expenses/delete | POST | Yes | Indirect | Medium |
| /api/expenses/import | POST | Yes | Indirect | Medium |
| /api/historical-seed | POST,GET,DELETE | Yes | Yes | Medium (GET/DELETE) |
| /api/misc-draws | GET,POST | Yes | Yes | Medium |
| /api/misc-draws/standing-cron | GET | Secret header only | No | **High** |
| /api/misc-draws/create-monthly | re-export GET | Secret header only | No | **High** |
| /api/month-closure | POST | Yes | Yes | Medium |
| /api/project-financials | GET | Yes | Partial | Medium |
| /api/users | POST | Yes | Partial | Medium |
| /api/withdrawals/create | POST | Yes | Partial | Medium |
| /api/withdrawals/fix-legacy | POST | Yes | Yes | Medium |
| /api/withdrawals/update | PUT | Yes | Yes (CFO) | Low |

#### 2.4 Cron endpoint protection remains conditional (**High**)
- `rollover-cron` and `standing-cron` validate bearer secret **only if** `CRON_SECRET` exists (`.../rollover-cron/route.ts:18-20`, `.../standing-cron/route.ts:30-32`).
- `auto-send` currently has no CRON secret enforcement.
- Re-export endpoints inherit same behavior.
- **Remediation**:
  1. Fail closed when secret missing (startup guard + runtime 500).
  2. Enforce `x-vercel-signature`/secret for all cron endpoints.
  3. Restrict method to POST for mutative tasks.

#### 2.5 CFO-only operations mostly enforced, but role checks are string-based (**Medium**)
- CFO checks via `profile.role !== 'cfo'` in sensitive paths (`withdrawals/update`, `month-closure`, budget cfo routes).
- **Remediation**: central enum/type guard for roles to avoid typo drift.

---

### 3. Database & Migration Integrity

#### 3.1 Duplicate migration prefix still present (**High**)
- Both exist:
  - `supabase/migrations/00013_misc_budget_item_link.sql`
  - `supabase/migrations/00013_withdrawal_company_ops.sql`
- **Risk**: nondeterministic ordering across tooling.
- **Remediation**: renumber one migration and provide deterministic baseline migration notes.

#### 3.2 Migration idempotency gaps (triggers/policies/functions) (**High/Medium**)
- Many unconditional `CREATE TRIGGER` in `00004_functions.sql` (`:26-57`, `:72-89`, `:109`, `:130`, `:153`) without preceding drop guards.
- Several plain `CREATE POLICY` in core migrations rely on one-time execution assumptions.
- **Remediation**: add `DROP ... IF EXISTS` or `DO $$ BEGIN ... EXCEPTION ... END $$` guards for replay safety.

#### 3.3 Schema/code mismatches still present (**High**)
- App references tables not created in migrations:
  - `forex_bureaus` (`src/components/withdrawals/withdrawal-form-dialog.tsx:178,284`)
  - `payment_methods` (`src/components/revenue/payment-form-dialog.tsx:55`)
  - `project_expenses` (`src/app/api/historical-seed/route.ts:44,85`)
  - `shared_overhead_entries` (`src/app/api/historical-seed/route.ts:45,86`)
- **Remediation**: create migrations or remove dead references and update seed/import paths.

#### 3.4 RLS coverage gaps on newer/supporting tables (**High**)
Tables created without RLS+policy coverage:
- `budget_withdrawal_log`
- `misc_reports`
- `misc_report_items`
- `accountant_misc_requests`
- `accountant_misc_report`
- `accountant_misc_report_items`
- `expense_import_batches`
- `eod_reports`
- `project_health_scores`
- **Remediation**: enable RLS and add minimum read/write policies by role.

#### 3.5 Drift check: withdrawal director columns are now migrated (**Fixed/Low risk)**
- `director_name` and `payout_type` are present in migration `00017_withdrawal_type.sql:15-21`.
- Prior direct-SQL drift risk appears resolved.

#### 3.6 Check constraint definition matches expected logic (**Pass**)
- `withdrawal_purpose_check` matches expected expression in `00013_withdrawal_company_ops.sql:30-33`.

#### 3.7 SECURITY DEFINER functions lack explicit search_path hardening (**Medium**)
- Multiple SECURITY DEFINER functions in `00003`, `00004`, `00005` (e.g., `00004_functions.sql:23,241,337,382,459,514,561,595`).
- No `SET search_path = ...` observed in function definitions.
- **Remediation**: set trusted search path within each SECURITY DEFINER function.

---

### 4. API Route Quality

#### 4.1 Input validation (Zod) still absent across API surface (**High**)
- No route-level Zod schemas detected; body validation is mostly manual/partial.
- **Remediation**: introduce shared validation layer for all mutating routes.

#### 4.2 Error handling inconsistent (**Medium**)
- Some routes use `try/catch` + `apiErrorResponse`, others don’t (`expense-lifecycle/route.ts`, `historical-seed/route.ts`, cron routes).
- Some responses still surface raw DB error messages.
- **Remediation**: standardize `{ error, code }` envelopes and avoid leaking internals.

#### 4.3 GET handlers that mutate data still exist (**High**)
- `expense-lifecycle/rollover-cron` inserts rows in GET.
- `misc-draws/standing-cron` inserts rows in GET.
- `/api/eod` GET path includes mutative behavior signal (route mixes summary + send concerns).
- **Remediation**: switch to POST for all mutations, reserve GET for read-only.

#### 4.4 N+1 query patterns in API routes (**High**)
- Loop + per-row lookup/insert patterns:
  - `rollover-cron/route.ts:38-66`
  - `standing-cron/route.ts:53-77`
  - budget approval sibling loop (`cfo-approve/route.ts:113-136`)
- **Remediation**: batch reads and bulk upserts.

#### 4.5 Rate limiting absent (**High**)
- No centralized rate limiting middleware or per-route throttles found.
- **Remediation**: add edge/node limiter (IP + token/user), especially on auth and mutation endpoints.

#### 4.6 Minified/one-line maintainability issue persists (**Medium**)
- `src/app/api/budgets/resubmit/route.ts` is still single-line/minified.
- `cfo-approve` is now multiline (improved).
- **Remediation**: format `resubmit` and add lint/prettier guard.

---

### 5. Financial Calculation Consistency

#### 5.1 FX fallback inconsistency remains (**Critical/High**)
- SQL lagged revenue view uses `128.5` fallback (`00021_fix_lagged_revenue_views.sql:9,12`).
- Dashboard components default to `129.5` if setting missing:
  - `src/app/(dashboard)/_components/cfo-dashboard.tsx:205`
  - `src/app/(dashboard)/_components/project-manager-dashboard.tsx:89`
- **Remediation**: single source of truth (system setting + DB function/view reference).

#### 5.2 Outstanding invoice logic (`status==='paid'`) appears patched in key pages but not centralized (**High**)
- Invoices page and withdrawals page apply `paid => full paid` logic:
  - `src/app/(dashboard)/invoices/page.tsx:77,208-209`
  - `src/app/(dashboard)/withdrawals/page.tsx:95`
- Revenue page recomputes status from payment sums and can diverge from stored status (`src/app/(dashboard)/revenue/page.tsx:148-154`).
- **Remediation**: central helper for outstanding computation and use across all dashboards/reports.

#### 5.3 Lagged revenue model exists in DB views; partial client-side recomputation risk (**Medium**)
- Views exist and are used (`lagged_revenue_by_project_month`, `lagged_revenue_company_month`).
- Several report pages still combine/transform revenue with local assumptions (`reports/trends`, `monthly`, `projects`, `pnl`).
- **Remediation**: expose canonical server query API for lagged metrics.

#### 5.4 70/30 split not fully centralized (**High**)
- DB function uses 0.70/0.30 (`00004_functions.sql:366-369`).
- UI/report code reimplements split (`profit-share/page.tsx:180-181`, `reports/monthly/page.tsx:198-199`, `reports/trends/page.tsx:304,319,324,328`).
- **Remediation**: compute split once in DB or shared lib; prohibit ad hoc constants in pages.

#### 5.5 Budget-vs-actual calculation paths still fragmented (**High**)
- Separate logic in:
  - `reports/budget-vs-actual/page.tsx`
  - `expenses/variance/page.tsx`
  - `cfo-dashboard.tsx`
- **Remediation**: consolidate on one view/service and consistent variance formula/rounding.

#### 5.6 Rounding inconsistencies (`toFixed`) still widespread (**Medium**)
- Financial and KPI surfaces use mixed precision via `.toFixed(...)` across reports and APIs.
- **Remediation**: standard currency/percent formatter utility with fixed precision conventions.

---

### 6. Withdrawal & Payout Logic (Recent Changes)

#### 6.1 Withdrawal update route mostly enforces constraint intent, but branch naming is confusing (**Medium**)
- In `withdrawals/update`, `submittedType === 'operations'` still requires `director_tag` and `director_user_id` (`:69-73`) while `purpose` set to `company_operations` (`:129`).
- For `director_payout`, route clears `project_id/budget_id` and sets director fields (`:147-157`) — good.
- **Risk**: semantic mismatch between `operations` naming and director requirements.
- **Remediation**: align model names/validation with DB constraint language.

#### 6.2 DIRECTOR_TAG_MAP coverage is complete (**Low/Pass**)
- Map includes Kelvin/Evans/Dan/Gidraph/Victor (`withdrawals/update/route.ts:5-12`).

#### 6.3 Withdrawal form handles both modes but has type error and complexity risk (**High/Medium**)
- Supports both `company_operations` and `director_payout` flows; edit mode prefill logic present.
- Current TS error in this file indicates edge-case null state (`line ~608`).
- File size 785 LOC increases regression risk.
- **Remediation**: split into mode-specific subcomponents and typed discriminated unions.

#### 6.4 Payout dialog director coverage and optional PSR usage (**Pass/Medium**) 
- All 5 directors listed (`payout-dialog.tsx:29`).
- `profit_share_record_id` sent as nullable (`:115`).
- **Risk**: nullable PSR allows payouts without strict source linkage if backend permits.

#### 6.5 Legacy fix endpoint should be sunset pre-launch (**High**)
- `withdrawals/fix-legacy` executes SQL over service role and external endpoints (`:26-49`).
- With migrations present, endpoint is operational debt and attack surface.
- **Remediation**: remove/disable in production after one-time migration confirmation.

---

### 7. Client-Side Data Fetching & Performance

#### 7.1 Waterfall fetches and sequential chains remain (**Medium**)
- Multiple pages perform sequential dependent fetches where partial parallelization is possible (notably `misc`, `budgets/[id]`, `settings`, `revenue`).

#### 7.2 Unbounded `.select('*')` queries are widespread (**High**)
- Many client/server queries fetch all columns without range/limit.
- High-impact examples in dashboards and APIs: `misc`, `expense-lifecycle`, `cfo-dashboard`, notifications, budgets pages.
- **Remediation**: project only needed fields, add pagination/range for large tables.

#### 7.3 N+1 loops in client/data components (**High**)
- Similar looped query patterns in misc and budget workflows.
- **Remediation**: batch IDs and use `.in(...)` queries.

#### 7.4 Heavy import strategy mixed (**Medium**)
- `jspdf` often dynamically imported (good) (`reports/monthly`, `audit`, `lib/pdf-export`).
- `recharts` is statically imported across many client pages (bundle bloat risk).
- `xlsx` statically imported in API route (server-only acceptable).

#### 7.5 `useEffect` hygiene generally acceptable but needs lint enforcement (**Low/Medium**)
- No obvious infinite-loop anti-patterns found in sampled files; lack of working lint workflow reduces confidence.

---

### 8. UI/UX Completeness

#### 8.1 Error boundaries and 404 exist (**Pass**)
- `src/app/error.tsx`, `src/app/(dashboard)/error.tsx`, `src/app/not-found.tsx` all present and functional.

#### 8.2 Loading states coverage incomplete (**Medium**)
- Only `src/app/(dashboard)/loading.tsx` found.
- Most dashboard subroutes lack dedicated `loading.tsx` files.

#### 8.3 Empty states are inconsistent (**Medium**)
- Some tables have explicit no-data rows (good), others rely on blank sections/spinners.
- **Remediation**: standard empty-state component for all list/table screens.

#### 8.4 Mobile/table responsiveness risk in dense pages (**Medium**)
- Large table-heavy pages (`misc`, `expenses/queue`, `budgets/[id]`) likely to overflow on small screens; partial `overflow-x` handling exists but inconsistent.

#### 8.5 Accessibility gaps likely on icon-only actions (**High/Medium**)
- Many icon buttons use `title` but no explicit `aria-label`.
- Table captions not observed in shared table usage.
- **Remediation**: enforce aria labels for icon-only buttons and add captions/aria-describedby patterns.

---

### 9. Security

#### 9.1 Security headers still missing (**High**)
- `next.config.ts` and `vercel.json` do not define CSP, HSTS, X-Frame-Options, X-Content-Type-Options.
- **Remediation**: add standard headers in `next.config.ts` `headers()`.

#### 9.2 `dangerouslySetInnerHTML` not found (**Pass/Low**)
- No usage detected in `src/`.

#### 9.3 Secret exposure scan: no hardcoded keys found; env template appears placeholder (**Low**)
- `.env.local.example` uses placeholder service key string.

#### 9.4 CORS policy absent/implicit (**Medium**)
- No explicit CORS handling found; default same-origin is currently relied upon.
- **Risk**: future cross-origin clients may open routes inadvertently without strict allowlist.

#### 9.5 Service role key usage is server-side, but surface area is broad (**High**)
- Service key used in server/API modules only (`src/lib/supabase/admin.ts`, several API routes).
- High-risk endpoints using service role + weak auth include cron and legacy fix paths.
- **Remediation**: reduce service-role usage to minimal trusted routes; add strict auth on every route using it.

---

### 10. Code Quality & Maintainability

#### 10.1 Oversized files (>500 LOC) remain high (**High**)
- 15 files over 500 LOC (including `misc/page.tsx` at 2922 LOC, `expense-lifecycle/route.ts` 941 LOC, etc.).
- This is worse than prior 8-file count.

#### 10.2 Dead/fragile code indicators (**Medium**)
- Re-export alias route files for cron endpoints add indirection without value.
- Legacy fix endpoint likely obsolete.
- Single-line minified API file reduces maintainability.

#### 10.3 Duplicate business logic persists (**High**)
- Financial calculations repeated in multiple dashboard/report pages (FX fallback, outstanding, profit splits, variance).

#### 10.4 Test coverage still absent (**High**)
- No project tests found (`.test/.spec` under src).
- No vitest/jest config files present.

#### 10.5 CI/CD not configured in repo (**High**)
- No `.github/workflows/` files found.

#### 10.6 `console.log` remains in production route (**Low**)
- `src/app/api/director-payouts/route.ts:41` has `console.log(...)`.
- Keep `console.error`, remove non-essential logs.

---

### 11. Deployment & Infrastructure

#### 11.1 Environment variables referenced
Detected env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `EOD_SLACK_WEBHOOK_URL`
- `VERCEL_URL`

**Documentation check**: no centralized env documentation file found in this pass.

#### 11.2 Vercel cron configuration exists, but endpoint hardening incomplete (**High**)
- Cron jobs in `vercel.json`:
  - `/api/eod/auto-send`
  - `/api/misc-draws/create-monthly`
  - `/api/expense-lifecycle/rollover-carry-forward`
- Security parity is inconsistent (see Category 2).

#### 11.3 Middleware → Proxy migration pending (**Medium**)
- Next 16 warns on deprecated middleware convention.
- Migration path:
  1. Rename `middleware.ts` → `proxy.ts`
  2. Rename exported `middleware` function → `proxy`
  3. Run codemod and validate matcher behavior.

#### 11.4 Node version is documented and enforced (**Pass/Low**)
- `package.json` engines: `>=20.9.0 <25`.

---

## Previous Audit Status

Interpreted 13 priority items from prior architecture audit (critical risks + priority actions):

| Item | Status | Notes |
|---|---|---|
| 1) Client-side PIN suffix auth logic | **Unfixed** | Still `pin + 'io'` in login page. |
| 2) Unauthenticated/weakly protected cron trigger(s) | **Partially Fixed** | Some secret checks added; still optional and not universal. |
| 3) FX fallback inconsistency (128.5 vs 129.5/settings) | **Unfixed** | Still split between SQL views and dashboard defaults. |
| 4) Duplicate migration numbering (`00013`) | **Unfixed** | Collision still present. |
| 5) Trigger/function/policy idempotency hardening | **Unfixed** | Many unconditional CREATE statements remain. |
| 6) Consolidate budget/variance/profit formulas | **Unfixed** | Multiple independent computation paths remain. |
| 7) API rate limiting | **Unfixed** | No rate limiting detected. |
| 8) Standardized API error envelope across all routes | **Partially Fixed** | Some routes use `apiErrorResponse`, inconsistent adoption. |
| 9) Oversized-file refactor | **Unfixed (regressed)** | >500 LOC file count increased. |
| 10) Lint/type gate stabilization | **Partially Fixed** | Build works but types are ignored; next lint invocation broken. |
| 11) Security headers (CSP/HSTS/etc.) | **Unfixed** | Still absent. |
| 12) Route auth consistency across APIs | **Partially Fixed** | Many routes now use `getAuthUserProfile`, cron/auth gaps persist. |
| 13) Month-close/edit-prevention enforcement clarity | **Partially Fixed** | Some guarded APIs exist; not uniformly proven for all mutation paths. |

## Production Readiness Prompts Status

| Phase / Prompt | Status | Evidence |
|---|---|---|
| 1) Error boundaries & global handling | **Partially Completed** | Error boundaries exist; API try/catch not universal; toasts inconsistent. |
| 2) Input validation with Zod | **Not Started** | No broad Zod adoption detected in API routes. |
| 3) Security headers & CSRF | **Not Started** | Headers/CSRF/rate-limit middleware not implemented. |
| 4) Loading states & skeletons | **Partially Completed** | Dashboard-level loading exists; subroute coverage largely missing. |
| 5) Logging/monitoring/audit trail | **Partially Completed** | `audit_logs` usage exists; no structured logger/monitoring system. |
| 6) Testing infrastructure & core tests | **Not Started** | No vitest/jest config or tests found. |
| 7) CI/CD pipeline | **Not Started** | No GitHub workflow files found. |
| 8) Performance optimization & query hygiene | **Partially Completed** | Some dynamic imports, but many select* and N+1 patterns remain. |
| 9) Financial consistency hardening | **Partially Completed** | Some invoice status fixes present; major drift points remain. |
| 10) Pre-launch hardening cleanup | **Not Started** | Legacy endpoints/minified file/security controls not fully cleaned. |

## Prioritized Fix List

1. **Move PIN auth derivation server-side and remove client `pin + 'io'`** — Severity: Critical — Effort: **M**.
2. **Disable `ignoreBuildErrors`, fix current TS error, enforce `tsc --noEmit` in CI** — Critical — Effort: **S/M**.
3. **Harden all cron endpoints (fail-closed secret + POST-only + auth logging)** — High — Effort: **S/M**.
4. **Unify FX fallback and financial formulas (shared service/view)** — High — Effort: **M/L**.
5. **Fix duplicate migration numbering and add idempotent guards** — High — Effort: **M/L**.
6. **Enable RLS + policies for uncovered tables** — High — Effort: **M**.
7. **Introduce Zod validation + standardized API error envelopes** — High — Effort: **M**.
8. **Add API rate limiting and baseline security headers** — High — Effort: **M**.
9. **Remove/disable `withdrawals/fix-legacy` endpoint for production** — High — Effort: **S**.
10. **Refactor large monolith files and minified route file** — Medium — Effort: **L**.
11. **Add tests (unit + route-level) and CI workflows** — High — Effort: **M/L**.
12. **Audit accessibility: icon-button aria-labels + table captions** — Medium — Effort: **M**.

## Appendix A — Raw Command Output

### A.1 `npx tsc --noEmit`
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
src/components/withdrawals/withdrawal-form-dialog.tsx(608,43): error TS18047: 'value' is possibly 'null'.
```

### A.2 `npx next lint`
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
Invalid project directory provided, no such directory: /workspace/io-finance-hub/lint
```

### A.3 `npx next build`
```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry

▲ Next.js 16.2.2 (Turbopack)

⚠ The "middleware" file convention is deprecated. Please use "proxy" instead. Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  Creating an optimized production build ...
✓ Compiled successfully in 33.7s
  Skipping validation of types
  Finished TypeScript config validation in 8ms ...
  Collecting page data using 2 workers ...
  Generating static pages using 2 workers (0/68) ...
  Generating static pages using 2 workers (17/68)
  Generating static pages using 2 workers (34/68)
  Generating static pages using 2 workers (51/68)
✓ Generating static pages using 2 workers (68/68) in 3.8s
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
├ ƒ /api/withdrawals/fix-legacy
├ ƒ /api/withdrawals/update
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
