# IO Finance Hub — Production Readiness Codex Prompts

Run these prompts in order. Each produces a single PR. Wait for each to merge before running the next — some depend on earlier work.

---

## Phase 1: Safety & Stability (Run First)

### Prompt 1 — Error Boundaries & Global Error Handling

```
In the IO Finance Hub Next.js 16 app, add comprehensive error handling:

1. Create `src/app/error.tsx` — a global error boundary component that:
   - Catches runtime errors across all dashboard routes
   - Shows a user-friendly "Something went wrong" card with a "Try again" button
   - Logs the error to console with stack trace for debugging
   - Uses the existing design system (Tailwind, shadcn/ui components)

2. Create `src/app/not-found.tsx` — a custom 404 page that:
   - Shows a friendly "Page not found" message
   - Includes a "Back to Dashboard" link
   - Matches the app's visual style

3. Create `src/app/(dashboard)/error.tsx` — a dashboard-specific error boundary that:
   - Preserves the sidebar and navigation layout
   - Only replaces the main content area with the error message

4. Add try-catch wrappers with user-friendly error states to every API route in `src/app/api/`:
   - Return proper HTTP status codes (400 for bad input, 401 for auth, 500 for server errors)
   - Return JSON error responses in the format: { error: string, code: string }
   - Never expose raw Supabase/Postgres errors to the client

5. Add error toast notifications to data-fetching hooks in dashboard pages — when a Supabase query fails, show a toast rather than crashing.

Read `node_modules/next/dist/docs/` before writing any code — this is Next.js 16 with breaking changes.
Run lint and build when done.
```

### Prompt 2 — Input Validation with Zod

```
Add Zod schema validation to every API route and form submission in the IO Finance Hub.

1. Install zod: `npm install zod`

2. Create `src/lib/validations/` with schema files:
   - `expenses.ts` — schemas for expense import, expense creation, expense approval
   - `invoices.ts` — schemas for invoice creation, payment recording
   - `budgets.ts` — schemas for budget submission, budget version creation
   - `misc-draws.ts` — schemas for misc draw requests
   - `auth.ts` — schemas for login, profile updates
   - `common.ts` — shared schemas (uuid, yearMonth format "YYYY-MM", currency amounts, pagination params)

3. Apply validation at the top of every POST/PUT/PATCH API route handler:
   - Parse request body with the appropriate Zod schema
   - On validation failure, return 400 with { error: "Validation failed", details: zodError.flatten() }
   - On success, use the typed parsed data (not raw request body) for all downstream operations

4. Add client-side validation to form components:
   - Use the same Zod schemas to validate before submission
   - Show inline field errors using the existing form UI patterns

5. Create a shared helper `src/lib/api-utils.ts`:
   - `validateRequest(schema, body)` — returns typed data or throws ApiError
   - `ApiError` class with status code and structured error response
   - `withValidation(schema, handler)` — HOF wrapper for route handlers

Ensure all currency amounts are validated as non-negative numbers.
Ensure all year_month fields match the pattern /^\d{4}-\d{2}$/.
Ensure all UUIDs are validated as proper UUID v4 format.
Run lint and build when done.
```

### Prompt 3 — Security Headers & CSRF Protection

```
Harden the IO Finance Hub security posture:

1. In `next.config.ts`, add security headers:
   - Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://*.supabase.in
   - X-Frame-Options: DENY
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin
   - X-XSS-Protection: 1; mode=block
   - Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   - Permissions-Policy: camera=(), microphone=(), geolocation=()

2. In `src/middleware.ts`, strengthen auth protection:
   - Explicitly define public routes (login, auth callback) vs protected routes
   - Redirect unauthenticated users to /login for any dashboard route
   - Validate that the Supabase session is not expired before allowing access
   - Add rate limiting headers: X-RateLimit-Limit, X-RateLimit-Remaining (use in-memory counter per IP, 100 req/min for API routes, 300 req/min for pages)

3. Sanitize all user inputs that are rendered in the UI:
   - Audit every place where user-provided text (project names, notes, descriptions) is rendered
   - Ensure React's default XSS protection is not bypassed (no dangerouslySetInnerHTML)

4. Add CSRF token validation for all mutating API routes (POST/PUT/DELETE):
   - Generate a CSRF token in the middleware and set it as a cookie
   - Validate the token on every mutating request

Read `node_modules/next/dist/docs/` before writing any code — this is Next.js 16 with breaking changes.
Run lint and build when done.
```

---

## Phase 2: Reliability & Observability

### Prompt 4 — Loading States & Skeleton Screens

```
Add proper loading states across the entire IO Finance Hub:

1. Create `src/app/(dashboard)/loading.tsx` — a dashboard-level loading state:
   - Shows skeleton placeholders matching the dashboard layout (sidebar stays, content area shows pulse skeletons)
   - Use the existing `src/components/ui/skeleton.tsx` component

2. Add `loading.tsx` to every dashboard sub-route:
   - `src/app/(dashboard)/reports/loading.tsx`
   - `src/app/(dashboard)/reports/monthly/loading.tsx`
   - `src/app/(dashboard)/reports/pnl/loading.tsx`
   - `src/app/(dashboard)/reports/profitability/loading.tsx`
   - `src/app/(dashboard)/reports/trends/loading.tsx`
   - `src/app/(dashboard)/reports/budget-vs-actual/loading.tsx`
   - `src/app/(dashboard)/reports/projects/loading.tsx`
   - `src/app/(dashboard)/expenses/loading.tsx`
   - `src/app/(dashboard)/revenue/loading.tsx`
   - `src/app/(dashboard)/settings/loading.tsx`
   Each loading.tsx should show skeletons that match the actual page layout shape.

3. Add loading states to data-fetching components:
   - Every component that calls Supabase should show a skeleton/spinner while data loads
   - Tables should show skeleton rows (5 rows of pulsing bars matching column widths)
   - Charts should show a placeholder rectangle with a pulse animation
   - KPI cards should show skeleton number placeholders

4. Add empty states:
   - When a query returns zero results, show a friendly empty state illustration/message
   - "No expenses found for this month" with a suggestion to import or add expenses
   - "No invoices yet" with a CTA to create one

Run lint and build when done.
```

### Prompt 5 — Logging, Monitoring & Audit Trail

```
Add production observability to the IO Finance Hub:

1. Create `src/lib/logger.ts` — a structured logging utility:
   - Log levels: debug, info, warn, error
   - Each log entry includes: timestamp, level, message, userId (if available), route, metadata
   - In development: pretty-print to console
   - In production: output JSON format (compatible with Vercel's log drain)
   - Export: logger.info(), logger.warn(), logger.error(), logger.debug()

2. Add logging to every API route:
   - Log incoming requests: method, path, userId, request size
   - Log successful responses: status code, response time in ms
   - Log errors: error message, stack trace, request context
   - Log authentication failures separately with IP and attempted route

3. Enhance the existing `audit_logs` database table usage:
   - Create `src/lib/audit.ts` with helper: `logAudit(userId, action, entityType, entityId, metadata)`
   - Add audit logging for all critical financial operations:
     * Expense approved/rejected
     * Invoice created/updated/paid
     * Budget submitted/approved
     * Misc draw requested/approved
     * User role changed
     * Report exported/downloaded
     * Settings changed

4. Create a `src/app/(dashboard)/settings/audit-log/page.tsx`:
   - Show a paginated, filterable table of audit log entries
   - Filter by: action type, user, date range, entity type
   - Only visible to CFO and admin roles
   - Display: timestamp, user, action, entity, details

5. Add performance monitoring:
   - Track page load times using the Web Vitals API (Next.js built-in)
   - Log slow API responses (>2 seconds) as warnings
   - Log database query times in API routes

Run lint and build when done.
```

---

## Phase 3: Testing & CI/CD

### Prompt 6 — Testing Infrastructure & Core Tests

```
Set up a testing infrastructure for the IO Finance Hub and write core tests:

1. Install testing dependencies:
   npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react

2. Create `vitest.config.ts` at the project root:
   - Configure jsdom environment
   - Set up path aliases matching tsconfig
   - Add setup file for @testing-library/jest-dom matchers

3. Create `vitest.setup.ts`:
   - Import @testing-library/jest-dom
   - Mock next/navigation (useRouter, usePathname, useSearchParams)
   - Mock @supabase/ssr createBrowserClient

4. Add test scripts to package.json:
   - "test": "vitest run"
   - "test:watch": "vitest"
   - "test:coverage": "vitest run --coverage"

5. Write unit tests for critical business logic:
   - `src/lib/__tests__/report-utils.test.ts` — test getUnifiedServicePeriodLabel, currency formatting, date calculations
   - `src/lib/__tests__/validations.test.ts` — test all Zod schemas with valid and invalid inputs (if validations exist from a prior PR, otherwise skip)

6. Write API route tests:
   - `src/app/api/expenses/__tests__/route.test.ts` — test import endpoint with valid/invalid CSV data
   - `src/app/api/eod/__tests__/route.test.ts` — test EOD automation endpoint
   - Mock Supabase client responses for each test

7. Write component tests for critical UI:
   - Test the login flow component renders and handles form submission
   - Test the expense import dialog validates file type
   - Test the KPI cards render correct formatted values
   - Test the role-based visibility (restricted user sees only their projects)

8. Aim for at least 40% coverage on src/lib/ and src/app/api/ directories.

Run all tests and ensure they pass. Run lint and build when done.
```

### Prompt 7 — GitHub Actions CI Pipeline

```
Set up a GitHub Actions CI/CD pipeline for the IO Finance Hub:

1. Create `.github/workflows/ci.yml`:
   - Trigger on: push to main, pull_request to main
   - Node.js 20.x
   - Steps:
     a. Checkout code
     b. Install dependencies (npm ci)
     c. Run linter (npm run lint)
     d. Run type check (npx tsc --noEmit)
     e. Run tests (npm test) — if test suite exists
     f. Run production build (npm run build)
   - Cache node_modules between runs using actions/cache
   - Fail the pipeline if any step fails

2. Create `.github/workflows/preview.yml`:
   - Trigger on: pull_request
   - Add a comment to the PR with the Vercel preview URL
   - Run a lightweight check: lint + typecheck only (build is handled by Vercel)

3. Create `.github/pull_request_template.md`:
   - Sections: Summary, Changes, Testing, Screenshots (if UI), Checklist
   - Checklist items:
     * [ ] Lint passes
     * [ ] Types check
     * [ ] Tests pass (if applicable)
     * [ ] No console.log statements left
     * [ ] Supabase migrations included (if DB changes)
     * [ ] Tested locally with different user roles

4. Add branch protection recommendation in a CONTRIBUTING.md:
   - Require CI to pass before merge
   - Require at least 1 review (recommended)

Run lint and build when done.
```

---

## Phase 4: Performance & Polish

### Prompt 8 — Performance Optimization

```
Optimize the IO Finance Hub for production performance:

1. Add data caching to API routes:
   - Use Next.js 16 caching mechanisms for read-heavy endpoints
   - Cache project lists, budget data, and forex rates (revalidate every 5 minutes)
   - Do NOT cache user-specific data or real-time data (expenses, invoices)

2. Add pagination to all list endpoints and table views:
   - Expenses list: paginate at 50 per page with cursor-based pagination
   - Invoices list: same
   - Audit logs: same
   - All Supabase queries that could return unbounded results must have .range() applied

3. Optimize bundle size:
   - Audit imports — ensure no barrel file imports pulling entire libraries
   - Use dynamic imports for heavy components:
     * Chart components (recharts) — lazy load with next/dynamic
     * PDF export functionality — lazy load
     * Rich text editors if any — lazy load
   - Add `"sideEffects": false` to package.json if appropriate

4. Optimize images and fonts:
   - Use next/font for Google Fonts (avoid external font fetch at runtime)
   - Ensure all images use next/image with proper width/height

5. Add Supabase query optimization:
   - Ensure all queries select only needed columns (no SELECT *)
   - Add .limit() to all queries that don't already have it
   - Use .single() for queries that should return exactly one row

6. Add a `src/lib/cache.ts` utility:
   - In-memory cache with TTL for frequently accessed data (user profile, project list)
   - Auto-invalidate on mutations

Read `node_modules/next/dist/docs/` for Next.js 16 caching patterns.
Run lint and build when done.
```

### Prompt 9 — Database Hardening & Missing Migrations

```
Audit and harden the Supabase database for the IO Finance Hub:

1. Check all existing migrations in supabase/migrations/ (00001 through 00013) and verify the database schema is complete. Create a new migration `00014_production_hardening.sql` that:

   a. Adds missing indexes for common query patterns:
      - expenses(project_id, year_month) composite index
      - invoices(project_id, year_month) composite index
      - audit_logs(user_id, created_at) composite index
      - budget_versions(budget_id, status) composite index

   b. Adds CHECK constraints for data integrity:
      - expenses.amount_kes >= 0
      - invoices.amount_usd >= 0
      - invoices.balance_outstanding >= 0
      - forex_rates.rate > 0

   c. Adds NOT NULL constraints where appropriate:
      - Ensure critical FK columns that should never be null have NOT NULL

   d. Reviews all RLS policies — ensure:
      - Every table has RLS enabled
      - service_role has full access on all tables
      - authenticated users have appropriate read/write per table
      - No table is accidentally fully open

   e. Creates a database function `fn_cleanup_expired_sessions()` for housekeeping

2. Create `supabase/sql/production_indexes.sql` with all the index creation statements (idempotent with IF NOT EXISTS).

3. Verify all views created in migration 00009 still work correctly after recent schema changes.

Use IF NOT EXISTS and DO $$ BEGIN...EXCEPTION...END $$ guards for all DDL to make the migration idempotent.
Run lint when done.
```

### Prompt 10 — Accessibility & Mobile Responsiveness

```
Make the IO Finance Hub accessible and mobile-friendly:

1. Accessibility audit and fixes:
   - Add proper aria-labels to all icon-only buttons (sidebar toggle, notification bell, settings gear)
   - Ensure all form inputs have associated <label> elements
   - Add aria-live="polite" to toast notifications and loading states
   - Ensure color contrast meets WCAG AA (4.5:1 for text, 3:1 for large text)
   - Add keyboard navigation support: all interactive elements must be reachable via Tab
   - Add focus-visible styles to all interactive elements
   - Ensure data tables have proper <caption>, <thead>, <th scope="col"> markup
   - Add skip-to-content link at the top of the layout

2. Mobile responsiveness:
   - Make the sidebar collapsible/drawer on screens < 768px
   - Make all data tables horizontally scrollable on mobile
   - Stack KPI hero cards vertically on mobile (1 column instead of 3-4)
   - Ensure charts resize properly on small screens
   - Make the PDF export button and other action bars responsive
   - Test all form modals work on mobile viewports

3. Add `prefers-reduced-motion` media query support:
   - Disable skeleton pulse animations
   - Disable chart transitions
   - Disable any CSS animations

Run lint and build when done.
```

---

## Execution Order Summary

| Priority | Prompt | What It Does | Risk if Skipped |
|----------|--------|-------------|-----------------|
| P0 | 1 - Error Boundaries | Prevents white screens on errors | Users see crashes |
| P0 | 2 - Zod Validation | Prevents bad data in DB | Data corruption |
| P0 | 3 - Security Headers | Prevents XSS, clickjacking | Security breach |
| P1 | 4 - Loading States | Professional UX | App feels broken |
| P1 | 5 - Logging & Audit | See what's happening | Blind to failures |
| P1 | 9 - DB Hardening | Data integrity | Bad data creep |
| P2 | 6 - Testing | Catch regressions | Bugs in prod |
| P2 | 7 - CI Pipeline | Automated quality gates | Bad code merges |
| P2 | 8 - Performance | Fast load times | Slow app |
| P3 | 10 - A11y & Mobile | Inclusive UX | Excludes users |
