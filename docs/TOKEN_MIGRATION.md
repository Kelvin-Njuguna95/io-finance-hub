# Token Migration

Tracks the design-token shims introduced in the foundation PR ([#98](https://github.com/Kelvin-Njuguna95/io-finance-hub/pull/98)) and the per-page polish PRs that will retire them.

Every shim is a CSS alias in [`src/app/globals.css`](../src/app/globals.css) that routes a deprecated token to a token from the [`.impeccable.md`](../.impeccable.md) 4-stop radius system or single `--shadow-overlay` elevation system. They exist to keep pre-foundation consumers rendering correctly until each consumer is migrated.

**Rules:**
- Do not add new consumers of any deprecated token. New code must use the target token directly.
- When all consumers for a shim are migrated, remove the shim from `globals.css` (both the `:root` declaration and the `@theme inline` export) and delete that row from this doc.
- Running grep from the repo root at any time must be able to enumerate every remaining consumer for you.

---

## Radius shims

### `--radius-md` → `--radius` (6px)

Pure Tailwind-utility shim. No direct `var(--radius-md)` consumers after the foundation PR. Preserved only so the `rounded-md` Tailwind utility (generated from `@theme inline`) continues to resolve.

**Consumers:** `rounded-md` Tailwind class — ~60 occurrences across `src/app/(dashboard)/**`, `src/components/ui/**`, `src/components/layout/**`, `src/app/design-sample/page.tsx`.

**Retirement plan:** `rounded-md` (8px in Tailwind's default scale) is functionally close to the current base `--radius` (6px). A single codemod pass (`rounded-md` → `rounded` across all consumers) retires it. Tracked for the **shadcn primitive polish PR**.

---

### `--radius-xl` → `--radius-lg` (10px)

**Consumers:**
- `src/app/(dashboard)/_components/cfo-dashboard.tsx:481`
- `src/app/(dashboard)/layout.tsx:69, 94, 97`
- `src/app/(dashboard)/loading.tsx:15, 30, 38, 45, 48`
- `src/app/(dashboard)/reports/monthly/page.tsx:60, 458, 468, 490, 512, 543`
- `src/components/ui/empty-state.tsx:66`
- `src/components/ui/command.tsx:28, 58` (uses `rounded-xl!` with important)
- `src/components/ui/sidebar.tsx:310`
- `src/components/layout/section-card.tsx:89`
- `src/components/layout/stat-card.tsx:147, 167`

**Retirement plan:** Migrated in two passes:
- **Dashboard polish PR** — migrates `(dashboard)/**` consumers (~13 occurrences)
- **Layout + primitive polish PR** — migrates `components/**` consumers (~8 occurrences)

After both land, remove `--radius-xl` from `globals.css`.

---

### `--radius-hero` → `--radius-lg` (10px)

**Consumers:**
- `src/app/(dashboard)/loading.tsx:7` (`rounded-[var(--radius-hero)]`)
- `src/app/globals.css:389` (`.hero-surface` self-reference)

**Retirement plan:** Dashboard polish PR migrates `loading.tsx`. `.hero-surface` self-reference can be replaced with `--radius-lg` in the same globals.css cleanup commit that drops the shim.

---

## Shadow shims

### `--shadow-elev-1` → `none`

Functionally a no-op alias (`none`). Consumers render flat already; retiring the class-name reference is cosmetic but removes a dead utility surface.

**Consumers:**
- `src/app/(dashboard)/loading.tsx:30, 45`
- `src/components/layout/section-card.tsx:89`
- `src/components/layout/stat-card.tsx:147, 167`

**Retirement plan:** Dashboard polish PR (loading) + layout polish PR (section-card, stat-card). Post-migration, simply remove `shadow-elev-1` class references from consumers; the `--shadow-elev-1` token then has no referrers and the shim drops.

---

### `--shadow-elev-2` → `--shadow-overlay`

**Consumers:**
- `src/app/(dashboard)/layout.tsx:94`
- `src/components/layout/section-card.tsx:91` (**hover** — banned by `.impeccable.md` Motion section: "hover states never use shadows")
- `src/components/layout/stat-card.tsx:169` (**hover** — same violation)

**Retirement plan:** Layout polish PR. Hover-shadow usages must be replaced with background-tint hover per `.impeccable.md`, not migrated to `--shadow-overlay`. Non-hover uses in `(dashboard)/layout.tsx` are on overlay-like surfaces and can migrate to `shadow-[var(--shadow-overlay)]` directly.

---

### `--shadow-elev-3` → `--shadow-overlay`

**Consumers:**
- `src/components/layout/notification-bell.tsx:153`

**Retirement plan:** Layout polish PR. The notification bell dropdown is a genuine overlay surface; migrate to `shadow-[var(--shadow-overlay)]`.

---

### `--shadow-elev-hero` → `--shadow-overlay`

**Consumers:**
- `src/app/globals.css:403` (`.hero-surface` self-reference)

**Retirement plan:** Drop in the same cleanup commit that retires `.hero-surface`'s radius-hero shim. No other consumers.

---

## Summary

| Token | Consumers | Retirement PR |
|---|---|---|
| `--radius-md` | 60 (via `rounded-md` utility) | shadcn primitive polish PR |
| `--radius-xl` | 21 direct + utility uses | Dashboard polish PR + Layout/primitive polish PR |
| `--radius-hero` | 2 | Dashboard polish PR |
| `--shadow-elev-1` | 5 | Dashboard polish PR + Layout polish PR |
| `--shadow-elev-2` | 3 (incl. 2 banned hover-shadow sites) | Layout polish PR |
| `--shadow-elev-3` | 1 | Layout polish PR |
| `--shadow-elev-hero` | 1 | Foundation cleanup |

Update this doc whenever a consumer migrates; delete the row when the shim itself is removed.
