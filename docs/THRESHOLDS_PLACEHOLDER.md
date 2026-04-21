# Dashboard Thresholds — Placeholder Values

Every threshold constant in [`src/lib/dashboard-thresholds.ts`](../src/lib/dashboard-thresholds.ts) is marked `// REVIEW: placeholder`. They exist so the dashboard polish PR could ship tint logic without blocking on a product threshold spec.

## Register

The design register is **"normal is silent, abnormal tints"** per `.impeccable.md` Q7. Normal-zone stats carry zero chrome — no green tick, no "all clear" indicator. Abnormal-zone stats tint their container background using `-soft` tokens (warning-soft, danger-soft) and may shift their foreground token for contrast.

## Provenance

Values are **conservative on the silent side**. The failure mode we're designing against is over-firing: if thresholds panic-tint routine days, the signal erodes within a week of use. Under-firing is acceptable as a starting point because the register is already "silent by default" — nothing lights up ≠ nothing is wrong, but normal users don't read a silent dashboard as "all clear", they read it as "check the numbers yourself." That's the register.

Rough calibration heuristic used for the placeholders:

- **Counts**: warning at "roughly one backlog-day's worth", danger at "roughly one backlog-week's worth". Tune based on real month-over-month backlog averages.
- **Percentages**: set well outside the fat part of the normal distribution. For margins, 25% is a common industry floor (25% warning, 10% danger); for budget utilisation, 90% is where product-finance typically starts to care; 95% is near the cliff.
- **Close window**: 3 calendar days on either side of month-end. This is a placeholder for business-day precision, which would need a holiday calendar — see "Business-day precision" below.

None of these placeholders came from soak observation. Tune in the follow-up PR.

## Process

1. **Soak for 2 weeks post-merge.** Watch which thresholds fire, which don't, and whether the firings correlate with real attention-worthy state. Spot-check once per weekday and note false positives, false negatives, correct fires.
2. **Tune in a follow-up PR.** Adjust values based on the soak observations. Remove `// REVIEW: placeholder` comments as each constant gets validated.
3. **When all comments are removed, delete this doc.**

## Grep recipe

Every constant comment uses the exact string `// REVIEW: placeholder` so:

```bash
git grep "REVIEW: placeholder"
```

enumerates every still-unvalidated threshold. Constants whose comments have been removed are validated.

## Business-day precision

`isWithinCloseWindow()` and `daysUntilNextClose()` use calendar days. If business-day precision is needed (excluding weekends + Kenyan public holidays), replace the helper with a holiday-calendar-aware version. Flagged as a post-validation question — most accountants close over a calendar-day window anyway, and the tolerance on "3 days before EoM" being 3 business days vs 3 calendar days is low.

## Don't-do list

- **Do not** wire thresholds to database fields in this PR. If a threshold genuinely needs to live in the database (org-level overrides, role-level tuning), that's a data-layer request for a follow-up.
- **Do not** add positive-state thresholds (e.g., "Margin > X shows a green tint"). The register prohibits positive states.
- **Do not** fan out the thresholds into per-role preferences. One threshold per stat, applied consistently.

## Related

- `.impeccable.md` — register rules (`/critique` Q7, suffix discipline)
- `docs/TOKEN_MIGRATION.md` — deprecated-token migration tracker, separate concern
