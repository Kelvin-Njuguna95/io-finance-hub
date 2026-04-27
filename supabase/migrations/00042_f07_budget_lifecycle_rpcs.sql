-- =====================================================================
-- F-07: Budget lifecycle RPCs (atomic state transitions)
--       + F-30 mitigation (current-version filter on variance + red flags)
-- =====================================================================
-- Closes AUDIT_1 finding F-07 (resubmit-in-place destroys audit trail;
-- Phase 1 surfaced the pattern is systemic across all 6 budget status-
-- change routes) and F-30 (latent: variance view and red-flags overspend
-- function would silently sum stale `approved` versions once budgets
-- carry multiple historical versions).
--
-- Architecture mirrors 00029_f06_expense_lifecycle_rpcs.sql:
--   * One RPC per logical transition. Each is one PL/pgSQL function =
--     one transaction. Status guards prevent invalid transitions.
--     Concurrency-safe via SELECT ... FOR UPDATE row locks on the
--     parent budget row.
--   * SECURITY DEFINER. Authorization via the passed user_id (rationale
--     in 00029 §header — same pattern; routes use service-role client
--     where auth.uid() is NULL).
--   * Errors raise with ERRCODE='P0001' and structured HINT/DETAIL for
--     the API route to translate.
--   * Audit trail: each RPC manually inserts an audit_logs row with the
--     passed user_id (Decision 1 from F-07 Phase 2 plan; closes the
--     auth.uid()=NULL gap that the audit_budget_versions trigger would
--     otherwise leave). The fn_audit_log trigger ALSO fires on each
--     INSERT/UPDATE; this produces a second audit row per event with
--     user_id=NULL. The two-row pattern is acceptable: the manual row
--     has full attribution, the trigger row is the structural fallback.
--
-- Item-cloning principle: every RPC that creates a new budget_versions
-- row also clones budget_items into the new version (with new IDs;
-- budget_items.budget_version_id is the FK link). Each transition has
-- its own clone-time logic for the budget_items pm_* fields:
--   * resubmit / withdraw: reset all pm_* fields (going back to draft/
--     pm_review for fresh review)
--   * pm_review approve/return/reject: preserve pm_* fields (PM may
--     have done line-level work via pm-line-review prior actions; that
--     work carries forward to the new version)
--   * pm_line_review_submit: preserve pm_* fields (the entire purpose
--     is to snapshot the line decisions into the new version)
--   * cfo_approve/cfo_revert: preserve pm_* fields
--
-- F-30 fix: variance_summary_by_project view and fn_generate_red_flags
-- both join budget_versions on `bv.status = 'approved'` without a
-- current-version filter. Today this is benign because the F-07 in-
-- place mutation pattern means each budget has at most one approved
-- version at any time. The moment F-07 RPCs land, an approve→revert→
-- re-approve cycle leaves a stale 'approved' version in the table,
-- and the view/function silently double-count. Bundling the F-30 fix
-- here ensures the moment F-07 ships, F-30 is already mitigated.
--
-- Out of scope for this migration (tracked separately):
--   * cfo-revert delete action — destructive, leaves in-place per F-07
--     Phase 2 decision 2. Deletion is not a status transition; the
--     audit-trail concern doesn't apply.
--   * pm-line-review update_item / bulk_approve actions — per-line
--     working-draft edits during pm_review state. Not status
--     transitions; immutability principle applies only on transition
--     out of pm_review (handled by fn_budget_pm_line_review_submit).
--   * cfo-approve mark_under_review — included as a third p_action on
--     fn_budget_cfo_approve for completeness; same pattern.
--   * The notifications system (F-10 closure) and the
--     auto-populate-expenses side effect of cfo-approve — both stay in
--     the route, post-RPC.
--   * audit_logs.user_id=NULL on the trigger-fired audit row remains
--     a separate observability concern (sibling of D-2 in 00029).
-- =====================================================================


-- ---------------------------------------------------------------------------
-- §1. Codify drift columns referenced by application code and the RPCs
--     below but absent from the migration tree (F-02/F-33/F-10 family).
-- ---------------------------------------------------------------------------
-- Production has these columns; the routes wouldn't work otherwise.
-- The migration tree did not. Same shape correction as 00037 (F-02),
-- 00038 (F-18), 00039 (F-33), 00040 (F-10) — codifies live schema.
-- All ADD COLUMN IF NOT EXISTS; idempotent; no-op on production.

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS pm_review_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_reviewer_id UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS pm_original_total NUMERIC(16, 2),
  ADD COLUMN IF NOT EXISTS pm_approved_total NUMERIC(16, 2),
  ADD COLUMN IF NOT EXISTS pm_review_summary JSONB,
  ADD COLUMN IF NOT EXISTS cfo_return_reason TEXT;

ALTER TABLE public.budget_versions
  ADD COLUMN IF NOT EXISTS pm_reviewed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS pm_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_return_reason TEXT,
  ADD COLUMN IF NOT EXISTS pm_rejection_reason TEXT;

ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS pm_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS pm_approved_amount NUMERIC(16, 2),
  ADD COLUMN IF NOT EXISTS pm_adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS pm_reviewed_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS pm_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_review_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_notes TEXT;

ALTER TABLE public.budget_approvals
  ADD COLUMN IF NOT EXISTS pm_review_skipped BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS budget_approval_revoked BOOLEAN DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budget_versions' AND column_name='pm_return_reason')
  THEN RAISE EXCEPTION 'F-07: budget_versions.pm_return_reason missing after codification preamble'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budget_items' AND column_name='pm_status')
  THEN RAISE EXCEPTION 'F-07: budget_items.pm_status missing after codification preamble'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='budgets' AND column_name='pm_review_opened_at')
  THEN RAISE EXCEPTION 'F-07: budgets.pm_review_opened_at missing after codification preamble'; END IF;
END $$;


-- ---------------------------------------------------------------------------
-- §2. RPCs
-- ---------------------------------------------------------------------------
-- Helper macro (conceptual): each RPC follows this skeleton:
--   1. Authorization check (role + ownership) using p_*_by user_id.
--   2. Lock parent budget row (SELECT ... FOR UPDATE).
--   3. Re-read current version inside the lock (TOCTOU prevention).
--   4. Status guard for the transition.
--   5. Month-closure guard.
--   6. Compute new version_number = b.current_version + 1.
--   7. INSERT new budget_versions row (carrying forward content fields,
--      setting transition-specific status/audit fields).
--   8. INSERT cloned budget_items into new version (with per-RPC pm_*
--      reset / preserve logic).
--   9. UPDATE budgets.current_version (and any other side fields).
--  10. Side effects unique to this transition (e.g., expenses
--      budget_approval_revoked flag for cfo_revert).
--  11. INSERT audit_logs row with full user_id attribution.
--  12. RETURN new budget_versions row.

-- ===========================================================================
-- 2a. fn_budget_resubmit
--     Source statuses: returned_to_tl, pm_rejected, rejected, draft
--     Target status:   pm_review (TL/Accountant) | pm_approved (PM/CFO)
--     Items: cloned, all pm_* fields reset
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_resubmit(
  p_budget_id UUID,
  p_resubmitter_id UUID
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_resubmitter_role public.user_role;
  v_new_status public.budget_status;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_old_item public.budget_items;
BEGIN
  SELECT role INTO v_resubmitter_role FROM public.users WHERE id = p_resubmitter_id;
  IF v_resubmitter_role IS NULL OR v_resubmitter_role NOT IN
       ('team_leader'::user_role, 'accountant'::user_role,
        'project_manager'::user_role, 'cfo'::user_role)
  THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot resubmit budgets', p_resubmitter_id
      USING ERRCODE='P0001', HINT='only TL, Accountant, PM, or CFO';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  IF v_budget.created_by <> p_resubmitter_id AND v_resubmitter_role <> 'cfo'::user_role THEN
    RAISE EXCEPTION 'only the budget creator or CFO can resubmit'
      USING ERRCODE='P0001';
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no current version for budget %', p_budget_id USING ERRCODE='P0001';
  END IF;

  IF v_current.status NOT IN
       ('returned_to_tl'::budget_status, 'pm_rejected'::budget_status,
        'rejected'::budget_status, 'draft'::budget_status)
  THEN
    RAISE EXCEPTION 'cannot resubmit budget in status %', v_current.status
      USING ERRCODE='P0001', HINT='source must be returned_to_tl, pm_rejected, rejected, or draft';
  END IF;

  v_new_status := CASE
    WHEN v_resubmitter_role IN ('project_manager'::user_role, 'cfo'::user_role)
      THEN 'pm_approved'::budget_status
    ELSE 'pm_review'::budget_status
  END;

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes
  ) VALUES (
    p_budget_id, v_new_version_number, v_new_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    p_resubmitter_id, now(), v_current.notes
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      'pending'
    );
  END LOOP;

  UPDATE public.budgets
     SET current_version = v_new_version_number,
         pm_review_opened_at = NULL,
         pm_reviewer_id = NULL
   WHERE id = p_budget_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    p_resubmitter_id, 'budget_resubmitted', 'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status),
    jsonb_build_object('version_number', v_new_version_number, 'status', v_new_status)
  );

  RETURN v_new;
END;
$$;


-- ===========================================================================
-- 2b. fn_budget_pm_review
--     Source status:   pm_review
--     Target statuses: pm_approved (action=approve)
--                      returned_to_tl (action=return; comments required)
--                      pm_rejected (action=reject; comments required)
--     Items: cloned with pm_* preserved (PM may have done line work)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_pm_review(
  p_budget_id UUID,
  p_pm_id UUID,
  p_action TEXT,
  p_comments TEXT
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_pm_role public.user_role;
  v_new_status public.budget_status;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_assignment_count INTEGER;
  v_old_item public.budget_items;
BEGIN
  IF p_action NOT IN ('approve', 'return', 'reject') THEN
    RAISE EXCEPTION 'invalid action %, expected approve|return|reject', p_action
      USING ERRCODE='P0001';
  END IF;

  IF p_action IN ('return', 'reject') AND (p_comments IS NULL OR length(trim(p_comments)) = 0) THEN
    RAISE EXCEPTION 'comments are required for action %', p_action USING ERRCODE='P0001';
  END IF;

  SELECT role INTO v_pm_role FROM public.users WHERE id = p_pm_id;
  IF v_pm_role IS NULL OR v_pm_role NOT IN ('project_manager'::user_role, 'cfo'::user_role) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot perform PM review', p_pm_id
      USING ERRCODE='P0001', HINT='only PM or CFO';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  IF v_pm_role <> 'cfo'::user_role THEN
    SELECT COUNT(*) INTO v_assignment_count FROM public.user_project_assignments
     WHERE user_id = p_pm_id AND project_id = v_budget.project_id;
    IF v_assignment_count = 0 THEN
      RAISE EXCEPTION 'PM % is not assigned to project %', p_pm_id, v_budget.project_id
        USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;
  IF v_current.status <> 'pm_review'::budget_status THEN
    RAISE EXCEPTION 'cannot PM-review budget in status %', v_current.status
      USING ERRCODE='P0001', HINT='source must be pm_review';
  END IF;

  v_new_status := CASE p_action
    WHEN 'approve' THEN 'pm_approved'::budget_status
    WHEN 'return'  THEN 'returned_to_tl'::budget_status
    WHEN 'reject'  THEN 'pm_rejected'::budget_status
  END;

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes,
    pm_reviewed_by, pm_reviewed_at,
    pm_return_reason, pm_rejection_reason
  ) VALUES (
    p_budget_id, v_new_version_number, v_new_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    v_current.submitted_by, v_current.submitted_at, v_current.notes,
    p_pm_id, now(),
    CASE WHEN p_action = 'return' THEN p_comments ELSE NULL END,
    CASE WHEN p_action = 'reject' THEN p_comments ELSE NULL END
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status, pm_approved_amount, pm_adjustment_reason,
      pm_reviewed_by, pm_reviewed_at, pm_notes
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      v_old_item.pm_status, v_old_item.pm_approved_amount, v_old_item.pm_adjustment_reason,
      v_old_item.pm_reviewed_by, v_old_item.pm_reviewed_at, v_old_item.pm_notes
    );
  END LOOP;

  UPDATE public.budgets
     SET current_version = v_new_version_number,
         pm_review_opened_at = COALESCE(v_budget.pm_review_opened_at, now()),
         pm_reviewer_id = p_pm_id
   WHERE id = p_budget_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    p_pm_id,
    'pm_budget_' || (CASE p_action WHEN 'return' THEN 'returned' ELSE p_action || 'ed' END),
    'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status),
    jsonb_build_object('version_number', v_new_version_number, 'status', v_new_status, 'comments', p_comments)
  );

  RETURN v_new;
END;
$$;


-- ===========================================================================
-- 2c. fn_budget_pm_line_review_submit
--     Source status:   pm_review (with all items reviewed — pm_status != pending)
--     Target status:   pm_approved
--     Items: cloned with pm_* values snapshotted (the working-draft per-line
--            decisions become the immutable record on the new version)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_pm_line_review_submit(
  p_budget_id UUID,
  p_pm_id UUID
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_pm_role public.user_role;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_assignment_count INTEGER;
  v_pending_count INTEGER;
  v_original_total NUMERIC(16,2);
  v_approved_total NUMERIC(16,2);
  v_summary JSONB;
  v_old_item public.budget_items;
BEGIN
  SELECT role INTO v_pm_role FROM public.users WHERE id = p_pm_id;
  IF v_pm_role IS NULL OR v_pm_role NOT IN ('project_manager'::user_role, 'cfo'::user_role) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot submit PM review', p_pm_id
      USING ERRCODE='P0001', HINT='only PM or CFO';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  IF v_pm_role <> 'cfo'::user_role THEN
    SELECT COUNT(*) INTO v_assignment_count FROM public.user_project_assignments
     WHERE user_id = p_pm_id AND project_id = v_budget.project_id;
    IF v_assignment_count = 0 THEN
      RAISE EXCEPTION 'PM % is not assigned to project %', p_pm_id, v_budget.project_id
        USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;
  IF v_current.status <> 'pm_review'::budget_status THEN
    RAISE EXCEPTION 'cannot submit PM line review for budget in status %', v_current.status
      USING ERRCODE='P0001', HINT='source must be pm_review';
  END IF;

  SELECT COUNT(*) INTO v_pending_count FROM public.budget_items
   WHERE budget_version_id = v_current.id AND (pm_status IS NULL OR pm_status = 'pending');
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION '% line items still pending review', v_pending_count
      USING ERRCODE='P0001', HINT='review every line item before submitting';
  END IF;

  SELECT COALESCE(SUM(amount_kes), 0),
         COALESCE(SUM(CASE WHEN pm_status IN ('approved','adjusted') THEN COALESCE(pm_approved_amount, 0) ELSE 0 END), 0)
    INTO v_original_total, v_approved_total
    FROM public.budget_items
   WHERE budget_version_id = v_current.id;

  v_summary := jsonb_build_object(
    'approved_count',
      (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'approved'),
    'adjusted_count',
      (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'adjusted'),
    'removed_count',
      (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'removed'),
    'original_total', v_original_total,
    'approved_total', v_approved_total,
    'variance', v_original_total - v_approved_total
  );

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes,
    pm_reviewed_by, pm_reviewed_at
  ) VALUES (
    p_budget_id, v_new_version_number, 'pm_approved'::budget_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    v_current.submitted_by, v_current.submitted_at, v_current.notes,
    p_pm_id, now()
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status, pm_approved_amount, pm_adjustment_reason,
      pm_reviewed_by, pm_reviewed_at, pm_notes
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      v_old_item.pm_status, v_old_item.pm_approved_amount, v_old_item.pm_adjustment_reason,
      v_old_item.pm_reviewed_by, v_old_item.pm_reviewed_at, v_old_item.pm_notes
    );
  END LOOP;

  UPDATE public.budgets
     SET current_version = v_new_version_number,
         pm_original_total = v_original_total,
         pm_approved_total = v_approved_total,
         pm_review_summary = v_summary
   WHERE id = p_budget_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    p_pm_id, 'pm_review_submitted', 'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status),
    v_summary || jsonb_build_object('version_number', v_new_version_number, 'status', 'pm_approved')
  );

  RETURN v_new;
END;
$$;


-- ===========================================================================
-- 2d. fn_budget_cfo_approve
--     Source statuses: submitted, pm_review, pm_approved, under_review
--     Target statuses: approved (action=approve)
--                      rejected (action=reject; reason required)
--                      under_review (action=mark_under_review)
--     Items: cloned with pm_* preserved
--     Side effects: budget_approvals row inserted; budgets totals updated
--                   on approve. Auto-populate-expenses runs in the route
--                   POST-RPC (out of scope here).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_cfo_approve(
  p_budget_id UUID,
  p_cfo_id UUID,
  p_action TEXT,
  p_reason TEXT
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_cfo_role public.user_role;
  v_new_status public.budget_status;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_pm_review_skipped BOOLEAN := FALSE;
  v_original_total NUMERIC(16,2);
  v_approved_total NUMERIC(16,2);
  v_summary JSONB;
  v_old_item public.budget_items;
BEGIN
  IF p_action NOT IN ('approve', 'reject', 'mark_under_review') THEN
    RAISE EXCEPTION 'invalid action %', p_action
      USING ERRCODE='P0001', HINT='approve|reject|mark_under_review';
  END IF;

  IF p_action = 'reject' AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'reason required for reject' USING ERRCODE='P0001';
  END IF;

  SELECT role INTO v_cfo_role FROM public.users WHERE id = p_cfo_id;
  IF v_cfo_role IS NULL OR v_cfo_role <> 'cfo'::user_role THEN
    RAISE EXCEPTION 'unauthorized: caller % is not CFO', p_cfo_id USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;

  IF p_action = 'approve' THEN
    IF v_current.status NOT IN
         ('submitted'::budget_status, 'pm_review'::budget_status,
          'pm_approved'::budget_status, 'under_review'::budget_status)
    THEN
      RAISE EXCEPTION 'cannot CFO-approve budget in status %', v_current.status
        USING ERRCODE='P0001', HINT='source must be submitted, pm_review, pm_approved, or under_review';
    END IF;

    v_pm_review_skipped := v_current.status <> 'pm_approved'::budget_status;

    SELECT COALESCE(SUM(amount_kes), 0) INTO v_original_total
      FROM public.budget_items WHERE budget_version_id = v_current.id;

    IF v_pm_review_skipped THEN
      v_approved_total := v_original_total;
    ELSE
      SELECT COALESCE(SUM(CASE WHEN pm_status IN ('approved','adjusted')
                          THEN COALESCE(pm_approved_amount, amount_kes, 0) ELSE 0 END), 0)
        INTO v_approved_total
        FROM public.budget_items WHERE budget_version_id = v_current.id;
    END IF;

    v_summary := jsonb_build_object(
      'approved_count', CASE WHEN v_pm_review_skipped
        THEN (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id)
        ELSE (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'approved')
      END,
      'adjusted_count', CASE WHEN v_pm_review_skipped THEN 0
        ELSE (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'adjusted')
      END,
      'removed_count', CASE WHEN v_pm_review_skipped THEN 0
        ELSE (SELECT COUNT(*) FROM public.budget_items WHERE budget_version_id = v_current.id AND pm_status = 'removed')
      END,
      'original_total', v_original_total,
      'approved_total', v_approved_total,
      'variance', v_original_total - v_approved_total,
      'pm_review_skipped', v_pm_review_skipped
    );
  ELSIF p_action = 'reject' THEN
    IF v_current.status NOT IN
         ('submitted'::budget_status, 'pm_review'::budget_status,
          'pm_approved'::budget_status, 'under_review'::budget_status)
    THEN
      RAISE EXCEPTION 'cannot CFO-reject budget in status %', v_current.status
        USING ERRCODE='P0001';
    END IF;
  ELSE -- mark_under_review
    IF v_current.status NOT IN ('submitted'::budget_status, 'pm_approved'::budget_status) THEN
      RAISE EXCEPTION 'cannot mark under_review from status %', v_current.status USING ERRCODE='P0001';
    END IF;
  END IF;

  v_new_status := CASE p_action
    WHEN 'approve'           THEN 'approved'::budget_status
    WHEN 'reject'            THEN 'rejected'::budget_status
    WHEN 'mark_under_review' THEN 'under_review'::budget_status
  END;

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes,
    pm_reviewed_by, pm_reviewed_at,
    pm_return_reason, pm_rejection_reason,
    reviewed_by, reviewed_at, rejection_reason
  ) VALUES (
    p_budget_id, v_new_version_number, v_new_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    v_current.submitted_by, v_current.submitted_at, v_current.notes,
    v_current.pm_reviewed_by, v_current.pm_reviewed_at,
    v_current.pm_return_reason, v_current.pm_rejection_reason,
    p_cfo_id, now(),
    CASE WHEN p_action = 'reject' THEN p_reason ELSE NULL END
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status, pm_approved_amount, pm_adjustment_reason,
      pm_reviewed_by, pm_reviewed_at, pm_notes
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      v_old_item.pm_status, v_old_item.pm_approved_amount, v_old_item.pm_adjustment_reason,
      v_old_item.pm_reviewed_by, v_old_item.pm_reviewed_at, v_old_item.pm_notes
    );
  END LOOP;

  IF p_action = 'approve' THEN
    UPDATE public.budgets
       SET current_version = v_new_version_number,
           pm_original_total = v_original_total,
           pm_approved_total = v_approved_total,
           pm_review_summary = v_summary
     WHERE id = p_budget_id;

    INSERT INTO public.budget_approvals (budget_version_id, action, approved_by, pm_review_skipped)
    VALUES (v_new.id, 'approved', p_cfo_id, v_pm_review_skipped);
  ELSIF p_action = 'reject' THEN
    UPDATE public.budgets SET current_version = v_new_version_number WHERE id = p_budget_id;

    INSERT INTO public.budget_approvals (budget_version_id, action, approved_by, reason)
    VALUES (v_new.id, 'rejected', p_cfo_id, p_reason);
  ELSE
    UPDATE public.budgets SET current_version = v_new_version_number WHERE id = p_budget_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    p_cfo_id, 'cfo_budget_' || (CASE p_action
      WHEN 'approve' THEN 'approved'
      WHEN 'reject' THEN 'rejected'
      ELSE 'marked_under_review' END),
    'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status),
    jsonb_build_object('version_number', v_new_version_number, 'status', v_new_status,
                       'reason', p_reason, 'pm_review_skipped', v_pm_review_skipped)
  );

  RETURN v_new;
END;
$$;


-- ===========================================================================
-- 2e. fn_budget_cfo_revert  (send_back ONLY; delete left in-place per Phase 2)
--     Source status:   approved
--     Target status:   returned_to_tl
--     Items: cloned with pm_* preserved
--     Side effects: linked expenses get budget_approval_revoked = TRUE.
--                   budgets.cfo_return_reason set; pm_approved_total cleared.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_cfo_revert(
  p_budget_id UUID,
  p_cfo_id UUID,
  p_reason TEXT
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_cfo_role public.user_role;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_old_item public.budget_items;
  v_expense_count INTEGER;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required to revert' USING ERRCODE='P0001';
  END IF;

  SELECT role INTO v_cfo_role FROM public.users WHERE id = p_cfo_id;
  IF v_cfo_role IS NULL OR v_cfo_role <> 'cfo'::user_role THEN
    RAISE EXCEPTION 'unauthorized: caller % is not CFO', p_cfo_id USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;
  IF v_current.status <> 'approved'::budget_status THEN
    RAISE EXCEPTION 'only approved budgets can be reverted (got %)', v_current.status
      USING ERRCODE='P0001';
  END IF;

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes,
    pm_reviewed_by, pm_reviewed_at,
    reviewed_by, reviewed_at
  ) VALUES (
    p_budget_id, v_new_version_number, 'returned_to_tl'::budget_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    v_current.submitted_by, v_current.submitted_at, v_current.notes,
    v_current.pm_reviewed_by, v_current.pm_reviewed_at,
    p_cfo_id, now()
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status, pm_approved_amount, pm_adjustment_reason,
      pm_reviewed_by, pm_reviewed_at, pm_notes
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      v_old_item.pm_status, v_old_item.pm_approved_amount, v_old_item.pm_adjustment_reason,
      v_old_item.pm_reviewed_by, v_old_item.pm_reviewed_at, v_old_item.pm_notes
    );
  END LOOP;

  UPDATE public.budgets
     SET current_version = v_new_version_number,
         cfo_return_reason = p_reason,
         pm_approved_total = NULL
   WHERE id = p_budget_id;

  UPDATE public.expenses SET budget_approval_revoked = TRUE WHERE budget_id = p_budget_id;
  GET DIAGNOSTICS v_expense_count = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values, reason)
  VALUES (
    p_cfo_id, 'cfo_budget_reverted_to_tl', 'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status,
                       'pm_approved_total', v_budget.pm_approved_total),
    jsonb_build_object('version_number', v_new_version_number, 'status', 'returned_to_tl',
                       'expenses_flagged', v_expense_count),
    p_reason
  );

  RETURN v_new;
END;
$$;


-- ===========================================================================
-- 2f. fn_budget_withdraw
--     Source statuses: submitted, pm_review (only if pm_review_opened_at IS NULL)
--     Target status:   draft
--     Items: cloned with all pm_* fields reset
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.fn_budget_withdraw(
  p_budget_id UUID,
  p_user_id UUID
) RETURNS public.budget_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget public.budgets;
  v_current public.budget_versions;
  v_new public.budget_versions;
  v_user_role public.user_role;
  v_new_version_number INTEGER;
  v_month_status public.month_status;
  v_assignment_count INTEGER;
  v_old_item public.budget_items;
BEGIN
  SELECT role INTO v_user_role FROM public.users WHERE id = p_user_id;
  IF v_user_role IS NULL OR v_user_role NOT IN
       ('team_leader'::user_role, 'accountant'::user_role, 'cfo'::user_role)
  THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot withdraw budgets', p_user_id
      USING ERRCODE='P0001', HINT='only TL, Accountant, or CFO';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'budget % not found', p_budget_id USING ERRCODE='P0001';
  END IF;

  IF v_user_role = 'team_leader'::user_role THEN
    SELECT COUNT(*) INTO v_assignment_count FROM public.user_project_assignments
     WHERE user_id = p_user_id AND project_id = v_budget.project_id;
    IF v_assignment_count = 0 THEN
      RAISE EXCEPTION 'user % is not assigned to project %', p_user_id, v_budget.project_id
        USING ERRCODE='P0001';
    END IF;
  ELSIF v_user_role = 'accountant'::user_role THEN
    IF v_budget.created_by <> p_user_id OR v_budget.submitted_by_role <> 'accountant' THEN
      RAISE EXCEPTION 'accountant can only withdraw their own accountant-submitted budget'
        USING ERRCODE='P0001';
    END IF;
  END IF;

  SELECT status INTO v_month_status FROM public.month_closures WHERE year_month = v_budget.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_budget.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  SELECT * INTO v_current FROM public.budget_versions
   WHERE budget_id = p_budget_id AND version_number = v_budget.current_version
   FOR UPDATE;

  IF v_current.status NOT IN ('submitted'::budget_status, 'pm_review'::budget_status) THEN
    RAISE EXCEPTION 'cannot withdraw budget in status %', v_current.status
      USING ERRCODE='P0001', HINT='source must be submitted or pm_review';
  END IF;

  IF v_current.status = 'pm_review'::budget_status AND v_budget.pm_review_opened_at IS NOT NULL THEN
    RAISE EXCEPTION 'PM has already opened this budget for review; recall is no longer available'
      USING ERRCODE='P0001';
  END IF;

  v_new_version_number := v_budget.current_version + 1;

  INSERT INTO public.budget_versions (
    budget_id, version_number, status,
    total_amount_usd, total_amount_kes,
    submitted_by, submitted_at, notes
  ) VALUES (
    p_budget_id, v_new_version_number, 'draft'::budget_status,
    v_current.total_amount_usd, v_current.total_amount_kes,
    v_current.submitted_by, v_current.submitted_at, v_current.notes
  ) RETURNING * INTO v_new;

  FOR v_old_item IN SELECT * FROM public.budget_items
                     WHERE budget_version_id = v_current.id
                     ORDER BY sort_order, id LOOP
    INSERT INTO public.budget_items (
      budget_version_id, description, category,
      amount_usd, amount_kes, quantity,
      unit_cost_usd, unit_cost_kes, notes, sort_order,
      pm_status
    ) VALUES (
      v_new.id, v_old_item.description, v_old_item.category,
      v_old_item.amount_usd, v_old_item.amount_kes, v_old_item.quantity,
      v_old_item.unit_cost_usd, v_old_item.unit_cost_kes, v_old_item.notes, v_old_item.sort_order,
      'pending'
    );
  END LOOP;

  UPDATE public.budgets
     SET current_version = v_new_version_number,
         pm_review_opened_at = NULL,
         pm_reviewer_id = NULL
   WHERE id = p_budget_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values, reason)
  VALUES (
    p_user_id, 'budget_withdrawn', 'budget_versions', v_new.id,
    jsonb_build_object('previous_version_id', v_current.id, 'previous_status', v_current.status),
    jsonb_build_object('version_number', v_new_version_number, 'status', 'draft'),
    CASE WHEN v_user_role = 'accountant'::user_role
      THEN 'Accountant withdrew budget back to draft'
      ELSE 'TL withdrew budget back to draft' END
  );

  RETURN v_new;
END;
$$;


-- ---------------------------------------------------------------------------
-- §3. F-30 mitigation — variance_summary_by_project
-- ---------------------------------------------------------------------------
-- The view aggregates approved budgets by (project_id, year_month). Without
-- a current-version filter, once budgets carry multiple historical
-- approved versions (post-F-07), the budget_kes column silently sums every
-- previously-approved version and double-counts.
--
-- Body copied from the live (post-00029) definition byte-for-byte. The
-- ONLY mutation: budget_agg's join condition gains
--   AND bv.version_number = b.current_version
-- so only the canonical current version contributes. Column shape unchanged
-- (CREATE OR REPLACE works without dropping dependents).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.variance_summary_by_project AS
 SELECT pm.project_id,
    p.name AS project_name,
    pm.year_month,
    COALESCE(budget_agg.total_budget_kes, 0::numeric) AS budget_kes,
    COALESCE(exp_agg.total_actual_kes, 0::numeric) AS actual_kes,
    COALESCE(budget_agg.total_budget_kes, 0::numeric) - COALESCE(exp_agg.total_actual_kes, 0::numeric) AS variance_kes
   FROM ( SELECT DISTINCT budgets.project_id,
            budgets.year_month
           FROM budgets
          WHERE budgets.project_id IS NOT NULL
        UNION
         SELECT DISTINCT expenses.project_id,
            expenses.year_month
           FROM expenses
          WHERE expenses.expense_type = 'project_expense'::expense_type AND expenses.lifecycle_status = 'confirmed'::expense_lifecycle_status AND expenses.project_id IS NOT NULL) pm
     LEFT JOIN projects p ON p.id = pm.project_id
     LEFT JOIN ( SELECT b.project_id,
            b.year_month,
            sum(bv.total_amount_kes) AS total_budget_kes
           FROM budgets b
             JOIN budget_versions bv ON bv.budget_id = b.id
                                    AND bv.version_number = b.current_version
                                    AND bv.status = 'approved'::budget_status
          WHERE b.project_id IS NOT NULL
          GROUP BY b.project_id, b.year_month) budget_agg ON budget_agg.project_id = pm.project_id AND budget_agg.year_month = pm.year_month
     LEFT JOIN ( SELECT e.project_id,
            e.year_month,
            sum(e.amount_kes) AS total_actual_kes
           FROM expenses e
          WHERE e.expense_type = 'project_expense'::expense_type AND e.lifecycle_status = 'confirmed'::expense_lifecycle_status AND e.project_id IS NOT NULL
          GROUP BY e.project_id, e.year_month) exp_agg ON exp_agg.project_id = pm.project_id AND exp_agg.year_month = pm.year_month
  WHERE pm.project_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- §4. F-30 mitigation — fn_generate_red_flags
-- ---------------------------------------------------------------------------
-- Block B (overspending check) joined budget_versions on status='approved'
-- without filtering by current_version. Same regression risk as §3.
--
-- Body preserved byte-for-byte from the live (post-00027) definition
-- including all five blocks (A/B/C/D/E). The ONLY mutation: Block B's
-- inner subquery JOIN gains
--   AND bv.version_number = b.current_version
-- (Block A already has this filter — line 93 in 00027.)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_generate_red_flags(p_year_month text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_overdue_days INTEGER;
  v_spike_pct INTEGER;
  v_budget_warn_pct INTEGER;
  v_flag_count INTEGER := 0;
BEGIN
  SELECT value::INTEGER INTO v_overdue_days FROM system_settings WHERE key = 'overdue_invoice_days';
  SELECT value::INTEGER INTO v_spike_pct FROM system_settings WHERE key = 'expense_spike_threshold_percent';
  SELECT value::INTEGER INTO v_budget_warn_pct FROM system_settings WHERE key = 'budget_warning_threshold_percent';

  v_overdue_days := COALESCE(v_overdue_days, 30);
  v_spike_pct := COALESCE(v_spike_pct, 30);
  v_budget_warn_pct := COALESCE(v_budget_warn_pct, 90);

  DELETE FROM red_flags WHERE year_month = p_year_month AND is_resolved = false;

  -- 1. Budgets pending approval
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT 'budget_pending_approval', 'high',
         'Budget pending approval for ' || COALESCE(p.name, d.name, 'Unknown'),
         'Budget version ' || bv.version_number || ' has been pending since ' || bv.submitted_at::date,
         b.project_id, p_year_month, b.id, 'budgets'
  FROM budgets b
  JOIN budget_versions bv ON bv.budget_id = b.id AND bv.version_number = b.current_version
  LEFT JOIN projects p ON p.id = b.project_id
  LEFT JOIN departments d ON d.id = b.department_id
  WHERE b.year_month = p_year_month
    AND bv.status IN ('submitted', 'under_review');

  GET DIAGNOSTICS v_flag_count = ROW_COUNT;

  -- 2. Overspending vs approved budget (F-29 fix; F-30 patch adds version_number filter)
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT
    'overspending',
    CASE WHEN (sub.actual_total / sub.budget_total * 100) > 100 THEN 'critical' ELSE 'high' END::red_flag_severity,
    'Budget overspend: ' || COALESCE(p.name, d.name, 'Unknown'),
    'Spent ' || ROUND(sub.actual_total, 2) || ' USD of ' || ROUND(sub.budget_total, 2) || ' USD budget (' || ROUND(sub.actual_total / NULLIF(sub.budget_total, 0) * 100, 1) || '%)',
    sub.project_id,
    p_year_month,
    NULL,
    NULL
  FROM (
    SELECT
      b.project_id,
      b.department_id,
      SUM(bv.total_amount_usd) AS budget_total,
      COALESCE((
        SELECT SUM(e.amount_usd)
        FROM expenses e
        JOIN budgets b2 ON b2.id = e.budget_id
        WHERE b2.year_month = p_year_month
          AND ((b.project_id IS NOT NULL AND b2.project_id = b.project_id)
            OR (b.department_id IS NOT NULL AND b2.department_id = b.department_id))
          AND e.lifecycle_status = 'confirmed'
      ), 0) AS actual_total
    FROM budgets b
    JOIN budget_versions bv ON bv.budget_id = b.id
                           AND bv.version_number = b.current_version
                           AND bv.status = 'approved'
    WHERE b.year_month = p_year_month
    GROUP BY b.project_id, b.department_id
  ) sub
  LEFT JOIN projects p ON p.id = sub.project_id
  LEFT JOIN departments d ON d.id = sub.department_id
  WHERE sub.budget_total > 0
    AND (sub.actual_total / sub.budget_total * 100) >= v_budget_warn_pct;

  -- 3. Overdue invoices
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month, reference_id, reference_table)
  SELECT 'invoice_overdue', 'high',
         'Overdue invoice: ' || i.invoice_number,
         'Invoice for ' || p.name || ' is ' || (CURRENT_DATE - i.due_date) || ' days overdue',
         i.project_id, p_year_month, i.id, 'invoices'
  FROM invoices i
  JOIN projects p ON p.id = i.project_id
  WHERE i.status NOT IN ('paid', 'cancelled')
    AND i.due_date IS NOT NULL
    AND i.due_date < CURRENT_DATE - v_overdue_days
    AND i.billing_period = p_year_month;

  -- 4. Missing agent counts
  INSERT INTO red_flags (flag_type, severity, title, description, project_id, year_month)
  SELECT 'missing_agent_counts', 'medium',
         'Missing agent count: ' || p.name,
         'No agent count entered for ' || p.name || ' in ' || p_year_month,
         p.id, p_year_month
  FROM projects p
  WHERE p.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM agent_counts ac WHERE ac.project_id = p.id AND ac.year_month = p_year_month
    );

  -- 5. Missing forex entries for withdrawals
  INSERT INTO red_flags (flag_type, severity, title, description, year_month, reference_id, reference_table)
  SELECT 'missing_forex', 'high',
         'Missing forex log for withdrawal',
         'Withdrawal of ' || w.amount_usd || ' USD on ' || w.withdrawal_date || ' has no forex log',
         p_year_month, w.id, 'withdrawals'
  FROM withdrawals w
  WHERE w.year_month = p_year_month
    AND NOT EXISTS (
      SELECT 1 FROM forex_logs fl WHERE fl.withdrawal_id = w.id
    );

  SELECT COUNT(*) INTO v_flag_count FROM red_flags WHERE year_month = p_year_month AND is_resolved = false;

  RETURN v_flag_count;
END;
$function$;
