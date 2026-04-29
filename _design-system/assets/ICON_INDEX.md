# Icon index — IO Finance Hub

The product uses **Lucide** (`lucide-react` in code). No other icon library ships.
For mocks and static HTML, pull Lucide via the browser CDN:

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<script>lucide.createIcons();</script>
```

Or inline individual SVGs from https://lucide.dev.

## Stroke weight
- **1.75** — canonical for layout chrome (sidebar, page header, stat-card tile)
- **2.0–2.25** — small badges, severity chips, delta arrows (legibility <16px)

## Size scale
- `size-3`  / 12px — xs badges
- `size-3.5` / 14px — micro actions, severity chips
- `size-4`  / 16px — default
- `size-[18px]` / 18px — tinted tiles on stat cards, page headers
- `size-5`  / 20px — hero stat tiles

## Canonical icons (by surface)

**Sidebar / chrome**
`ChevronsUpDown`, `ChevronRight`, `LogOut`, `Wallet`, `Bell`, `Search`

**Dashboard domain (observed in cfo-dashboard.tsx)**
`ClipboardList` · budget approvals
`ArrowDownToLine` · withdrawals / payouts
`Flag` · red flags / risk signals
`AlertTriangle` · medium/high severity
`ShieldAlert` · critical severity / at-risk health
`CheckCircle2` · approved, healthy, resolved
`FileText` · EOD reports / invoices
`Inbox` · empty queue
`Eye` · view detail
`ArrowRight` · "view all" link affordance
`ArrowUpRight` / `ArrowDownRight` · delta pill direction

**Finance / money**
`Wallet`, `Receipt`, `Coins`, `Landmark`, `Calculator`, `TrendingUp`, `TrendingDown`

## Unicode glyphs permitted
- `≈` (U+2248) — estimated value marker (non-removable)
- `·` (U+00B7) — breadcrumb, eyebrow separator
- `—` (U+2014) — empty table cell

## Never
- No emoji
- No hand-drawn SVG ornaments, "AI art" flourishes, or decorative iconography
- No icon set other than Lucide

## Usage pattern — tinted tile
The signature icon motif in the product is an icon inside a square tinted tile:

```jsx
<span aria-hidden className="flex size-9 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground ring-1 ring-inset ring-success/25">
  <CheckCircle2 className="size-[18px]" strokeWidth={1.75} />
</span>
```

Available tones: `brand`, `success`, `warning`, `danger`, `info`.
