# IO Finance Hub — Design System Reference (Read-Only)

This directory contains the Claude Design output for the IO Finance Hub redesign,
extracted from `IO_Finance_Hub_Design_System__1_.zip` on 2026-04-29.

**This is reference material, not source.**

- The HTML files are mockups, not production templates. Do NOT serve them, import them, or
  reference them at runtime.
- The CSS files (`colors_and_type.css`, `tokens.css`, `app-shell.css`, `kit.css`) duplicate
  tokens already defined in `src/app/globals.css`. Do NOT import these files in production.
  `globals.css` remains the single source of truth.
- The fonts/ directory contains notes only. Production font loading happens via
  `next/font/google` in `src/app/layout.tsx`.
- The assets/ directory has the brand logo SVGs. If used in production, copy them into
  `src/assets/` or `public/` rather than referencing this directory.

**What this directory is FOR:**

1. Visual reference during page implementation. When working on Budgets list, open
   `_design-system/budgets.html` in a browser to see the target.
2. Copy decisions, status pill vocabulary, and section structure decisions.
3. Chart vocabulary specimen at `_design-system/chart-vocabulary.html` for Recharts theming.

**Implementation plan:** see `UI_REDESIGN_IMPLEMENTATION_AUDIT.md` at the repo root.
