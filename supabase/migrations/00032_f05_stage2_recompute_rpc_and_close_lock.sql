-- =====================================================================
-- F-05 Stage 2 Checkpoint 2: Recompute RPC + close-month lock symmetry.
--
-- BACKGROUND
-- 00031 (Checkpoint 1) fixed the calculation logic so fn_generate_profit_shares
-- now produces signed director shares for every active project, and
-- fn_calculate_overhead_allocations defaults to headcount-based allocation.
-- The engine produces correct numbers when invoked.
--
-- However, the engine is only invoked by fn_close_month today. There is no
-- way to populate profit_share_records for the current open month without
-- closing it. April 2026 is the open month; the 2 hand-seeded rows there
-- need to be replaced with computed values without locking the month.
--
-- This migration adds:
--   1. fn_recompute_profit_share(p_year_month TEXT): wipes profit_share_records
--      for the month and recomputes via the existing calculation chain. Refuses
--      to run on closed/locked months — operator must reopen first. Returns a
--      summary table.
--   2. fn_close_month addendum (G5): adds UPDATE profit_share_records SET
--      is_locked = TRUE at the end, mirroring fn_reopen_month's unlock.
--
-- DESIGN NOTES
-- - Calculation chain inside fn_recompute_profit_share mirrors steps 1-3 of
--   fn_close_month (overhead_allocations → project_profitability per active
--   project → profit_share_records). fn_generate_monthly_snapshot is NOT
--   called: it produces company-wide totals that drive snapshot reads for
--   closed/locked months only, irrelevant to an open-month recompute.
-- - DELETE-then-INSERT for profit_share_records: pragmatic against any
--   pre-existing seed rows that may duplicate on (project_id, year_month).
--   project_profitability and overhead_allocations are not pre-deleted —
--   their underlying functions UPSERT via ON CONFLICT (project_id,
--   year_month), which cleanly overwrites without DELETE. profit_share_records
--   gets the DELETE treatment specifically because its (project_id,
--   year_month) UNIQUE constraint state in production is uncertain (2 hand-
--   seeded rows for 2026-04 may indicate the constraint is absent — Stage 1-
--   style drift). DELETE eliminates conflicts before fn_generate_profit_shares'
--   INSERT runs, so the recompute is deterministic regardless of constraint
--   state.
-- - If the UNIQUE constraint IS missing in production, fn_generate_profit_shares'
--   INSERT … ON CONFLICT (project_id, year_month) clause will error with
--   "no unique or exclusion constraint matching the ON CONFLICT specification".
--   That surfaces clearly to the operator; track as a follow-up to install
--   the missing constraint. Not blocking for this migration.
-- - Closed-month block: prevents silent recomputation that would invalidate
--   downstream payout calculations and audit trails. Reopen + recompute +
--   re-close is the explicit workflow for historical fixes.
-- - SECURITY DEFINER on fn_recompute_profit_share: same RLS reasoning as
--   Stage 1 trigger functions — the operator may not have direct DELETE/INSERT
--   permission on profit_share_records, but is_cfo() can authorize the recompute.
-- - SET search_path = public, pg_temp: standard hardening.
-- - Row IDs change on recompute. Acceptable while no real payouts reference
--   profit_share_records.id (production has 0 director_payouts rows as of
--   2026-04-26). Revisit when real payout volume starts.
--
-- DEFERRED
-- - Snapshot regeneration on recompute (fn_generate_monthly_snapshot): not
--   needed for open-month workflows; the snapshot only matters for closed/
--   locked months which already have their values frozen at last-close.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. fn_recompute_profit_share — manual recompute RPC (G4)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_recompute_profit_share(p_year_month TEXT)
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
  IF NOT is_cfo() THEN
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

  -- Wipe existing profit_share_records for the month. Sidesteps any
  -- pre-existing duplicates and any uncertainty about the UNIQUE constraint
  -- in production (see DESIGN NOTES).
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

COMMENT ON FUNCTION public.fn_recompute_profit_share(TEXT) IS
  'Manual recompute of profit_share_records for an OPEN month. Wipes and rebuilds via fn_calculate_overhead_allocations + fn_calculate_project_profitability (per active project) + fn_generate_profit_shares. Refuses on closed/locked months — reopen first. CFO-only.';


-- ---------------------------------------------------------------------
-- 2. fn_close_month — add G5 lock symmetry
-- ---------------------------------------------------------------------
-- Body identical to 00004:520-561 EXCEPT one additional UPDATE statement
-- after fn_generate_profit_shares populates profit_share_records:
--     UPDATE profit_share_records SET is_locked = true
--       WHERE year_month = p_year_month;
-- The new line lives alongside the existing locks for agent_counts,
-- overhead_allocations, and project_profitability. Mirrors fn_reopen_month
-- (00004:567-595) which already unlocks profit_share_records on reopen.
--
-- All other lines are byte-identical to 00004:520-561.

CREATE OR REPLACE FUNCTION public.fn_close_month(
  p_year_month TEXT,
  p_warnings_acknowledged JSONB DEFAULT '[]'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_cfo() THEN
    RAISE EXCEPTION 'Only CFO can close months';
  END IF;

  -- Calculate overhead allocations
  PERFORM fn_calculate_overhead_allocations(p_year_month);

  -- Calculate profitability for each project
  PERFORM fn_calculate_project_profitability(p.id, p_year_month)
  FROM projects p WHERE p.is_active = true;

  -- Generate profit share records
  PERFORM fn_generate_profit_shares(p_year_month);

  -- Generate monthly snapshot
  PERFORM fn_generate_monthly_snapshot(p_year_month);

  -- Lock agent counts
  UPDATE agent_counts SET is_locked = true WHERE year_month = p_year_month;

  -- Lock allocations
  UPDATE overhead_allocations SET is_locked = true WHERE year_month = p_year_month;

  -- Lock profitability
  UPDATE project_profitability SET is_locked = true WHERE year_month = p_year_month;

  -- Lock profit share records (G5: mirror fn_reopen_month's unlock)
  UPDATE profit_share_records SET is_locked = true WHERE year_month = p_year_month;

  -- Update month closure record
  INSERT INTO month_closures (year_month, status, warnings_acknowledged, closed_by, closed_at)
  VALUES (p_year_month, 'closed', p_warnings_acknowledged, auth.uid(), now())
  ON CONFLICT (year_month) DO UPDATE SET
    status = 'closed',
    warnings_acknowledged = p_warnings_acknowledged,
    closed_by = auth.uid(),
    closed_at = now();
END;
$$;
