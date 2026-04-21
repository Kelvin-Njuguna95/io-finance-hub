# IO Finance Hub — Copilot enforcement notes

Read [`.impeccable.md`](../.impeccable.md) for the full design-system spec. This file is a lean reminder of the **non-negotiable rules** enforced across every PR. Do not duplicate the full spec here.

## Non-negotiables

1. **Light-only.** Dark mode has been deprecated and removed. Do not add `.dark` selectors, `dark:` Tailwind variants, or theme-switching code.
2. **`oklch()` everywhere.** Hex literals are banned from shipped CSS (permitted only as `/* #... */` comments above a derivation). Precision: 3-decimal L, 3-decimal C, integer H — `oklch(0.970 0.005 254)`.
3. **Single brand anchor: deep navy `oklch(0.295 0.065 254)`.** Gold and electric blue are **chart-only**. Any UI occurrence outside `/components/charts/*` is a bug.
4. **4-stop radius, nothing else.** `--radius-sm` 4px · `--radius` 6px · `--radius-lg` 10px · `--radius-full` pill. No `rounded-[Xpx]` literals; no new radius tokens.
5. **Typography: Commissioner (body 400, headings 600) + JetBrains Mono (400).** No third weight, no Inter, no Fraunces/Playfair/DM/Plus Jakarta/Space Grotesk/Plex. JetBrains Mono is scoped to currency, invoice/reference codes, UUIDs, and numeric table columns.
6. **Italics reserved exclusively for `revenueEstimated`.** One italic role, one meaning. No italics for emphasis, foreign words, proper nouns, or report titles. Stop and ask before adding a second italic role.
7. **Focus rings are unified and non-optional.** Every interactive element gets `outline: 2px solid var(--ring)` via the base-layer `:focus-visible` rule. No `focus-visible:ring-*` utilities on primitives. Keyboard only — mouse click does not show a ring.

## Banned patterns

- `border-left`/`border-right` > 1px (Impeccable BAN 1 — side-stripes).
- Gradient text (`background-clip: text` + gradient fill).
- Hover-shadow on cards, buttons, or interactive containers. Hover uses background tint (`-hover` recipe), never shadow lift.
- Shadow on non-overlay surfaces. `--shadow-overlay` is the **only** elevation token; popovers/dialogs/dropdowns/tooltips/toasts use it, nothing else does.

## When unsure

Stop and ask. The spec is intentionally disciplined — new weights, new radii, new hover recipes, a second italic role, gold or electric blue in a UI surface all require explicit approval before landing.
