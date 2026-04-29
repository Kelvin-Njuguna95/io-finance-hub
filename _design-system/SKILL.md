---
name: io-finance-hub-design
description: Use this skill to generate well-branded interfaces and assets for the Impact Outsourcing (IO) Finance Hub — internal treasury UI, dashboards, tables, forms, reports, emails — either for production or throwaway prototypes/mocks. Contains essential design guidelines, colours, type, fonts, icon policy, and UI kit components for prototyping. Editorial treasury register; disciplined, legible, unshowy. Paper + ink + gold; Fraunces + Geist; light-only.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference — non-negotiable rules

- **Three brand anchors**: `--paper` `#FAFAF7` (surfaces), `--ink` `#111210` (type, primary buttons, dark panels), `--gold` `#C8A24B` (single saturated accent). No other brand colours.
- **Gold is the accent, not chart-reserved.** It appears on the focus ring, login brand tile, sidebar active accent, and small status moments. Keep it sparse — one or two touches per screen.
- **Charts still get their own palette** (`--chart-1..6`) so brand colour and data colour never collide.
- **Hex on brand literals, oklch on derived ramps.** The three anchors are literal hex in `colors_and_type.css`; semantic ramps (success / warning / danger / info) stay oklch.
- **Fraunces** (display, opsz 9..144, weights 300–700, live italic) for headlines + card titles. **Geist** (sans, 300–700) for body + UI. **Geist Mono** (400/500) for currency, invoice IDs, UUIDs, numeric columns, KPI values, metadata labels.
- **Italic is a signal, not emphasis.** Two roles: (1) Fraunces-italic headline accent on the gold phrase inside a display heading, (2) `revenueEstimated` at ≤14px table cells only. Use `≈` prefix at ≥16px.
- **No emoji.** Never.
- **4 radius stops** (4 / 6 / 10 / pill). No intermediate values. No `rounded-[Npx]` literals.
- **One shadow** (`--shadow-overlay`), overlays only. Everything else is flat, hairline-bordered.
- **Hover shifts tint, never shadow or scale.**
- **Sparse motion.** Status, toast, tab, KPI count-up only. No decorative motion.
- **Focus ring**: one unified treatment, 2px outline at `--ring` (= `--gold`), `:focus-visible` only.
- **4pt grid.** The only permitted off-grid value anywhere is badge `py-0.5`.

## Files

- `README.md` — brand context, content fundamentals, visual foundations, iconography
- `colors_and_type.css` — import this; it's the single stylesheet for all tokens + semantic classes
- `fonts/` — Fraunces + Geist + Geist Mono (loaded from Google Fonts CDN); also holds the uploaded impactoutsourcing.co.ke reference pages
- `assets/` — logo marks, icon index
- `ui_kits/finance-hub/` — JSX components (navbar, sidebar, stat card, hero, section card, table, badge, button, input, page header, dashboard composition) and an `index.html` that renders a clickable demo
- `preview/` — atomic cards for review (tokens, type, components)
