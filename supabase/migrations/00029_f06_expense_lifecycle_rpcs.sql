-- ===========================================================================
-- F-06: Expense lifecycle RPCs (atomic state transitions)
-- ===========================================================================
-- Closes AUDIT_1 finding F-06 (expense lifecycle non-atomic, partial-failure
-- prone) and F-13 (void cascade incomplete). Per AUDIT_3_F06_EXPENSE_LIFECYCLE.md.
--
-- Architecture: Option A from AUDIT_3 §10 — single RPC per transition.
-- Each RPC is one PL/pgSQL function = one transaction. Status guards prevent
-- invalid transitions. Concurrency-safe via SELECT ... FOR UPDATE row locks.
--
-- Verification evidence (2026-04-26):
--   - 0 historical orphans (Q-2, Q-4, Q-5, Q-7, Q-8) — no cleanup needed
--   - 0 closed months — no historical pollution
--   - lifecycle_status is text 'confirmed' on 42/42 rows — clean enum migration
--   - voided_at/voided_by absent on expenses (V-F) — added in this migration
--   - previous_version_id absent (V-G) — added in this migration
--   - RLS on expenses has function-based write policies (V-D) → RPCs use SECURITY DEFINER
--   - RLS on pending_expenses is permissive (V-E)
--   - pending_expenses has zero triggers (V-H) — added audit + updated_at in this migration
--
-- Modify semantics: Design A (status-based history chain). New version inserted
-- at lifecycle_status='confirmed', old version flipped to 'modified', linked
-- via previous_version_id. Existing aggregations (WHERE lifecycle_status =
-- 'confirmed') automatically get latest version only.
--
-- Void semantics: soft-delete preserving audit trail. UPDATE status='voided',
-- set voided_at/voided_by. Cascades to pending_expenses.status='voided'.
--
-- Authorization pattern (R-13 decision, refined for D-1 backwards-compat):
-- Each RPC checks the caller's role via the passed p_*_by user_id rather than
-- auth.uid(). Reason: the existing API route uses createAdminClient() (service
-- role); auth.uid() returns NULL in that context, which would break is_cfo()
-- and is_accountant(). Using the passed user_id keeps the role check working
-- under the existing route AND under any future user-scoped client. Defense-
-- in-depth: the API route already validates the caller before calling the RPC;
-- this is a second layer. D-2 can tighten to auth.uid()-based checks once the
-- route migrates to user-scoped clients.
--
-- Side effects on existing API route (NOT changed in this migration):
-- - Existing INSERTs into expenses default lifecycle_status to 'confirmed' enum value
-- - Existing UPDATEs continue to work (column type changed but PostgREST auto-casts)
-- - F-32 currency triggers continue firing
-- - audit_expenses + set_updated_at_expenses continue firing
-- - During D-1 → D-2 window, both the new audit_pending_expenses trigger and
--   the existing manual audit_logs.insert in the API route fire on every PE
--   change. Result: 2 audit rows per action, one with user_id=NULL (trigger,
--   service-role context). This is double-write (not data loss) and resolves
--   when D-2 removes the manual insert.
--
-- Existing API route (D-1 scope): unchanged. D-2 will rewrite the route to
-- call these RPCs, removing the manual multi-write logic.
--
-- Out of scope for this migration (tracked separately):
--   * F-08 validate_expense_budget trigger re-installation (R-8 deferred)
--   * pending_expenses.status enum promotion (R-12 deferred)
--   * F-32-style cleanup of any drift columns on expenses (source_note,
--     expense_notes, auto_generated, budget_approval_revoked) — drift but
--     not blocking F-06 closure
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. expense_lifecycle_status enum
-- ---------------------------------------------------------------------------
-- 4 values, not 6. PE-only states ('pending_auth', 'carried_forward') are
-- never set on expenses rows; including them would create dead enum values.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_lifecycle_status') THEN
    CREATE TYPE public.expense_lifecycle_status AS ENUM (
      'confirmed',
      'modified',
      'voided',
      'under_review'
    );
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. Promote expenses.lifecycle_status from text to enum
-- ---------------------------------------------------------------------------
-- Pre-migration: text, default 'confirmed'::text, nullable, 42/42 rows = 'confirmed'.
-- Post-migration: expense_lifecycle_status enum, default 'confirmed'::enum, NOT NULL.
-- The USING cast succeeds because every existing value matches an enum literal.

ALTER TABLE public.expenses
  ALTER COLUMN lifecycle_status DROP DEFAULT,
  ALTER COLUMN lifecycle_status TYPE public.expense_lifecycle_status
    USING lifecycle_status::public.expense_lifecycle_status,
  ALTER COLUMN lifecycle_status SET DEFAULT 'confirmed'::public.expense_lifecycle_status,
  ALTER COLUMN lifecycle_status SET NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. New columns on expenses
-- ---------------------------------------------------------------------------
-- voided_at/voided_by: V-F confirmed both absent on expenses (already on
-- pending_expenses cols 19-20).
-- previous_version_id: self-referential FK, nullable, only set by fn_expense_modify.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS voided_by UUID NULL REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS previous_version_id UUID NULL REFERENCES public.expenses(id);


-- ---------------------------------------------------------------------------
-- 4. Partial index on previous_version_id (covers modify-history walks only)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_expenses_previous_version
  ON public.expenses (previous_version_id)
  WHERE previous_version_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 5. UNIQUE constraint on pending_expenses(budget_item_id, year_month)
-- ---------------------------------------------------------------------------
-- Q-8 verified zero duplicates today. Constraint prevents future regression
-- of auto_populate / rollover-cron races (AUDIT_3 §7.1).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_expenses_unique_per_month'
  ) THEN
    ALTER TABLE public.pending_expenses
      ADD CONSTRAINT pending_expenses_unique_per_month
      UNIQUE (budget_item_id, year_month);
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 6. Triggers on pending_expenses (closes the V-H gap)
-- ---------------------------------------------------------------------------
-- audit_pending_expenses was declared in 00004:32-33 but missing in production.
-- set_updated_at_pending_expenses never declared anywhere.
-- Both fn_audit_log and fn_set_updated_at exist (00004:9-23, 63-69).

DROP TRIGGER IF EXISTS set_updated_at_pending_expenses ON public.pending_expenses;
CREATE TRIGGER set_updated_at_pending_expenses
  BEFORE UPDATE ON public.pending_expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

DROP TRIGGER IF EXISTS audit_pending_expenses ON public.pending_expenses;
CREATE TRIGGER audit_pending_expenses
  AFTER INSERT OR UPDATE OR DELETE ON public.pending_expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_log();


-- ---------------------------------------------------------------------------
-- 7. RPCs
-- ---------------------------------------------------------------------------
-- All SECURITY DEFINER (V-D mandates this — expenses RLS would otherwise
-- block accountant/PM callers). Each starts with a role check using the
-- passed p_*_by user_id (rationale in header).
--
-- All use SELECT ... FOR UPDATE for row locks; status guards re-check inside
-- the lock to prevent TOCTOU. Errors raise with ERRCODE='P0001' and
-- structured DETAIL/HINT for the API route to translate.


-- 7a. fn_expense_confirm
--     Source state: pending_expenses.status = 'pending_auth'
--     Effect: INSERT expenses (lifecycle_status='confirmed' default),
--             UPDATE pending_expenses (status='confirmed', expense_id=new).
--             F-32 currency trigger fills amount_usd from amount_kes.
CREATE OR REPLACE FUNCTION public.fn_expense_confirm(
  p_pending_id UUID,
  p_actual_amount_kes NUMERIC,
  p_notes TEXT,
  p_confirmed_by UUID
) RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending public.pending_expenses;
  v_expense public.expenses;
  v_exp_cat_id UUID;
  v_oh_cat_id UUID;
  v_month_status public.month_status;
BEGIN
  -- Authorization (cfo or accountant)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_confirmed_by
       AND role IN ('cfo'::user_role, 'accountant'::user_role)
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot confirm expenses', p_confirmed_by
      USING ERRCODE='P0001', HINT='only cfo or accountant';
  END IF;

  -- Amount validation
  IF p_actual_amount_kes IS NULL OR p_actual_amount_kes <= 0 THEN
    RAISE EXCEPTION 'invalid actual_amount_kes: %', p_actual_amount_kes
      USING ERRCODE='P0001', HINT='must be > 0';
  END IF;

  -- Lock pending row + re-read status
  SELECT * INTO v_pending FROM public.pending_expenses
   WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending_expense % not found', p_pending_id
      USING ERRCODE='P0001';
  END IF;

  -- Status guard
  IF v_pending.status <> 'pending_auth' THEN
    RAISE EXCEPTION 'cannot confirm pending in status %', v_pending.status
      USING ERRCODE='P0001', HINT='source must be pending_auth';
  END IF;

  -- Month-closures guard
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_pending.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_pending.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  -- Resolve category IDs (mirrors current API behavior)
  IF v_pending.category IS NOT NULL THEN
    SELECT id INTO v_exp_cat_id
      FROM public.expense_categories WHERE name = v_pending.category;

    IF v_pending.project_id IS NULL AND v_pending.department_id IS NOT NULL THEN
      SELECT id INTO v_oh_cat_id
        FROM public.overhead_categories WHERE name = v_pending.category;
    END IF;
  END IF;

  -- Insert expense (lifecycle_status default = 'confirmed'; F-32 trigger
  -- populates amount_usd from amount_kes via the standard rate)
  INSERT INTO public.expenses (
    budget_id, budget_version_id, expense_type, project_id,
    overhead_category_id, expense_category_id, description,
    amount_kes, expense_date, year_month,
    notes, entered_by
  ) VALUES (
    v_pending.budget_id, v_pending.budget_version_id,
    CASE WHEN v_pending.project_id IS NOT NULL
      THEN 'project_expense'::expense_type
      ELSE 'shared_expense'::expense_type END,
    v_pending.project_id,
    CASE WHEN v_pending.project_id IS NULL THEN v_oh_cat_id ELSE NULL END,
    v_exp_cat_id, v_pending.description,
    p_actual_amount_kes, CURRENT_DATE, v_pending.year_month,
    COALESCE(p_notes, 'Confirmed from pending expense ' || p_pending_id::text),
    p_confirmed_by
  ) RETURNING * INTO v_expense;

  -- Update pending_expenses
  UPDATE public.pending_expenses SET
    status = 'confirmed',
    actual_amount_kes = p_actual_amount_kes,
    confirmed_by = p_confirmed_by,
    confirmed_at = now(),
    expense_id = v_expense.id
   WHERE id = p_pending_id;

  RETURN v_expense;
END;
$$;


-- 7b. fn_expense_modify
--     Source state: expenses.lifecycle_status = 'confirmed'
--     Effect: INSERT new expenses row (lifecycle_status='confirmed',
--             previous_version_id = old.id), UPDATE old row to 'modified',
--             re-point any pending_expenses pointing at the old expense.
CREATE OR REPLACE FUNCTION public.fn_expense_modify(
  p_expense_id UUID,
  p_new_amount_kes NUMERIC,
  p_modified_reason TEXT,
  p_modified_by UUID
) RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old public.expenses;
  v_new public.expenses;
  v_month_status public.month_status;
BEGIN
  -- Authorization (cfo or accountant)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_modified_by
       AND role IN ('cfo'::user_role, 'accountant'::user_role)
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot modify expenses', p_modified_by
      USING ERRCODE='P0001', HINT='only cfo or accountant';
  END IF;

  -- Amount validation
  IF p_new_amount_kes IS NULL OR p_new_amount_kes <= 0 THEN
    RAISE EXCEPTION 'invalid new_amount_kes: %', p_new_amount_kes
      USING ERRCODE='P0001', HINT='must be > 0';
  END IF;

  -- Reason required (audit trail)
  IF p_modified_reason IS NULL OR length(trim(p_modified_reason)) = 0 THEN
    RAISE EXCEPTION 'modified_reason is required'
      USING ERRCODE='P0001';
  END IF;

  -- Lock old expense row
  SELECT * INTO v_old FROM public.expenses
   WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense % not found', p_expense_id
      USING ERRCODE='P0001';
  END IF;

  -- Status guard: only confirmed expenses can be modified
  IF v_old.lifecycle_status <> 'confirmed'::public.expense_lifecycle_status THEN
    RAISE EXCEPTION 'cannot modify expense in status %', v_old.lifecycle_status
      USING ERRCODE='P0001', HINT='source must be confirmed';
  END IF;

  -- Month-closures guard
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_old.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_old.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  -- Insert new version row (F-32 trigger fills amount_usd)
  INSERT INTO public.expenses (
    budget_id, budget_version_id, expense_type, project_id,
    overhead_category_id, expense_category_id, description,
    amount_kes, expense_date, year_month,
    notes, entered_by, previous_version_id
    -- lifecycle_status defaults to 'confirmed'
  ) VALUES (
    v_old.budget_id, v_old.budget_version_id, v_old.expense_type, v_old.project_id,
    v_old.overhead_category_id, v_old.expense_category_id, v_old.description,
    p_new_amount_kes, v_old.expense_date, v_old.year_month,
    'Modified from expense ' || v_old.id::text || '. Reason: ' || p_modified_reason,
    p_modified_by, v_old.id
  ) RETURNING * INTO v_new;

  -- Flip old row to 'modified' (excluded from aggregates filtering on 'confirmed')
  UPDATE public.expenses
     SET lifecycle_status = 'modified'::public.expense_lifecycle_status
   WHERE id = v_old.id;

  -- Re-point any pending_expenses pointing at the old expense to the new one
  UPDATE public.pending_expenses
     SET expense_id = v_new.id
   WHERE expense_id = v_old.id;

  RETURN v_new;
END;
$$;


-- 7c. fn_expense_under_review
--     Source state: expenses.lifecycle_status IN ('confirmed', 'modified')
--     Effect: UPDATE expenses.lifecycle_status='under_review'.
--             Excluded from 'WHERE lifecycle_status = confirmed' aggregates.
CREATE OR REPLACE FUNCTION public.fn_expense_under_review(
  p_expense_id UUID,
  p_review_reason TEXT,
  p_marked_by UUID
) RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expense public.expenses;
  v_month_status public.month_status;
BEGIN
  -- Authorization (cfo or accountant)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_marked_by
       AND role IN ('cfo'::user_role, 'accountant'::user_role)
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot flag expenses for review', p_marked_by
      USING ERRCODE='P0001', HINT='only cfo or accountant';
  END IF;

  IF p_review_reason IS NULL OR length(trim(p_review_reason)) = 0 THEN
    RAISE EXCEPTION 'review_reason is required'
      USING ERRCODE='P0001';
  END IF;

  -- Lock expense row
  SELECT * INTO v_expense FROM public.expenses
   WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense % not found', p_expense_id
      USING ERRCODE='P0001';
  END IF;

  -- Status guard
  IF v_expense.lifecycle_status NOT IN (
       'confirmed'::public.expense_lifecycle_status,
       'modified'::public.expense_lifecycle_status
     ) THEN
    RAISE EXCEPTION 'cannot flag expense in status % for review', v_expense.lifecycle_status
      USING ERRCODE='P0001', HINT='source must be confirmed or modified';
  END IF;

  -- Month-closures guard
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_expense.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_expense.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  -- Flip to under_review and append review-trace to notes
  UPDATE public.expenses
     SET lifecycle_status = 'under_review'::public.expense_lifecycle_status,
         notes = COALESCE(notes, '') || E'\n[REVIEW ' || now()::text
                 || ' by ' || p_marked_by::text || ']: ' || p_review_reason
   WHERE id = p_expense_id
   RETURNING * INTO v_expense;

  RETURN v_expense;
END;
$$;


-- 7d. fn_expense_void
--     Source state: expenses.lifecycle_status IN ('confirmed', 'modified', 'under_review')
--     Effect: UPDATE expenses.lifecycle_status='voided', voided_at, voided_by.
--             CASCADE: any linked pending_expenses → status='voided' (closes F-13).
CREATE OR REPLACE FUNCTION public.fn_expense_void(
  p_expense_id UUID,
  p_void_reason TEXT,
  p_voided_by UUID
) RETURNS public.expenses
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expense public.expenses;
  v_month_status public.month_status;
BEGIN
  -- Authorization (CFO ONLY for void — matches current API route guard)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_voided_by
       AND role = 'cfo'::user_role
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot void expenses', p_voided_by
      USING ERRCODE='P0001', HINT='only cfo can void';
  END IF;

  IF p_void_reason IS NULL OR length(trim(p_void_reason)) = 0 THEN
    RAISE EXCEPTION 'void_reason is required'
      USING ERRCODE='P0001';
  END IF;

  -- Lock expense row
  SELECT * INTO v_expense FROM public.expenses
   WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'expense % not found', p_expense_id
      USING ERRCODE='P0001';
  END IF;

  -- Status guard
  IF v_expense.lifecycle_status NOT IN (
       'confirmed'::public.expense_lifecycle_status,
       'modified'::public.expense_lifecycle_status,
       'under_review'::public.expense_lifecycle_status
     ) THEN
    RAISE EXCEPTION 'cannot void expense in status %', v_expense.lifecycle_status
      USING ERRCODE='P0001', HINT='source must be confirmed, modified, or under_review';
  END IF;

  -- Month-closures guard
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_expense.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'month % is %', v_expense.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the month first';
  END IF;

  -- Soft-void the expense
  UPDATE public.expenses
     SET lifecycle_status = 'voided'::public.expense_lifecycle_status,
         voided_at = now(),
         voided_by = p_voided_by,
         notes = COALESCE(notes, '') || E'\n[VOID ' || now()::text
                 || ' by ' || p_voided_by::text || ']: ' || p_void_reason
   WHERE id = p_expense_id
   RETURNING * INTO v_expense;

  -- Cascade to pending_expenses (closes F-13)
  UPDATE public.pending_expenses
     SET status = 'voided',
         void_reason = p_void_reason,
         voided_by = p_voided_by,
         voided_at = now()
   WHERE expense_id = p_expense_id;

  RETURN v_expense;
END;
$$;


-- 7e. fn_expense_carry_forward
--     Source state: pending_expenses.status = 'pending_auth'
--     Effect: UPDATE source PE → status='carried_forward';
--             INSERT target-month PE → status='pending_auth', carry_from_month.
--             Both source AND target months must be open (closes AUDIT_3 §4.8 finding).
CREATE OR REPLACE FUNCTION public.fn_expense_carry_forward(
  p_pending_id UUID,
  p_carrying_user UUID,
  p_carry_reason TEXT
) RETURNS public.pending_expenses
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_src public.pending_expenses;
  v_target_month TEXT;
  v_new public.pending_expenses;
  v_month_status public.month_status;
BEGIN
  -- Authorization (cfo or accountant)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_carrying_user
       AND role IN ('cfo'::user_role, 'accountant'::user_role)
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot carry forward expenses', p_carrying_user
      USING ERRCODE='P0001', HINT='only cfo or accountant';
  END IF;

  IF p_carry_reason IS NULL OR length(trim(p_carry_reason)) = 0 THEN
    RAISE EXCEPTION 'carry_reason is required'
      USING ERRCODE='P0001';
  END IF;

  -- Lock source row
  SELECT * INTO v_src FROM public.pending_expenses
   WHERE id = p_pending_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending_expense % not found', p_pending_id
      USING ERRCODE='P0001';
  END IF;

  -- Status guard
  IF v_src.status <> 'pending_auth' THEN
    RAISE EXCEPTION 'cannot carry forward pending in status %', v_src.status
      USING ERRCODE='P0001', HINT='source must be pending_auth';
  END IF;

  -- Compute target month (source month + 1)
  v_target_month := to_char(
    (to_date(v_src.year_month, 'YYYY-MM') + INTERVAL '1 month')::DATE,
    'YYYY-MM'
  );

  -- Source month must be open
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_src.year_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'source month % is %', v_src.year_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the source month first';
  END IF;

  -- Target month must also be open (AUDIT_3 §4.8 closure)
  v_month_status := NULL;
  SELECT status INTO v_month_status FROM public.month_closures
   WHERE year_month = v_target_month;
  IF v_month_status IN ('closed'::month_status, 'locked'::month_status) THEN
    RAISE EXCEPTION 'target month % is %', v_target_month, v_month_status
      USING ERRCODE='P0001', HINT='reopen the target month first';
  END IF;

  -- Mark source as carried_forward
  UPDATE public.pending_expenses SET
    status = 'carried_forward',
    carry_reason = p_carry_reason
   WHERE id = p_pending_id;

  -- Insert target-month row (atomic with source flip; UNIQUE constraint
  -- protects against cron-vs-manual double-insert race)
  INSERT INTO public.pending_expenses (
    budget_id, budget_version_id, budget_item_id, project_id, department_id,
    year_month, description, category, budgeted_amount_kes, status, carry_from_month
  ) VALUES (
    v_src.budget_id, v_src.budget_version_id, v_src.budget_item_id,
    v_src.project_id, v_src.department_id, v_target_month,
    v_src.description, v_src.category, v_src.budgeted_amount_kes,
    'pending_auth', v_src.year_month
  ) RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;


-- 7f. fn_expense_bulk_confirm
--     Best-effort: each item runs in its own savepoint via BEGIN/EXCEPTION.
--     Returns a JSON envelope { confirmed: [...], errors: [...] } so the
--     caller can render per-item outcomes without transaction-aborting the
--     whole batch on a single failure.
--
--     Each item delegates to fn_expense_confirm to keep transition logic
--     centralized — atomicity is per-item, not per-batch.
CREATE OR REPLACE FUNCTION public.fn_expense_bulk_confirm(
  p_items JSONB,
  p_confirmed_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item JSONB;
  v_results JSONB := '[]'::jsonb;
  v_errors  JSONB := '[]'::jsonb;
  v_expense public.expenses;
  v_pending_id UUID;
BEGIN
  -- Authorization (cfo or accountant)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = p_confirmed_by
       AND role IN ('cfo'::user_role, 'accountant'::user_role)
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller % cannot confirm expenses', p_confirmed_by
      USING ERRCODE='P0001', HINT='only cfo or accountant';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array'
      USING ERRCODE='P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pending_id := (v_item->>'pending_id')::UUID;

    BEGIN
      v_expense := public.fn_expense_confirm(
        v_pending_id,
        (v_item->>'actual_amount_kes')::NUMERIC,
        v_item->>'notes',
        p_confirmed_by
      );

      v_results := v_results || jsonb_build_object(
        'pending_id', v_pending_id,
        'expense_id', v_expense.id
      );
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'pending_id', v_pending_id,
        'error', SQLERRM,
        'sqlstate', SQLSTATE
      );
    END;
  END LOOP;

  RETURN jsonb_build_object('confirmed', v_results, 'errors', v_errors);
END;
$$;
