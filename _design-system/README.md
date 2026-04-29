# IO Finance Hub — Design System

**Source repo:** `Kelvin-Njuguna95/io-finance-hub` (GitHub, default branch `main`).
Not bundled; browse on demand with the project's GitHub tooling.

---

## The company & the product

**Impact Outsourcing Limited** is a Kenya-based BPO (business process outsourcing). The Finance Hub is an **internal-only tool** used by the CFO, Accountants, Team Leads and Project Managers to run the business's finance operations day to day — budgets, expenses, revenue, withdrawals, profit share, red flags, month closure.

- **Users:** CFO, Accountant, Team Leader, Project Manager
- **Deployment:** internal web app (Next.js 16, React 19, Tailwind v4, shadcn + Base UI, Supabase, recharts), Chromium-family browsers only
- **Region:** Kenya. Currency: **KES** (local) and **USD** (clients). Statutory: KRA, NSSF, NHIF.
- **Session shape:** extended — operators read and enter data for hours at a time. Eye fatigue is a first-class design constraint.
- **Only surface:** light mode. Dark mode was explicitly deprecated and removed.

There is **exactly one product** represented in the repo: the Finance Hub web app. Within it, two surfaces matter for the UI kit:

1. **Authenticated dashboard** — sidebar + topbar shell, role-based dashboards (CFO, PM, Accountant, Team Lead), reports, tables, forms, dialogs
2. **Authentication surface** — ink login screen (the one context where paper text lives on a warm-black hero surface, with a gold brand tile)

## Brand personality

Three words from the repo's `.impeccable.md`: **disciplined · legible · unshowy**.

- Register: **treasury / regulatory document**, not consumer SaaS.
- Reference: Stripe Dashboard, Mercury, Xero.
- Anti-reference: Linear marketing, Notion landing, "2024 SaaS" dashboards with glossy surfaces, gradient heroes or decorative motion.
- "Boring-but-excellent" is the goal. Finance users reward clarity and legibility over polish or delight.

## Core design principles (lifted from `.impeccable.md`)

1. **One meaning per token suffix.** `-soft`, `-foreground`, `-hover`, `-active`, `-muted` each have exactly one semantic — never overloaded.
2. **Discipline scales better than intensity.** Fewer weights, fewer radii, fewer shadow stops — remove choice points.
3. **Italics is a signal, not emphasis.** Exactly one italic role in the product: `revenueEstimated` (≤14px cells only).
4. **Eye fatigue is a design constraint.** Body ≥15px, contrast ≥4.5:1 body / ≥3:1 UI, generous row heights, `tabular-nums` on every column users scan.
5. **Brand colour stays out of data.** Paper, ink and gold are the brand; charts use their own palette.

---

## Sources used

- **GitHub repo:** `github.com/Kelvin-Njuguna95/io-finance-hub` @ `main`
  - `.impeccable.md` — canonical design-system spec (colours, type, radii, elevation, motion, focus, italics policy)
  - `src/app/globals.css` — oklch tokens, semantic mappings, sidebar, hero surface
  - `src/app/layout.tsx` — Fraunces + Geist + Geist Mono loaded via `next/font/google`
  - `src/components/ui/*` — button, badge, card, input, table primitives
  - `src/components/layout/*` — app-sidebar, dashboard-topbar, hero-card, page-header, stat-card, section-card
  - `src/app/(dashboard)/_components/cfo-dashboard.tsx` — canonical dashboard composition
  - `src/app/(auth)/login/page.tsx` — login surface
- Figma / PDF decks: none supplied.

---

## Index of this folder

| Path | What it is |
|---|---|
| `README.md` | This file — brand context, content + visual foundations, iconography |
| `SKILL.md` | Agent Skill manifest for downstream Claude Code use |
| `colors_and_type.css` | CSS variables (tokens) + semantic classes — the single stylesheet consumers should import |
| `fonts/` | Font loading notes (Fraunces + Geist + Geist Mono via Google Fonts) + reference pages from impactoutsourcing.co.ke |
| `assets/` | Logos, brand mark, reference icon list |
| `preview/` | Small HTML cards registered in the Design System review tab |
| `ui_kits/finance-hub/` | The canonical UI kit — dashboard, login, tables, forms, report pages |

---

## CONTENT FUNDAMENTALS

**Tone.** Calm, authoritative, data-dense. Treasury-document register, not marketing. Never enthusiastic, never apologetic. No exclamation marks. No "Let's…", no "We'll…", no second-person sales voice. Third-person or imperative, neutral.

**Casing.** Sentence case for everything except:
- Eyebrow / section labels — **UPPERCASE**, tracking `0.14em`–`0.22em` (e.g. `IMPACT OUTSOURCING`, `APPROVAL BACKLOG`)
- Proper nouns and acronyms (KES, USD, KRA, NSSF, NHIF, P&L, EOD, CFO, PM)
- Page titles — Sentence case ("Budget approval queue", not "Budget Approval Queue")

**Voice.** Primarily **third-person neutral** ("Versions waiting on CFO review"). Imperative when addressing the operator directly ("Sign in to continue", "Enter your email first"). The app uses "you" sparingly — only for direct instructions, never for flattery.

**Emoji.** **Never.** Not in UI, not in copy, not as bullets. The Finance Hub uses Lucide icons and unicode glyphs (e.g. `≈`, `·`, `—`) only.

**Numbers.** Always tabular. Currency format: `KES 12,400,000` or `USD 96,500` — three-letter code before the number, thin space, thousands separated. The `≈` prefix marks estimated values (e.g. `≈ KES 4.2M`) and is a non-removable accessibility affordance.

**Dates.** Intl-formatted, Africa/Nairobi timezone. Long form in hero: `Monday, 21 April 2026`. Short form in tables: `2026-04-21` (ISO). Times shown as `14:32 EAT`.

**Status vocabulary.** Each status maps to one anchor tone. Never colour-only — always paired with a label.

| Label | Tone |
|---|---|
| Approved, Confirmed, Paid, Sent | success |
| Submitted, Under review, Pending | info / warning |
| Overdue, Rejected, Failed | danger |
| Draft, Archived | muted / neutral |

**Examples from the product (copy, verbatim):**
- Login: "Sign in to continue" · "4-digit PIN" · "Invalid email or PIN" · "Forgot PIN?"
- Dashboard hero: "Impact Outsourcing" (eyebrow), "Finance Hub" (title), "Monday, 21 April 2026"
- Stat subtitles: "Budget versions awaiting review", "Director payouts awaiting approval", "Outstanding risk signals"
- Empty state: "No active red flags" · "All monitored signals are within tolerance."
- Section descriptions end without a period when they are labels, with a period when they are sentences.

**Forbidden copy patterns:**
- No emoji anywhere
- No marketing verbs ("unlock", "supercharge", "delight")
- No ALL CAPS shouting (uppercase is reserved for eyebrow labels at small sizes)
- No italics for emphasis, foreign words, or proper nouns
- No exclamation marks anywhere in the UI

---

## VISUAL FOUNDATIONS

### Colour
- **Three brand anchors**, sourced from `impactoutsourcing.co.ke`:
  - `--paper` `#FAFAF7` — warm off-white canvas (+ `--paper-2/3/4` ramp)
  - `--ink` `#111210` — deep warm-black for type, solid buttons, dark panels (+ `--ink-2/3/4` ramp)
  - `--gold` `#C8A24B` — single saturated accent; focus ring, login brand tile, sidebar active rail, one-or-two moments per screen
- **Hex for brand literals, oklch for derived ramps.** Semantic anchors (success / warning / danger / info) stay oklch and are tuned to sit on warm paper without clashing with gold.
- Warm-grey mid-tones (`--warm-grey`, `-2`, `-3`) bridge paper and ink for captions, dividers, secondary copy.
- Every semantic anchor derives its `-soft`, `-foreground`, `-hover`, `-active` variants via the same recipe book. `-soft` is 12–14% anchor mixed into paper; `-hover`/`-active` are 93/7 mixes with white/black.
- **Charts get their own palette** (`--chart-1..6`) so brand colour and data colour never collide.

### Type
- **Fraunces** (Google Fonts, variable opsz 9..144, weights 300–700) — display serif. Used for headings, card titles, hero titles. Live italic is the system's accent — reserved for the gold phrase inside a display headline.
- **Geist** (Google Fonts, 300–700) — body + UI sans. Everything that isn't display or numeric.
- **Geist Mono** (Google Fonts, 400/500) — Scope: **currency values, invoice numbers, reference codes, UUIDs, numeric table columns, KPI values, eyebrow/metadata labels**.
- **Italic** has two roles: (1) the Fraunces-italic gold accent phrase inside a display heading, (2) the `revenueEstimated` flag at ≤14px table cells only. At hero/stat-card sizes (≥16px) use the `≈` prefix instead; the italic slant reads too heavily at those sizes.
- Minimum body size: **15px** (16px preferred). Type scale ratio ≥1.25.

### Spacing
- **4pt base grid.** Default reach is the breathing stops: **8 / 12 / 16 / 24**. Reach for 4 only when density truly demands it.
- Primitive targets: button `h-9 px-4 py-2`, input `h-9`, table cell `py-3 px-4`, card `p-6`, sidebar row `~40px`, badge `px-2 py-0.5`.
- **The only permitted off-grid value in the entire product is `py-0.5` (2px)** on badge internals — 4px padding on sub-20px elements reads as over-generous.

### Radii (exactly 4 stops — no intermediate)
- `--radius-sm` 4px — badges, switches, checkboxes
- `--radius` 6px — inputs, buttons, small cards (base)
- `--radius-lg` 10px — dialogs, popovers, dropdowns, larger cards
- `--radius-full` pill — tabs-selected, chip filters only

No `--radius-md`, `-xl`, or `-2xl`. No `rounded-[Npx]` literals in components.

### Elevation (single token — everything else is flat)
- `--shadow-overlay`: `0 4px 16px -6px oklch(0 0 0 / 0.10), 0 1px 3px -1px oklch(0 0 0 / 0.06)`
- Used on popovers, dialogs, dropdowns, tooltips, toasts. **Only.**
- Cards, buttons, inputs, sidebars, table rows: **flat, border-only.**
- **Hover never uses shadows.** Hover shifts are background-tint only. Card hover-shadow is a banned consumer-SaaS pattern.

### Borders
- Three border tokens: `--border` (200), `--border-subtle` (100), `--border-strong` (300).
- Cards and tables: **hairline border** only, no shadow. Table container has `border` + `rounded-lg`; thead row has a bottom border; zebra rows use `surface-3`.

### Backgrounds
- Default: flat `--background` (neutral-100).
- Two named surfaces exist inside the dashboard: `--surface-2` (lighter, for tables), `--surface-3` (between), `--surface-sunken` (darker).
- **The hero surface is the one exception to the flat rule.** `.hero-surface` is a warm-ink panel with two radial gradients — low-chroma warm-neutrals tuned to sit under the gold brand tile and paper-coloured type. No competing saturated colours, no photographic textures.o multicolour gradients. Used on dashboard hero panels and the login card background.
- No patterns, textures, grain, or hand-drawn illustrations anywhere.
- No full-bleed photography in the app. (Marketing/landing pages don't exist in this repo.)

### Imagery
- None in the application surface. This is a treasury tool — photography and illustration would undermine the register.
- The one visual motif outside typography is the **ink radial hero** and the **monospace "IO" brand tile** (gold-on-ink in sidebar, ink-on-gold in login).

### Animation / motion (sparse)
Allowed only on:
- status transitions
- toast entries/exits
- tab switches
- KPI count-ups

**Banned:** hover-lift, fade-in on mount, scroll-triggered animations, auto-playing carousels, shimmer on interactive elements, decorative motion of any kind.

Easing: `var(--ease-standard)` = `cubic-bezier(0.2, 0, 0, 1)` for general use. Durations: fast 120ms, base 200ms, slow 320ms. `prefers-reduced-motion: reduce` collapses everything to ~0ms.

### Hover & press states
- **Hover:** subtle tint shift. Buttons: primary → `-hover` (93% anchor / 7% white). Cards/rows: `hover:bg-muted` or `border-border-strong`. Never shadow, never scale.
- **Press (active):** buttons translate `translate-y-px` on active-not-menu-trigger. No deep scale. Primary → `-active` (93% anchor / 7% black).
- **Selected:** rows use `data-[state=selected]:bg-primary-soft`. Tabs use the pill radius.

### Focus rings
- **One** treatment, no opt-outs.
- `outline: 2px solid var(--ring); outline-offset: 2px;`
- `--ring` is the brand gold `#C8A24B` — readable against both paper and ink surfaces.
- `:focus-visible` only. Mouse clicks never show the ring.

### Transparency & blur
- Used only on the topbar (sticky): `bg-background/90 backdrop-blur-lg`.
- Used on the login card over the hero: `bg-white/[0.04] backdrop-blur`.
- Never on dashboard cards, tables, or dialogs.

### Layout rules
- Sidebar: fixed, collapsible to icon rail (keyboard shortcut Ctrl/Cmd+B). Paper surface (warm gradient from `--paper-2` to `--paper`). ~40px row height. Keyboard persistence via cookie.
- Topbar: sticky, `h-14`, breadcrumb on the left (derived from path), notifications on the right.
- Dashboard content: `p-6 space-y-6` grid of SectionCards and StatCards.
- Page header: 6-column padded block with eyebrow / title / description / meta pills / action buttons.

### Tables
Paper-and-ink treasury tables:
- Rounded container (`--radius-lg`), single border.
- Header row: `surface-2` background, muted-foreground text, 13px semibold.
- Zebra rows: `surface-3` on even rows.
- Row hover: `bg-muted`.
- All numeric columns: `font-mono tabular-nums`, right-aligned.
- Selected row: `bg-primary-soft`.
- Status row accent: 3px left border in the anchor tone (`.status-row-approved` etc.).

### The visual identity in one paragraph
An editorial paper-and-ink treasury UI with a single gold accent. No gradients outside the hero. No shadows outside overlays. No hover-lift. Fraunces display with live italic, Geist body, Geist Mono numbers, two italic roles, three brand anchors, four radii, sparse motion. Everything else is flat, hairline-bordered, and tabular.

---

## ICONOGRAPHY

**System.** **Lucide** (`lucide-react` in the repo). No other icon library is used.

- **Style:** outline / stroke-only, 1.75 stroke-width is the canonical weight used across layout chrome (sidebar, stat card tile, page header tile). 2.0 stroke-width is used inside small badges (severity chips) and delta arrows for better legibility at <16px.
- **Sizing:** `size-3` (12px) in xs contexts, `size-3.5` (14px) in badges and micro-actions, `size-4` (16px) standard, `size-[18px]`–`size-5` (18–20px) in tinted tiles on stat cards, page headers, and hero stats.
- **Colour:** icon colour inherits `currentColor` of the surrounding tinted tile (`text-primary`, `text-success-soft-foreground`, etc.). In the sidebar, icon colour is `text-white/55` inactive, `text-white` active.
- **Tile pattern:** most chrome icons sit inside a `size-9` or `size-10` tinted tile: `bg-*-soft text-*-soft-foreground ring-1 ring-inset ring-*/25`. This tile pattern is the primary iconography motif in the product.
- **Never hand-draw an icon.** If Lucide lacks a needed glyph, use a unicode character (e.g. `≈` for estimated, `·` for mid-dot separators) or request an approved addition.

**Canonical icons in the product** (non-exhaustive; see `assets/ICON_INDEX.md`):
- Navigation/chrome: `ChevronsUpDown`, `ChevronRight`, `LogOut`, `Wallet`, `Eye`
- Finance domain: `ClipboardList`, `ArrowDownToLine`, `Flag`, `ArrowUpRight`, `ArrowDownRight`, `AlertTriangle`, `CheckCircle2`, `ShieldAlert`, `FileText`, `Inbox`, `ArrowRight`

**Emoji.** Never used. Do not introduce emoji in any Finance Hub surface.

**Unicode glyphs in use.**
- `≈` (U+2248) — estimated value marker (primary affordance; redundant with italics at small sizes)
- `·` (U+00B7) — breadcrumb and eyebrow separator
- `—` (U+2014) — empty-cell placeholder in tables

**Logo / brandmark.** The brandmark is typographic: a rounded-lg tile containing the monospace letters **"IO"**.
- Sidebar variant: `--ink` tile with gold "IO", `ring-1 ring-white/6`. Paired with uppercase tracked "Impact Outsourcing" and sentence-case "Finance Hub".
- Login variant: `--gold` tile with ink "IO", on an ink hero surface.
- No wordmark file exists in the repo; the brand is expressed entirely through the "IO" tile + type pair.

See `assets/logo-io-sidebar.svg`, `assets/logo-io-login.svg`, and `assets/ICON_INDEX.md` for reference material.

---

## Flags / substitutions

- **Fonts:** this design system loads Fraunces, Geist, and Geist Mono from the Google Fonts CDN — matching the live site at `impactoutsourcing.co.ke`. No local TTFs. If a font file is required for offline handoff, please provide the licensed `.ttf`/`.woff2` files and I'll wire them up as `@font-face`.
- **Icons:** Lucide is linked via CDN in the preview HTML files (`@lucide/web`). The codebase uses `lucide-react` — visually identical SVGs.
- **Chart palette:** `.impeccable.md` reserves the full categorical chart palette for a follow-up PR. The current `globals.css` maps `--chart-1..6` to `electric / gold / success / violet / teal / danger`, which this system mirrors. If the chart polish PR has landed in the repo, refresh these tokens.
- **Login visual residue:** the `login/page.tsx` still uses `--electric` and `--gold` on the card gradient — flagged in `.impeccable.md` as a legacy surface that will migrate in a follow-up polish PR. The UI kit reproduces the current state faithfully.
