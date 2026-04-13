# IO Finance Hub — Full UI Audit & Fix Prompt

Copy everything below this line into a fresh Claude Code session:

---

You are auditing the IO Finance Hub — an internal financial management web app for Impact Outsourcing Limited (Nairobi-based BPO). It was recently given a design system overhaul. Your job is to run a comprehensive visual audit, identify every issue, and fix them all.

## CONTEXT

The app is at `/Users/macbookpro/Documents/IO Finance Hub`. It uses:
- Next.js 16 (App Router) + React 19
- Tailwind CSS v4 (inline @theme in globals.css, NOT a separate config file)
- shadcn/ui (Base UI primitives)
- Recharts for charts
- Deployed on Vercel at io-finance-hub.vercel.app

A design system upgrade was just deployed. The changes touched:
- `src/app/globals.css` — design tokens (Electric Blue, Gold, hero surface)
- `src/components/ui/button.tsx` — Electric Blue primary buttons
- `src/components/ui/table.tsx` — sticky headers
- `src/components/ui/card.tsx` — shadow transitions
- `src/components/ui/input.tsx` and `select.tsx` — height/radius
- `src/components/ui/skeleton.tsx` — shimmer animation
- `src/components/layout/hero-card.tsx` — hero panel
- `src/components/layout/stat-card.tsx` — KPI cards
- `src/components/layout/app-sidebar.tsx` — gold active state
- `src/components/layout/section-card.tsx` — hover effects
- `src/components/layout/page-header.tsx` — tone variants
- `src/components/layout/dashboard-topbar.tsx` — backdrop blur
- `src/app/(auth)/login/page.tsx` — branded login
- `src/app/(dashboard)/layout.tsx` — loading/session splashes
- `src/app/(dashboard)/loading.tsx` — skeleton loader
- `src/lib/status.ts` — status badge classes
- Multiple page files had raw Tailwind colors migrated to tokens

## YOUR MISSION

### Phase 1: AUDIT (research only — do NOT write code yet)

Run the ui-ux-pro-max skill first:
```
/ui-ux-pro-max audit "fintech dark dashboard professional internal SaaS"
```

Then systematically inspect every file listed above. For EACH file:

1. **Read it fully** — do not skim
2. **Check color contrast** — are text colors legible against their backgrounds? Especially:
   - White text on hero surface (#0a0f1e) — is it bright enough?
   - Muted text (white/45, white/50) — can you actually read it?
   - Electric Blue (#00d4ff / oklch 0.78 0.18 210) on dark backgrounds — legible?
   - Electric Blue as button fill — is the dark foreground text readable?
   - Gold (#F5C518) as sidebar active text on dark navy — readable?
   - Status badge text on soft backgrounds — enough contrast?
   - Login page: white/70 labels, white/30 placeholders, white/40 link — visible?
3. **Check visual consistency** — do all components feel like they belong together?
   - Are font sizes consistent across similar elements?
   - Do padding/margin values feel balanced?
   - Are border radii consistent (8px spec)?
   - Do transitions feel smooth or jarring?
4. **Check dark mode** — toggle to dark mode and verify:
   - Card backgrounds don't blend into page background
   - Text remains readable
   - Borders are visible
   - Hero card still looks good
5. **Check responsive** — verify mobile breakpoints make sense:
   - Tables scroll horizontally
   - Hero stat grids collapse properly
   - Sidebar collapses to sheet on mobile
6. **Check for orphaned raw colors** — search for any remaining:
   - `text-red-`, `bg-red-`, `border-red-`
   - `text-amber-`, `bg-amber-`, `border-amber-`
   - `text-emerald-`, `bg-emerald-`, `border-emerald-`
   - `text-rose-`, `bg-rose-`, `border-rose-`
   - `text-green-`, `bg-green-`, `border-green-`
   - `text-blue-` (not `text-blue` token), `bg-blue-`, `border-blue-`
   - Any hardcoded hex colors in className strings

Then inspect the REPORTS section specifically:

7. **Reports audit** — read each of these pages fully:
   - `src/app/(dashboard)/reports/monthly/page.tsx`
   - `src/app/(dashboard)/reports/pnl/page.tsx`
   - `src/app/(dashboard)/reports/profitability/page.tsx`
   - `src/app/(dashboard)/reports/trends/page.tsx`
   - `src/app/(dashboard)/reports/budget-accuracy/page.tsx`
   - `src/app/(dashboard)/reports/budget-vs-actual/page.tsx`
   - `src/app/(dashboard)/reports/outstanding/page.tsx`
   - `src/app/(dashboard)/reports/projects/page.tsx`
   
   For each report page, evaluate:
   - Does it use proper financial statement formatting? (right-aligned numbers, monospace, subtotals, grand totals)
   - Are charts styled with the design tokens? (chart-1 through chart-6)
   - Is the layout clean and scannable for a CFO reviewing financials?
   - Does it have loading/empty states?
   - Is the data table well-formatted?
   - How does it compare to best-in-class fintech dashboards?

### Phase 2: REPORT YOUR FINDINGS

After auditing, produce a structured report:

```
## CRITICAL (blocks usability)
- [file:line] Issue description

## HIGH (looks broken/ugly)  
- [file:line] Issue description

## MEDIUM (inconsistency/polish)
- [file:line] Issue description

## LOW (nice-to-have refinement)
- [file:line] Issue description

## REPORTS SECTION ASSESSMENT
For each report page:
- Current state (1-10 score)
- What's wrong
- What a best-in-class version looks like
```

### Phase 3: FIX EVERYTHING

After reporting, fix ALL issues found. Follow these rules:

**COLOR PHILOSOPHY — you have FULL CREATIVE FREEDOM:**
- Forget "brand colors" — pick what looks BEST for a professional fintech dashboard
- The goal is: dark, elegant, high-contrast, modern, trustworthy
- Think: Linear, Vercel Dashboard, Mercury Bank, Stripe Dashboard aesthetics
- Numbers must be crisp and instantly readable
- Status colors (success/warning/danger) must be unmistakable at a glance
- Muted text must still be comfortably readable — if in doubt, make it brighter
- Charts should use colors that are beautiful AND distinguishable
- The sidebar should feel premium — dark with clear hierarchy
- The login page should feel like a top-tier fintech product

**TEXT LEGIBILITY IS NON-NEGOTIABLE:**
- Body text: minimum 90% opacity on its background
- Muted/secondary text: minimum 60% opacity (not 40% or 45%)
- Labels in forms: minimum 80% opacity
- Placeholders: minimum 40% opacity
- Hero stat numbers: pure white or near-white, bold
- Currency values: always monospace, always high contrast
- Small text (10px-11px): MUST have extra contrast to compensate for size

**REPORTS SECTION — UPGRADE TO BEST-IN-CLASS:**
Use the ui-ux-pro-max skill to search for:
```
/ui-ux-pro-max "financial report dashboard template dark mode"
/ui-ux-pro-max "P&L income statement design professional"  
/ui-ux-pro-max "data visualization dashboard fintech"
```

Apply these patterns to each report page:
- **Monthly P&L**: Proper accounting layout — revenue section, COGS section, gross profit line, operating expenses, net income. Alternating section backgrounds. Bold totals with top+bottom borders.
- **P&L Reports**: Comparative columns (this month vs last month vs budget). Variance highlighting.
- **Profitability**: Project comparison bar chart + sparklines. Margin indicators with color coding.
- **Trends**: Time-series line charts with proper tooltips, legend, grid lines. Period selector.
- **Budget Accuracy**: Forecast vs actual with bullet charts or progress bars.
- **Budget vs Actual**: Variance waterfall or grouped bar chart. Utilization heat indicators.
- **Outstanding**: Aging buckets with clear visual weight. Overdue items highlighted.
- **Project Comparison**: Side-by-side cards or radar chart for multi-dimensional comparison.

**HARD CONSTRAINTS — DO NOT CHANGE:**
- No financial logic, calculations, or formulas
- No database schema or Supabase queries
- No routing or page structure
- No role-based access control logic
- No authentication flows
- No API integrations
- No new npm dependencies (use what's already installed: Recharts, Lucide, etc.)

**PROCESS:**
1. Fix design token issues in globals.css first
2. Fix component-level issues (button, table, card, etc.)
3. Fix page-level issues (login, dashboards, etc.)
4. Upgrade report pages one at a time
5. Run `npx next build` after each major file to catch errors early
6. Final build must pass with zero errors

**WHEN YOU'RE DONE:**
1. Run `npx next build` — must be zero errors
2. Commit with message: `fix(ui): audit fixes + report page upgrades`
3. Push to main: `git push origin main`
4. Verify deployment: `npx vercel ls | head -3`
5. Report what you changed and what the user should visually verify
