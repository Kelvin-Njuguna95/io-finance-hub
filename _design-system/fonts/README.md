# Fonts

**Fraunces**, **Geist**, and **Geist Mono** — the three families from `impactoutsourcing.co.ke`, loaded from Google Fonts at the top of `colors_and_type.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap");
```

Weights loaded:
- **Fraunces** — variable, optical-size 9–144, weights 300 / 400 / 500 / 600 / 700. Display role, with live italic used for the gold accent phrase inside a headline.
- **Geist** — 300 / 400 / 500 / 600 / 700. Body + UI role.
- **Geist Mono** — 400 / 500. Numeric / metadata role (currency, invoice IDs, UUIDs, numeric table columns, KPI values, eyebrow labels).

## Reference pages

The other HTML files in this folder are the uploaded `impactoutsourcing.co.ke` pages — brand reference for tone, type rhythm, and the `--gold / --paper / --ink / --warm-grey` token system.

## Substitution note

The source site loads these via Google Fonts CDN (see `<head>` of any page). The design system uses the same CDN — no local TTFs bundled. If a licensed local hand-off is needed, request `.ttf`/`.woff2` from Google Fonts directly: Fraunces, Geist and Geist Mono are all open-licensed (OFL / Vercel permissive).
