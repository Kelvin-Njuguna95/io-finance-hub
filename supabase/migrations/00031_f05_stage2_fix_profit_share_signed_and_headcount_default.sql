-- =====================================================================
-- F-05 Stage 2 Checkpoint 1: Fix two calculation engine divergences from spec.
--
-- BACKGROUND
-- The Stage 2 diagnosis (/tmp/f05_stage2_diagnosis.md) identified two
-- blocking divergences between the live calculation engine and the locked-
-- in F-05 design spec:
--
-- G1 — fn_generate_profit_shares (00004:343) filtered
--      WHERE pp.distributable_profit_usd > 0, silently dropping loss-making
--      projects from profit_share_records. Per design, every active project
--      gets a row each month with signed director_share — negative when the
--      project loses money for the month. Filter removed; signed shares
--      now flow through correctly. ROUND in Postgres handles negative
--      inputs symmetrically (ROUND(-100 * 0.70, 4) = -70.0000), so no
--      other body changes are needed.
--
-- G2 — fn_calculate_overhead_allocations (00025:145) defaulted the
--      allocation method to 'revenue_based' when no allocation_rules row
--      existed for the month. Per design, allocation is strictly
--      proportional to agent count ('headcount_based'). The headcount logic
--      is already implemented in the function; only the default branch
--      flips, plus the cosmetic v_rev_weight / v_hc_weight pair flips
--      from 100/0 to 0/100 for self-consistency. Per-month overrides via
--      allocation_rules continue to win over the default.
--
-- DESIGN NOTES
-- - Both fixes are CREATE OR REPLACE FUNCTION rewrites with no signature
--   changes, no schema changes, no new objects.
-- - Both functions retain SECURITY DEFINER as in their existing
--   definitions; both retain LANGUAGE plpgsql.
-- - Function signatures preserved exactly. Bodies copied byte-for-byte
--   from production with only the surgical changes above.
-- - Migration is idempotent: re-running it overwrites with the same body.
--
-- REGRESSION ANALYSIS
-- - fn_close_month calls fn_generate_profit_shares via PERFORM and does
--   not inspect its results. After this migration, fn_close_month simply
--   UPSERTs more rows (one per active project, not only profitable ones).
-- - Stage 1 triggers (00030) read director_share_kes to maintain
--   balance_remaining and payout_status. With negative director_share_kes,
--   balance_remaining becomes negative, the withdrawal-create gating
--   correctly rejects all positive payments against it, and the
--   director_payouts.amount_kes > 0 CHECK constraint blocks any "negative
--   payout to offset" workaround. No trigger logic breaks.
-- - UI consumers (profit-share/page.tsx) display negative shares as '—'
--   today via existing client-side > 0 checks. After this migration,
--   negative shares are present in the data but hidden by the existing
--   UI. Tracked for Stage 3 UI cleanup; not blocking.
--
-- DEFERRED
-- - G3 (lagged-revenue routing in fn_calculate_project_profitability)
--   will land in a later Stage 2 migration after the lagged view's
--   column shape is verified.
-- - G5 (fn_close_month doesn't lock profit_share_records when closing)
--   will land in 00032 (Stage 2B), which redefines fn_close_month
--   alongside the new fn_recompute_profit_share RPC and can address
--   lock state holistically.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. fn_generate_profit_shares — drop the >0 filter (G1)
-- ---------------------------------------------------------------------
-- Body identical to 00004:343-382 except the WHERE clause loses
-- `AND pp.distributable_profit_usd > 0`. Function declaration uses the
-- modern `LANGUAGE … SECURITY DEFINER … AS $$ … $$` ordering convention
-- used in 00025/00028/00029/00030. Behaviourally equivalent to the
-- original except for the filter removal.

CREATE OR REPLACE FUNCTION public.fn_generate_profit_shares(p_year_month TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pp.project_id, pp.distributable_profit_usd, pp.distributable_profit_kes,
           p.director_tag, p.director_user_id
    FROM project_profitability pp
    JOIN projects p ON p.id = pp.project_id
    WHERE pp.year_month = p_year_month
  LOOP
    INSERT INTO profit_share_records (
      project_id, year_month, director_tag, director_user_id,
      distributable_profit_usd, distributable_profit_kes,
      director_share_usd, director_share_kes,
      company_share_usd, company_share_kes,
      status
    )
    VALUES (
      r.project_id, p_year_month, r.director_tag, r.director_user_id,
      r.distributable_profit_usd, r.distributable_profit_kes,
      ROUND(r.distributable_profit_usd * 0.70, 4),
      ROUND(r.distributable_profit_kes * 0.70, 2),
      ROUND(r.distributable_profit_usd * 0.30, 4),
      ROUND(r.distributable_profit_kes * 0.30, 2),
      'pending_review'
    )
    ON CONFLICT (project_id, year_month) DO UPDATE SET
      distributable_profit_usd = EXCLUDED.distributable_profit_usd,
      distributable_profit_kes = EXCLUDED.distributable_profit_kes,
      director_share_usd = EXCLUDED.director_share_usd,
      director_share_kes = EXCLUDED.director_share_kes,
      company_share_usd = EXCLUDED.company_share_usd,
      company_share_kes = EXCLUDED.company_share_kes,
      status = 'pending_review';
  END LOOP;
END;
$$;


-- ---------------------------------------------------------------------
-- 2. fn_calculate_overhead_allocations — flip default to headcount_based (G2)
-- ---------------------------------------------------------------------
-- Body identical to 00025:145-235 except for three lines inside the
--     IF v_method IS NULL THEN … END IF;
-- block:
--   v_method      'revenue_based' → 'headcount_based'
--   v_rev_weight  100             → 0
--   v_hc_weight   0               → 100
-- The CASE expression below picks v_final_pct := v_hc_pct directly when
-- v_method='headcount_based', so the weight flip is documentary; it
-- exists for self-consistency if anyone later changes the default's
-- method to 'hybrid'.

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

  -- Total revenue across all projects for this month
  SELECT COALESCE(SUM(amount_usd), 0)
  INTO v_total_revenue
  FROM invoices WHERE billing_period = p_year_month;

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

  -- For each active project, calculate allocation share
  FOR r IN SELECT p.id AS project_id,
                  COALESCE((SELECT SUM(amount_usd) FROM invoices WHERE project_id = p.id AND billing_period = p_year_month), 0) AS proj_revenue,
                  COALESCE((SELECT agent_count FROM agent_counts WHERE project_id = p.id AND year_month = p_year_month), 0) AS proj_agents
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
