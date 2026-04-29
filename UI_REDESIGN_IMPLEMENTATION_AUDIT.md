# IO Finance Hub — UI Redesign Implementation Audit

**Authored:** 2026-04-29 (Night 2 marathon, post-design-handoff)
**Source design package:** `IO_Finance_Hub_Design_System__1_.zip` (Claude Design output)
**Codebase target:** `Kelvin-Njuguna95/io-finance-hub` @ `main`

---

## 1. What Claude Design produced

A complete design system + 14 page mockups, all light-mode HTML with the `colors_and_type.css` token sheet that mirrors your existing `globals.css`. The work follows your `.impeccable.md` rules faithfully — paper + ink + gold, Fraunces + Geist + Geist Mono, 4 radius stops, single shadow, treasury register copy, no emoji, italic only for accent phrases inside display headings.

**Pages delivered:**

| Page | File | Status in your codebase |
|---|---|---|
| CFO dashboard | `dashboard.html` | Exists (`cfo-dashboard.tsx`, 497 LOC) — shipped |
| Budgets list | `budgets.html` | Exists (`budgets/page.tsx`) |
| Budget detail | `budget-detail.html` | Exists (`budgets/[id]/page.tsx`) |
| Budget new | `budget-new.html` | Exists (form dialog) |
| Expenses list | `expenses.html` | Exists |
| Expense queue | `expense-queue.html` | Exists (`expense-queue-panel.tsx`) |
| Expense new | `expense-new.html` | Exists (form dialog) |
| Invoices list | `invoices.html` | Exists |
| Invoice detail | `invoice-detail.html` | Exists |
| Invoice new | `invoice-new.html` | Exists (form dialog) |
| Invoice import (backdate) | `invoice-import.html` | Exists |
| Withdrawals list | `withdrawals.html` | Exists |
| Withdrawal new | `withdrawal-new.html` | Exists (form dialog) |
| Chart vocabulary | `chart-vocabulary.html` | New — specimen sheet for chart styling |

**Pages NOT in the design package (still need design or will be deferred):**

- Reports & Analytics — 8 pages (`reports/monthly`, `reports/profitability`, `reports/trends`, `reports/budget-vs-actual`, `reports/budget-accuracy`, `reports/outstanding`, `reports/projects`, `reports/pnl`). The chart vocabulary specimen exists; the actual report pages do not. **Decision:** chart vocabulary is the leverage — reports become layout-around-charts which Claude Code can produce from the spec without needing a design pass.
- Profit share — distributable profit overview + payout flow. Not in package.
- EOD reports — list + detail.
- Audit trail — timeline view.
- Agent counts — calendar/entry view.
- Settings — profile / preferences / system tabs.
- Notifications panel — bell popover detail.

**Implication:** the design package covers the high-traffic operational pages. The system / reference pages (audit trail, settings, EOD, agent counts) and the reports pages will be implemented from the established visual vocabulary without needing additional Claude Design rounds. This is correct prioritization — those pages are derivative, not novel.

---

## 2. Architecture compatibility — what fits, what needs translation

The design system is genuinely well-aligned with your codebase. It uses your real tokens (`--paper`, `--ink`, `--gold`, `--success-soft`, etc.), respects your radius stops, follows your spacing grid, and uses the exact font families you've already loaded. **Most of the translation work is layout + JSX, not visual decision-making.**

**Direct mappings (zero translation friction):**

- All color tokens in the design system match your `globals.css` exactly. The CSS file produced (`colors_and_type.css`) is essentially a clean re-export of what you already have.
- Eyebrow → `eye` class in design ↔ existing eyebrow pattern in your `StatCard`, `SectionCard`, `PageHeader`.
- Stat-card structure (eyebrow / value / delta) ↔ your existing `StatCard` (200 LOC). The design's stat cards can be implemented by extending `StatCard` with optional sparkline/ring slots.
- Section card pattern ↔ your existing `SectionCard` (126 LOC).
- Hero card pattern ↔ your existing `HeroCard` (153 LOC).
- Sidebar structure ↔ already shipped in `app-sidebar.tsx` (229 LOC) — design's sidebar matches what you have, just refines the visual order/labels of menu items.
- Topbar ↔ already shipped in `dashboard-topbar.tsx` (141 LOC).
- Status pills ↔ shadcn `Badge` with your existing `success-soft` / `danger-soft` / `gold-soft` / `muted` variants.

**Translation needed (mechanical):**

- Design uses raw HTML classes (`.app-shell`, `.side`, `.main`, `.crumbs`, `.eye`, `.value`, `.label`, `.btn-gold`). These need to become Tailwind utility classes inside React components, or extracted into your existing component primitives where possible.
- Design uses inline `<style>` blocks per page. Production needs everything in `globals.css` or component-scoped via Tailwind.
- Italic headline accents (`<h1>Budgets <em>& commitments</em></h1>`) need consistent treatment — likely a small `<PageTitle>` component that takes a primary phrase + accent phrase.

**Architectural mismatches (real, need attention):**

These are places where the design assumes data or behavior your codebase doesn't have, or names things differently. Each needs a decision before implementation.

1. **Dashboard "Cash runway" KPI (9.4 mo)** — the design adds a runway KPI calculated as `bank_balance / monthly_burn_rate`. This metric does not exist in your codebase today. Either: (a) compute it client-side from existing data (bank_balance from `useBankBalance`, burn from rolling expense average), or (b) defer until you decide the formula. **Recommendation:** implement (a) with a simple formula: `bank_balance_kes / avg(last 3 months total_costs_kes)`. Mark it as approximate with the `≈` prefix to be safe.

2. **Dashboard "Money owed to us" KPI (KES 4.86M)** — this is outstanding receivables, which you already have via the `OutstandingReceivablesPanel`. The design surfaces it as a KPI stat. Easy — extract the total from the existing query, expose via a new `useOutstandingReceivables` hook.

3. **Dashboard "Committed capital" KPI (KES 8.92M)** — this is total approved budget across active projects. Similar pattern: existing data, new KPI surface.

4. **Dashboard "Recent activity" panel** — design shows recent transactions feed. You don't have this hook today. Implementation: new `useRecentActivity` hook that UNIONs recent withdrawals + recent expenses + recent invoice events from `audit_logs`, ordered by `created_at DESC LIMIT 8`.

5. **"Profit by project" rail** — design shows per-project net profit with a horizontal bar showing margin %. You have `project_profitability` table for this. Easy — query the latest `year_month`, render top 4-5 projects.

6. **"Pending invoices" rail content** — design shows specific invoice rows with INV-numbers, project names, due dates, status pills. Your invoices table has all this. Easy translation.

7. **"Month closure · April 2026 in progress / 9 of 12 sign-offs complete · 3 days to lock"** sidebar widget — the "sign-offs" workflow doesn't exist in your codebase as far as the audit trail shows. **Decision needed:** is this a future feature you want to build, or should the closure widget show something simpler (just "Service period: April 2026 · in progress, locks May 5")? **Recommendation:** simplify to status + lock-date. Don't invent a sign-off workflow that doesn't exist.

8. **Budget detail "Approval timeline"** — design shows a vertical timeline of state transitions (TL submitted → PM approved → CFO reviewed). Your audit_logs table captures this; rendering it as a timeline is new UI but uses existing data. Translation: query `audit_logs` filtered to `entity_type='budget' AND entity_id=$id`.

9. **Invoice detail "Payment history"** — design shows a payment timeline. You have `payments` table. Direct translation.

10. **Withdrawals "exchange rate" display** — design shows historical FX rate with the withdrawal. Your `withdrawals.exchange_rate` column has this. Direct translation. (Note: tonight's F-32.1 work — the forex_rates backfill — is unrelated to this UI; the UI uses the per-withdrawal rate, not the per-month forex_rates aggregate.)

11. **Sidebar "Red flags" count** — design shows a danger-colored count badge ("3"). You have `red_flags` table. Easy hook.

12. **Sidebar "Budgets" count badge ("7")** — count of pending budget reviews. Easy from `budget_versions` filtered to `status='submitted'`.

**Wording adjustments I'd recommend (treasury register, not marketing):**

| Design says | Suggest |
|---|---|
| "Good morning, Anne" | Keep — but make the name dynamic from `user.first_name`, fall back to "Good {morning/afternoon/evening}" |
| "Money owed to us" | "Outstanding receivables" — your codebase already uses this term consistently |
| "Cash runway" | Keep — it's a treasury-standard term |
| "Committed capital" | "Approved budget" — matches your enum/UI vocabulary |
| "Pending invoices" | Keep |
| "Profit by project" | Keep |
| "Recent activity" | Keep |
| "Budgets & commitments" | "Budgets" — drop the marketing flourish; one word matches your sidebar |
| "Expenses & receipts" | "Expenses" |
| "Invoices & receivables" | "Invoices" |
| "Withdrawals & director draws" | "Withdrawals" |
| "Review expenses · 14 awaiting" | "Expense queue · 14 awaiting" — matches your existing route |
| "Backdate historical invoices" | "Import historical invoices" — your existing UI says "Backdate entry"; keep one term |

**Recommendation:** keep the italic accent treatment (`<em>` styling) but simplify the accent phrase to a meaningful subtitle, not a marketing flourish. So "Budgets <em>· 7 pending review</em>" instead of "Budgets <em>& commitments</em>".

---

## 3. Feature additions worth considering

Tonight's design package opens the door to several useful additions. None are required to ship the redesign, but each is small enough to consider.

**A. Dashboard hero — service period progress band.** A small horizontal bar above the KPIs showing where the current month sits in its lock cycle (e.g., "April 2026 · day 21 of 30 · locks May 5"). Reads at a glance whether closure pressure is high. Trivial to compute client-side from `new Date()` and the standard month-lock convention.

**B. Dashboard "Action required" rail addition.** The design shows pending invoices and recent activity. A third rail item — "Action required" — would consolidate items that need the CFO specifically: pending budget approvals, pending payouts, overdue red flags. Each is already queryable; the rail just aggregates. Worth ~30 min once the dashboard layout is shipped.

**C. Universal cmdK search (the search bar in the topbar).** Design shows a search input in the topbar but it currently doesn't function. Wiring it to a basic search across budgets, invoices, and expenses (by ID or project name) would close a real workflow gap. Defer — out of scope for the visual redesign session, but flag it.

**D. Inline approval actions on dashboard.** The "Pending invoices" rail could include hover-reveal "Mark sent" / "Mark paid" buttons. Same pattern would apply to expense queue items. Useful but adds complexity to each rail; defer to a follow-up session.

**E. Service period selector globally.** Currently each report page has its own period selector. Promoting it to the topbar (next to the search) would let one period choice apply across the whole app. Worth doing but again, out of scope for the visual redesign.

**F. Dashboard "What changed since yesterday" digest.** A small narrative block: "Yesterday: 3 expenses approved, 1 invoice marked paid, 1 budget submitted for review." Useful for catching up on a fresh shift. Computed from `audit_logs` filtered to `created_at > now() - interval '24 hours'`. Worth ~45 min if you want it.

**My picks for tonight's remaining time:** A (service period progress band — 15 min) and B (Action required rail — 30 min). Both real value, both buildable inside the dashboard implementation pass.

---

## 4. Implementation order — the master plan

This is the order I'd recommend executing the redesign. Each phase is its own session arc; some can be combined depending on energy.

**Phase 1 — Visual primitives layer (1 session, ~2-3h)**
- Update `src/components/ui/badge.tsx` if needed for new pill variants (gold-soft, semantic variants already exist).
- Update `src/components/layout/stat-card.tsx` to add optional `sparkline` and `ring` slots per the design.
- Add new `src/components/layout/page-title.tsx` component implementing the serif + italic-gold-accent treatment.
- Add new `src/lib/charts/chart-theme.ts` with the chart vocabulary tokens (axis style, grid style, tooltip style, line weights, area gradients).
- Run `npm run build`, verify zero regressions.
- Commit. This phase is foundation; nothing visible changes yet.

**Phase 2 — CFO dashboard (1 session, ~3h)**
- New layout shell with 2-column grid + right-rail.
- 6 KPI cards in 2 rows of 3 (matching design).
- New `useOutstandingReceivables`, `useApprovedBudget`, `useCashRunway`, `useRecentActivity`, `useProfitByProject` hooks.
- Hero chart (Revenue & spending trend) using the locked chart vocabulary.
- Right-rail: Pending invoices + Profit by project + (optionally) Action required.
- Service period progress band (Feature A).
- Mobile fallback: rail collapses below main column.
- Commit + screenshot review.

**Phase 3 — Operational list pages (2 sessions, ~2h each)**
- Session 3a: Budgets list + detail + new-budget form.
- Session 3b: Expenses list + queue + variance + new-expense form.
- Session 3c (optional combine): Invoices list + detail + new + import.
- Session 3d (optional combine): Withdrawals list + new.
- Each gets the page-title treatment, the paper-feel row pattern, status pills, generous spacing.

**Phase 4 — Reports & Analytics (1-2 sessions, ~3-4h total)**
- All 8 report pages get the page-title treatment + chart vocabulary applied.
- Migrate from bare Recharts to your existing `ChartContainer` wrapper consistently.
- Each report gets a quiet executive summary card at the top.
- Trends page first (highest chart density, sets the bar), then the rest.

**Phase 5 — System pages (1 session, ~2h)**
- Audit trail timeline view.
- EOD reports list + detail.
- Agent counts calendar view.
- Settings page (3 tabs).
- Notifications panel polish.

**Phase 6 — Profit share + final polish (1 session, ~1.5h)**
- Profit share overview + payout flow.
- Cross-page consistency pass.
- Mobile testing across all pages.
- Final commit + a comprehensive PR description summarizing the whole redesign.

**Total realistic effort:** 14-18 hours across 5-7 sessions. NOT a one-night task even at full pace.

---

## 5. Risk callouts

**1. Financial logic is downstream of UI in this redesign.** Every page change must preserve hooks, queries, and RPC calls exactly. The redesign is a JSX shell rewrite; the data layer doesn't move. Verify after each page that the existing hooks still feed the new UI cleanly.

**2. The `cfo-dashboard.tsx` file is 497 LOC.** Replacing its layout means careful diffing — extract any inline logic to hooks first, then replace JSX, then verify against original behavior. Don't rewrite from scratch.

**3. Chart migration is more invasive than it looks.** Every reports page currently uses bare Recharts with per-page styling. Migrating to ChartContainer means touching axis configs, tooltip configs, legend rendering, and possibly tooltip prop typing. Plan for friction.

**4. Form dialogs (new-budget, new-expense, new-invoice, new-withdrawal) are tightly coupled to validation logic.** The redesign is purely visual — DON'T change validation, submission flow, or field semantics. Replace JSX, keep handlers.

**5. shadcn primitives are the substrate.** Don't replace shadcn components with raw HTML to match the design's class structure. Re-skin the shadcn components via your tokens, or use the design's class names as Tailwind utilities applied to shadcn.

**6. The `eslint` errors / warnings count is currently 9030 (171 errors).** Tonight's TS gate flip kept the build clean, but lint is still noisy. UI redesign work will likely add to this if not careful. After Phase 2 and Phase 3, run `npm run lint` and triage.

**7. Tonight's TS gate is now strict (`ignoreBuildErrors: false`).** Any new component with type errors will fail the build. Plan for explicit prop typing on every new component.

---

## 6. Tonight's remaining-shift recommendation

You have ~3 hours left. Here's the cleanest cut:

- **Extract the design package into the repo** as `_design-system/` (read-only reference). 5 min.
- **Phase 1: visual primitives** — extend `StatCard`, add `PageTitle`, add `chart-theme.ts`. 1.5h.
- **First slice of Phase 2: dashboard layout shell + hero KPIs only** (the 6 stat cards, no chart yet, no right rail). 1h. Ship to prod.
- **Stop.** Phase 2 chart + right rail tomorrow on fresh eyes.

This gets you visible progress (the dashboard's stat cards alone are the highest-leverage visual change), it ships clean, and it preserves the rest of the redesign for sessions where you have full energy.

The alternative — trying to push through the full dashboard tonight — risks a half-finished commit, late-shift judgment errors, and a UI your directors see before you've reviewed it fresh.

---

## 7. The first Claude Code prompt (Phase 1 visual primitives)

This is what you'd hand to Claude Code right now to execute Phase 1. It's narrowly scoped to the foundation layer.

```
Phase 1 — IO Finance Hub UI redesign foundation. Visual primitives only, no page-level changes.

Context: Claude Design produced a complete design package now extracted at /design-system/ in the repo. The design uses our existing tokens (paper + ink + gold, Fraunces + Geist + Geist Mono, 4 radius stops, single shadow). Three foundation pieces need to be in place before any page-level redesign work.

Hard constraints:
- Do NOT touch any page-level components yet (cfo-dashboard.tsx, budgets/page.tsx, etc.)
- Do NOT modify financial logic, hooks, queries, RPCs, or routes
- DO preserve ALL existing TypeScript types — the build now gates on tsc

Three deliverables:

1. Extend src/components/layout/stat-card.tsx
   Currently it has: label, value, subtitle, trend, loading, optional icon.
   Add two new optional slots:
   - sparkline?: ReactNode — renders inside the card on the right side at ~64×40px
   - ring?: { value: number; max: number } — renders a 48×48 ring chart with --gold filled arc, --border-subtle track
   Both slots are mutually exclusive (sparkline OR ring, never both).
   Maintain backward compatibility: existing call sites must work unchanged.

2. Add src/components/layout/page-title.tsx
   New component implementing the serif + italic-gold-accent page title treatment.
   Props: { primary: string; accent?: string; subtitle?: string; meta?: ReactNode; action?: ReactNode }
   Renders:
     <h1 class="font-serif text-4xl">
       {primary} <em class="italic text-gold">· {accent}</em>
     </h1>
     <p class="text-muted-foreground mt-2">{subtitle}</p>
     <div class="meta">{meta}</div>
     <div class="action">{action}</div>
   Use Fraunces for the h1 (already loaded). Use --gold token for the italic accent color.
   Match the spacing/sizing in /design-system/dashboard.html exactly — sample the rendered <h1> line height, font weight, letter spacing.

3. Add src/lib/charts/chart-theme.ts
   Export a ChartTheme object containing the locked chart vocabulary from /design-system/chart-vocabulary.html:
   - axisStroke: 'oklch(...)' — the actual color value used in the design
   - axisLabelStyle: { fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', fill: '...' }
   - gridStroke: 'oklch(...)'
   - gridStrokeOpacity: 0.15
   - lineWeight: 1.75
   - lineColors: { primary: 'var(--ink)', secondary: 'var(--gold)', tertiary: 'var(--success)' }
   - areaGradientFill: a JSX gradient definition for the area-fill pattern
   - tooltipStyle: { backgroundColor: 'var(--ink)', color: 'var(--paper)', borderRadius: 8, padding: 12, fontSize: 13 }
   Then add a CustomTooltip component that takes Recharts tooltip props and renders our tooltip style.

After implementing:
- Run npx tsc --noEmit — expect 0 errors
- Run npm run build — expect clean
- Run npm run lint — note any new warnings/errors but don't fix lint issues that aren't in our 3 new/modified files
- Show git diff --stat
- Stage exactly: stat-card.tsx, page-title.tsx (new), chart-theme.ts (new)
- Commit:

  ui(redesign): Phase 1 — visual primitives for redesign

  - StatCard: optional sparkline / ring slots (backward-compatible)
  - PageTitle: new component for serif + italic-gold-accent page headings
  - chart-theme.ts: locked chart vocabulary tokens for Recharts integration

  No page-level changes yet. Foundation for Phase 2 (dashboard restructure) and beyond.

git log --oneline -1
```

Send back the hash.

---

## 8. Open decisions for you

Before Phase 2 or any page implementation, decide:

- [ ] **Service period progress band on the dashboard?** (Feature A — recommended)
- [ ] **"Action required" third rail item?** (Feature B — recommended)
- [ ] **Cash runway formula** — `bank_balance_kes / avg(last 3 months total_costs)` is my proposal. Confirm or adjust.
- [ ] **Wording adjustments** in section 2 — yes to all, or specific picks?
- [ ] **Drop the "month closure sign-offs" widget** in favor of simpler "Service period · April 2026 in progress, locks May 5"?
- [ ] **Implementation order priority** — operational pages first or reports first after dashboard?

Answer any subset and we move forward. The Phase 1 prompt above is independent of these decisions and can ship tonight.
