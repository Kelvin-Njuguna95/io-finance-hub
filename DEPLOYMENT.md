# IO Finance Hub — Deployment Guide

## Required Environment Variables

Set these in the Vercel dashboard under **Settings > Environment Variables**:

| Variable | Required | Where used |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | All Supabase client/server connections |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-side Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | All API routes (admin operations) |
| `EOD_SLACK_WEBHOOK_URL` | Optional | `/api/eod` Slack webhook for EOD reports |

`VERCEL_URL` and `NEXT_PUBLIC_VERCEL_URL` are auto-injected by Vercel — do not set manually.

---

## Migration Status (verified 2026-04-08)

### Already applied to production
- **00001 through 00010** — all fully applied
- **00011** — partially applied (column `submitted_by_role` added, but RLS policy changes failed)

### Pending: 00012_rls_policy_fixes.sql (the ONLY remaining migration)

Repairs the three RLS policies that failed during 00011's partial application.

**Policies repaired:**
- `budgets_insert` — adds accountant role for project-scoped budgets
- `bv_insert` — adds accountant role for project-linked budget versions
- `bi_delete` — creates the missing DELETE policy for budget items in draft status

**Pattern:** `DROP POLICY IF EXISTS` + `CREATE POLICY` — idempotent and safe regardless of current policy state.

**App flows that depend on this migration:**
- Accountant budget creation (currently bypassed via admin API route, but RLS should still be correct)
- Budget item deletion in draft budgets

**How to apply:**
1. Open the Supabase dashboard SQL Editor
2. Paste the contents of `supabase/migrations/00012_rls_policy_fixes.sql`
3. Click Run
4. Verify: no errors in output (3 DROP + 3 CREATE statements should succeed)

**What to test after:**
- Log in as the accountant and create a test budget (should succeed via RLS now, not just via admin API)
- Verify CFO, TL, and PM budget creation still works (unchanged)
- Verify draft budget item deletion works

**Rollback if needed:**
The migration only changes policy metadata. To revert, re-run the original policies from `00003_rls_policies.sql` (lines 146, 173) and drop `bi_delete`.

---

## Vercel Node.js Version

The Vercel project was previously configured with `nodeVersion: "24.x"` which is experimental and likely caused the empty deploy failures. It has been changed to `"22.x"` (current LTS) in `.vercel/project.json`.

**Also verify in the Vercel dashboard:** Settings > General > Node.js Version should be **22.x** (not 24.x).

Next.js 16.2.2 requires Node `>=20.9.0`. The `engines` field in `package.json` is set to `>=20.9.0 <25`.

---

## Deployment Methods

### Option A: Git-based deployment (recommended)
1. Push code to `main` branch on GitHub
2. Vercel auto-deploys via GitHub integration
3. No CLI issues — builds happen on Vercel's infra

To set up if not already connected:
```
vercel git connect
```
Or link the GitHub repo in the Vercel dashboard under Settings > Git.

### Option B: Vercel CLI
```bash
vercel deploy --prod
```
If CLI deploys still fail after the Node version fix, use Option A.

### Option C: Vercel Dashboard
Trigger a redeployment from the Vercel dashboard Deployments tab.

---

## Pre-deploy Checklist

- [ ] All 3 environment variables set in Vercel dashboard
- [ ] Migration 00012 applied to production Supabase (00009/00010 already applied)
- [ ] Vercel Node.js version set to 22.x in dashboard
- [ ] Code pushed to `main` branch

---

## Known Issues

### `pg` package in dependencies
The `pg` (node-postgres) package is listed in `package.json` dependencies but is **never imported** anywhere in the codebase. It can be safely removed to avoid potential native module compilation issues on Vercel serverless functions. To remove:
```bash
npm uninstall pg
```

### Stale `.vercel/output/`
A previous `vercel build` left a 9MB `.vercel/output/` directory. This is gitignored and does not affect git-based deploys, but can interfere with `vercel deploy --prebuilt`. Safe to delete:
```bash
rm -rf .vercel/output
```
