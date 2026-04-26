-- =====================================================================
-- F-05 BUG-001: Replace is_cfo() guards with p_caller_id parameter
--
-- BACKGROUND
-- fn_recompute_profit_share, fn_close_month, and fn_reopen_month gate on
-- is_cfo(), which itself depends on auth.uid(). Every API route that
-- invokes these RPCs uses createAdminClient() (service role); auth.uid()
-- returns NULL in that context, so is_cfo() always returns FALSE and the
-- exception fires for every caller — including legitimate CFOs.
--
-- Migration 00029 (F-06) documented this exact pattern and established
-- the canonical workaround: pass the caller's user_id explicitly and
-- verify the role with EXISTS (SELECT 1 FROM users WHERE id = p_caller_id
-- AND role = 'cfo'). This migration retrofits all three RPCs to that
-- pattern, and routes the same caller_id into the audit-trail writes
-- (closed_by, reopened_by) which previously stored NULL for the same
-- service-role / auth.uid() reason.
--
-- DEFENSE-IN-DEPTH PRESERVED
-- Each API route still does an inline JS role check via getAuthUserProfile
-- before calling these RPCs. The DB-side check is the second layer.
--
-- SIGNATURE CHANGES (require DROP first; CREATE OR REPLACE only matches
-- existing signatures, otherwise it overloads instead of replaces):
--   fn_recompute_profit_share(text)            → (text, uuid)
--   fn_close_month(text, jsonb)                → (text, uuid, jsonb)
--   fn_reopen_month(text, text)                → (text, uuid, text)
--
-- p_caller_id is positioned AFTER p_year_month and BEFORE any DEFAULTed
-- parameters (PG requires DEFAULTs to be trailing). Supabase JS callers
-- use named args, so positional order is irrelevant at the call site;
-- chosen for SQL ergonomics.
--
-- BODIES ARE BYTE-FOR-BYTE COPIES of the canonical sources:
--   fn_recompute_profit_share — migration 00032 lines 67–139
--   fn_close_month            — migration 00032 lines 158–205 (the
--                               redefinition with the G5 lock on
--                               profit_share_records is the canonical
--                               version; 00004's body is dead)
--   fn_reopen_month           — migration 00004 lines 567–595 (never
--                               redefined since)
-- Only three things change in each body:
--   1. The auth check (is_cfo() → EXISTS-by-id)
--   2. The exception message is byte-identical to the existing message
--      (the recompute route at route.ts:62 substring-matches it)
--   3. closed_by / reopened_by writes use p_caller_id instead of
--      auth.uid() (fn_close_month and fn_reopen_month only)
--
-- search_path / SECURITY DEFINER are preserved as each function
-- originally had them (fn_recompute_profit_share had SET search_path;
-- the other two never did — minimum-scope, do not add hardening that
-- wasn't there).
--
-- OUT OF SCOPE (filed separately)
-- - fn_lock_agent_count (trigger) and fn_protect_director_assignment
--   (trigger) also use is_cfo() and are similarly broken under service-
--   role UPDATEs. Trigger context cannot accept extra parameters; fix
--   shape needs its own design (GUC, JWT propagation, or RPC refactor).
--   Tracked as: "F-05 BUG-001 follow-up: trigger-context CFO overrides".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. fn_recompute_profit_share — manual recompute RPC (G4)
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.fn_recompute_profit_share(TEXT);

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
  'Manual recompute of profit_share_records for an OPEN month. Wipes and rebuilds via fn_calculate_overhead_allocations + fn_calculate_project_profitability (per active project) + fn_generate_profit_shares. Refuses on closed/locked months — reopen first. CFO-only via p_caller_id (service-role-safe; see migration 00033).';


-- ---------------------------------------------------------------------
-- 2. fn_close_month — CFO close + G5 lock symmetry
-- ---------------------------------------------------------------------
-- Body byte-identical to migration 00032 lines 158–205, except:
--   - Signature: gains p_caller_id UUID (placed before DEFAULTed param).
--   - is_cfo() guard replaced with EXISTS-by-id check on p_caller_id.
--   - closed_by writes use p_caller_id instead of auth.uid().
-- The G5 UPDATE profit_share_records SET is_locked = TRUE is preserved.

DROP FUNCTION IF EXISTS public.fn_close_month(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.fn_close_month(
  p_year_month TEXT,
  p_caller_id  UUID,
  p_warnings_acknowledged JSONB DEFAULT '[]'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_caller_id AND role = 'cfo'
  ) THEN
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
  VALUES (p_year_month, 'closed', p_warnings_acknowledged, p_caller_id, now())
  ON CONFLICT (year_month) DO UPDATE SET
    status = 'closed',
    warnings_acknowledged = p_warnings_acknowledged,
    closed_by = p_caller_id,
    closed_at = now();
END;
$$;


-- ---------------------------------------------------------------------
-- 3. fn_reopen_month — CFO reopen with reason
-- ---------------------------------------------------------------------
-- Body byte-identical to migration 00004 lines 567–595, except:
--   - Signature: gains p_caller_id UUID (placed before p_reason).
--   - is_cfo() guard replaced with EXISTS-by-id check on p_caller_id.
--   - reopened_by write uses p_caller_id instead of auth.uid().

DROP FUNCTION IF EXISTS public.fn_reopen_month(TEXT, TEXT);

CREATE OR REPLACE FUNCTION fn_reopen_month(
  p_year_month TEXT,
  p_caller_id  UUID,
  p_reason TEXT
)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_caller_id AND role = 'cfo'
  ) THEN
    RAISE EXCEPTION 'Only CFO can reopen months';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required to reopen a month';
  END IF;

  UPDATE month_closures SET
    status = 'open',
    reopened_by = p_caller_id,
    reopened_at = now(),
    reopen_reason = p_reason
  WHERE year_month = p_year_month;

  -- Unlock records
  UPDATE agent_counts SET is_locked = false WHERE year_month = p_year_month;
  UPDATE overhead_allocations SET is_locked = false WHERE year_month = p_year_month;
  UPDATE project_profitability SET is_locked = false WHERE year_month = p_year_month;
  UPDATE profit_share_records SET is_locked = false WHERE year_month = p_year_month;
  UPDATE monthly_financial_snapshots SET is_locked = false WHERE year_month = p_year_month;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
