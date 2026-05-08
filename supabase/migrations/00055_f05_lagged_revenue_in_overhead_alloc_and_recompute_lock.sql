-- ===========================================================================
-- 00055_f05_lagged_revenue_in_overhead_alloc_and_recompute_lock.sql
--
-- Closes Audit-4 findings PS-1 and PS-2 from the post-marathon correctness
-- sweep. Two changes, one migration; both via CREATE OR REPLACE so the file
-- is safe to re-apply.
--
-- ── PS-1 ─────────────────────────────────────────────────────────────────
-- fn_calculate_overhead_allocations (last touched in 00031) reads revenue
-- directly from invoices.billing_period in two places:
--
--   00031:159  total revenue across all projects for the month
--   00031:175  per-project revenue inside the FOR loop
--
-- This violates AGENTS.md rule #1 ("Revenue queries MUST use
-- lagged_revenue_by_project_month / lagged_revenue_company_month"). 00035
-- routed the other profit-share callers through the lagged views and
-- explicitly deferred this one with the rationale that the headcount-based
-- default makes the revenue branch dead computation today. PS-1's risk is
-- that a single allocation_rules row flipped to revenue_based or hybrid
-- silently activates the broken read — the same failure mode that produced
-- the −2.4M KES Windward error before 00035 landed.
--
-- The fix mirrors 00036's NULL-safe scalar-subquery + COALESCE pattern
-- against lagged_revenue_company_month.total_revenue_usd (totals) and
-- lagged_revenue_by_project_month.lagged_revenue_usd (per-project). The
-- view's keyset is (expense_month) for the company view and
-- (project_id, expense_month) for the per-project view — both produce at
-- most one row per filter, COALESCE handles the zero-row and the
-- one-row-with-NULL-columns cases identically. The function signature is
-- unchanged; downstream callers (fn_close_month, fn_recompute_profit_share)
-- need no edits.
--
-- ── PS-2 ─────────────────────────────────────────────────────────────────
-- fn_recompute_profit_share (last touched in 00033) DELETEs every
-- profit_share_records row for the month, then re-runs the chain
-- fn_calculate_overhead_allocations → fn_calculate_project_profitability →
-- fn_generate_profit_shares to rebuild them. Two CFO clicks in two seconds
-- both DELETE, both re-run the chain, and the second INSERT can lose to
-- the (project_id, year_month) UNIQUE constraint added by 00034 — the
-- losing call surfaces as a generic 500 in the API route.
--
-- Fix: take a transaction-scoped Postgres advisory lock keyed on
-- p_year_month at the top of the function, after the auth and
-- closed-month guards. Two concurrent callers for the same year_month
-- serialize at the lock; different months still recompute in parallel.
-- The lock auto-releases when the transaction commits or rolls back —
-- no explicit unlock needed. The lock key is hashtext-derived so it
-- collapses to a single int4 the advisory-lock subsystem can use.
--
-- Apply: paste into Supabase Dashboard → SQL Editor.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. fn_calculate_overhead_allocations — lagged-revenue source (PS-1)
-- ---------------------------------------------------------------------------
-- Body identical to 00031:129–219 except the two revenue reads. The
-- IF v_method IS NULL THEN … END IF; default block, the agent-count read,
-- the shared-overhead read, the per-project FOR loop's pct math, the
-- INSERT/UPSERT, and the column lists are byte-identical to 00031.

CREATE OR REPLACE FUNCTION public.fn_calculate_overhead_allocations(p_year_month text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_method allocation_method;
  v_rev_weight NUMERIC(5,2);
  v_hc_weight NUMERIC(5,2);
  v_total_revenue NUMERIC(16,4);
  v_total_agents INTEGER;
  v_total_overhead_usd NUMERIC(16,4);
  v_total_overhead_kes NUMERIC(16,2);
  r RECORD;
BEGIN
  -- Get allocation rule for this month
  SELECT method, revenue_weight, headcount_weight
  INTO v_method, v_rev_weight, v_hc_weight
  FROM allocation_rules
  WHERE year_month = p_year_month;

  IF v_method IS NULL THEN
    v_method := 'headcount_based';
    v_rev_weight := 0;
    v_hc_weight := 100;
  END IF;

  -- PS-1: total revenue across all projects for the month, sourced from
  -- lagged_revenue_company_month per AGENTS.md rule #1 (was direct
  -- invoices.billing_period read in 00031:159). Scalar-subquery + COALESCE
  -- is NULL-safe whether the view returns no row or a row with NULL columns.
  SELECT
    COALESCE((SELECT total_revenue_usd FROM lagged_revenue_company_month
              WHERE expense_month = p_year_month), 0)
  INTO v_total_revenue;

  -- Total agents across all projects for this month
  SELECT COALESCE(SUM(agent_count), 0)
  INTO v_total_agents
  FROM agent_counts WHERE year_month = p_year_month;

  -- Total shared overhead for this month
  SELECT COALESCE(SUM(amount_usd), 0), COALESCE(SUM(amount_kes), 0)
  INTO v_total_overhead_usd, v_total_overhead_kes
  FROM expenses
  WHERE year_month = p_year_month AND expense_type = 'shared_expense'
    AND lifecycle_status = 'confirmed';

  -- For each active project, calculate allocation share.
  -- PS-1: per-project lagged revenue from lagged_revenue_by_project_month
  -- (was direct invoices.billing_period read in 00031:175).
  FOR r IN SELECT p.id AS project_id,
                  COALESCE((SELECT lagged_revenue_usd
                              FROM lagged_revenue_by_project_month
                             WHERE project_id = p.id
                               AND expense_month = p_year_month), 0) AS proj_revenue,
                  COALESCE((SELECT agent_count FROM agent_counts
                             WHERE project_id = p.id AND year_month = p_year_month), 0) AS proj_agents
           FROM projects p WHERE p.is_active = true
  LOOP
    DECLARE
      v_rev_pct NUMERIC(8,4) := 0;
      v_hc_pct NUMERIC(8,4) := 0;
      v_final_pct NUMERIC(8,4) := 0;
      v_alloc_usd NUMERIC(16,4) := 0;
      v_alloc_kes NUMERIC(16,2) := 0;
    BEGIN
      IF v_total_revenue > 0 THEN
        v_rev_pct := (r.proj_revenue / v_total_revenue) * 100;
      END IF;
      IF v_total_agents > 0 THEN
        v_hc_pct := (r.proj_agents::NUMERIC / v_total_agents) * 100;
      END IF;
      CASE v_method
        WHEN 'revenue_based' THEN v_final_pct := v_rev_pct;
        WHEN 'headcount_based' THEN v_final_pct := v_hc_pct;
        WHEN 'hybrid' THEN v_final_pct := (v_rev_pct * v_rev_weight / 100) + (v_hc_pct * v_hc_weight / 100);
      END CASE;
      v_alloc_usd := v_total_overhead_usd * v_final_pct / 100;
      v_alloc_kes := v_total_overhead_kes * v_final_pct / 100;
      INSERT INTO overhead_allocations (
        project_id, year_month, allocation_method,
        revenue_share_pct, headcount_share_pct, final_share_pct,
        allocated_amount_usd, allocated_amount_kes
      )
      VALUES (
        r.project_id, p_year_month, v_method,
        v_rev_pct, v_hc_pct, v_final_pct,
        v_alloc_usd, v_alloc_kes
      )
      ON CONFLICT (project_id, year_month) DO UPDATE SET
        allocation_method = EXCLUDED.allocation_method,
        revenue_share_pct = EXCLUDED.revenue_share_pct,
        headcount_share_pct = EXCLUDED.headcount_share_pct,
        final_share_pct = EXCLUDED.final_share_pct,
        allocated_amount_usd = EXCLUDED.allocated_amount_usd,
        allocated_amount_kes = EXCLUDED.allocated_amount_kes;
    END;
  END LOOP;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 2. fn_recompute_profit_share — advisory lock on p_year_month (PS-2)
-- ---------------------------------------------------------------------------
-- Body identical to 00033:67–147 except for the new pg_advisory_xact_lock
-- block placed after the auth and closed-month guards but BEFORE the DELETE.
-- A bad caller or a closed month is rejected fast; only valid recomputes
-- pay the (cheap) lock cost. Two concurrent valid recomputes for the same
-- year_month serialize; different months don't conflict.

CREATE OR REPLACE FUNCTION public.fn_recompute_profit_share(
  p_year_month TEXT,
  p_caller_id  UUID
)
RETURNS TABLE (
  year_month TEXT,
  rows_created INTEGER,
  total_director_share_kes NUMERIC,
  total_company_share_kes NUMERIC,
  loss_making_projects INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status month_status;
  v_rows_created INTEGER;
  v_total_director NUMERIC;
  v_total_company NUMERIC;
  v_loss_count INTEGER;
BEGIN
  -- Authorization: only CFOs can recompute (same gate as fn_close_month).
  -- Verify role via passed caller_id; auth.uid() is NULL under service-role.
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_caller_id AND role = 'cfo'
  ) THEN
    RAISE EXCEPTION 'Only CFO role can recompute profit share';
  END IF;

  -- Guard: refuse if the month is closed or locked. Recompute would silently
  -- invalidate downstream payouts and audit trail. Operator must reopen first.
  SELECT mc.status INTO v_status
  FROM month_closures mc
  WHERE mc.year_month = p_year_month;

  IF v_status IN ('closed', 'locked') THEN
    RAISE EXCEPTION 'Cannot recompute profit share for closed month %. Reopen the month first.', p_year_month;
  END IF;

  -- PS-2: serialize concurrent recomputes for the same year_month so two
  -- CFO clicks within seconds can't race on the DELETE-then-INSERT chain.
  -- Released automatically on transaction end. Different months still
  -- recompute in parallel — the lock key embeds p_year_month verbatim.
  PERFORM pg_advisory_xact_lock(
    hashtext('fn_recompute_profit_share:' || p_year_month)
  );

  -- Wipe existing profit_share_records for the month. Sidesteps any
  -- pre-existing duplicates and any uncertainty about the UNIQUE constraint
  -- in production (see DESIGN NOTES in migration 00032).
  DELETE FROM profit_share_records psr WHERE psr.year_month = p_year_month;

  -- Recalculate the chain in the same order as fn_close_month steps 1-3.
  -- fn_calculate_overhead_allocations writes overhead_allocations (UPSERT).
  PERFORM fn_calculate_overhead_allocations(p_year_month);

  -- fn_calculate_project_profitability writes project_profitability (UPSERT).
  -- Must run for every active project so fn_generate_profit_shares has rows
  -- to read in the next step.
  PERFORM fn_calculate_project_profitability(p.id, p_year_month)
  FROM projects p
  WHERE p.is_active = true;

  -- fn_generate_profit_shares reads project_profitability and INSERTs into
  -- profit_share_records. Post-00031 this no longer filters > 0, so every
  -- active project produces a row (signed shares for losses).
  PERFORM fn_generate_profit_shares(p_year_month);

  -- Compile summary for the operator.
  SELECT
    COUNT(*)::INTEGER,
    COALESCE(SUM(psr.director_share_kes), 0),
    COALESCE(SUM(psr.company_share_kes), 0),
    COUNT(*) FILTER (WHERE psr.director_share_kes < 0)::INTEGER
  INTO v_rows_created, v_total_director, v_total_company, v_loss_count
  FROM profit_share_records psr
  WHERE psr.year_month = p_year_month;

  RETURN QUERY SELECT
    p_year_month,
    v_rows_created,
    v_total_director,
    v_total_company,
    v_loss_count;
END;
$$;

COMMENT ON FUNCTION public.fn_recompute_profit_share(TEXT, UUID) IS
  'Manual recompute of profit_share_records for an OPEN month. Wipes and rebuilds via fn_calculate_overhead_allocations + fn_calculate_project_profitability (per active project) + fn_generate_profit_shares. Refuses on closed/locked months — reopen first. CFO-only via p_caller_id (service-role-safe). Serializes concurrent calls for the same year_month via pg_advisory_xact_lock (PS-2, migration 00055).';
