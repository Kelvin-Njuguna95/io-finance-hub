import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { BUDGET_EDITABLE_STATUSES } from '@/lib/budgets/status';
import { isValidUuid } from '@/lib/idempotency';

type ItemAdd = {
  description: string;
  amount_kes: number;
  category?: string | null;
  sort_order?: number;
};

type ItemEdit = {
  id: string;
  description?: string;
  amount_kes?: number;
  category?: string | null;
  sort_order?: number;
};

type ItemDelete = { id: string };

type EditablePayload = {
  budget_id?: string;
  notes?: string | null;
  year_month?: string;
  project_id?: string | null;
  department_id?: string | null;
  force?: boolean;
  // A1 (AUDIT1-ITEM2 Phase 3b): reserved for future client-side
  // idempotency-key generation. Until a UI sends it, the route generates
  // one per save via crypto.randomUUID(). When provided, validated as
  // UUID per A7 of the Phase 3b scope lock.
  idempotency_key?: string;
  // BUDG-4: optional line-item diff. Same version-state guard as the
  // parent-field path (BUDGET_EDITABLE_STATUSES). After Phase 3b the
  // server-side INSERT/UPDATE/DELETE/recompute/audit chain is owned by
  // the fn_budget_items_sync transactional RPC (migration 00060).
  items?: {
    added?: ItemAdd[];
    edited?: ItemEdit[];
    deleted?: ItemDelete[];
  };
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { success: false, error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    const roleErr = assertRole(profile, [
      'cfo',
      'accountant',
      'team_leader',
      'project_manager',
    ]);
    if (roleErr) {
      return NextResponse.json(
        { success: false, error: 'Not authorized to edit budgets' },
        { status: roleErr.status },
      );
    }

    const body = (await request.json()) as EditablePayload;
    const {
      budget_id,
      notes,
      year_month,
      project_id,
      department_id,
      force,
      items,
    } = body;
    const itemsAdded: ItemAdd[] = items?.added ?? [];
    const itemsEdited: ItemEdit[] = items?.edited ?? [];
    const itemsDeleted: ItemDelete[] = items?.deleted ?? [];
    const itemsHasDiff =
      itemsAdded.length > 0 ||
      itemsEdited.length > 0 ||
      itemsDeleted.length > 0;

    if (!budget_id) {
      return NextResponse.json(
        { success: false, error: 'budget_id required' },
        { status: 400 },
      );
    }

    const { data: budget, error: bErr } = await admin
      .from('budgets')
      .select('id, project_id, department_id, year_month, notes, current_version, created_by, submitted_by_role')
      .eq('id', budget_id)
      .single();
    if (bErr || !budget) {
      return NextResponse.json(
        { success: false, error: 'Budget not found' },
        { status: 404 },
      );
    }

    const { data: activeVersion } = await admin
      .from('budget_versions')
      .select('id, status, version_number')
      .eq('budget_id', budget_id)
      .eq('version_number', budget.current_version)
      .maybeSingle();

    if (
      !activeVersion ||
      !(BUDGET_EDITABLE_STATUSES as readonly string[]).includes(activeVersion.status)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Budget is not in an editable state',
          code: 'NOT_EDITABLE',
          status: activeVersion?.status ?? null,
        },
        { status: 409 },
      );
    }

    // Resolve effective values (override ?? current).
    const newYearMonth: string =
      typeof year_month === 'string' ? year_month : budget.year_month;
    const newNotes: string | null =
      notes !== undefined ? notes : budget.notes ?? null;
    const scopeChanging = project_id !== undefined || department_id !== undefined;
    const newProjectId: string | null =
      project_id !== undefined ? project_id : budget.project_id;
    const newDepartmentId: string | null =
      department_id !== undefined ? department_id : budget.department_id;

    if (
      newYearMonth !== budget.year_month &&
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(newYearMonth)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'year_month must match YYYY-MM',
          code: 'INVALID_YEAR_MONTH',
        },
        { status: 400 },
      );
    }

    // budget_scope_check (00002_tables.sql:125–128) requires exactly one
    // of project_id / department_id. When scope is changing, enforce
    // upfront so the UPDATE doesn't fail with a CHECK violation.
    const hasProject = newProjectId !== null && newProjectId !== undefined;
    const hasDept = newDepartmentId !== null && newDepartmentId !== undefined;
    if (scopeChanging && hasProject === hasDept) {
      return NextResponse.json(
        {
          success: false,
          error: 'Exactly one of project_id or department_id must be set',
          code: 'INVALID_SCOPE',
        },
        { status: 400 },
      );
    }

    // Block edits when either the source or target year_month is in a
    // closed / locked month — same guard the budget RPCs already apply
    // for transitions (00042 fn_budget_resubmit:187 etc.).
    const monthsToCheck =
      newYearMonth === budget.year_month
        ? [budget.year_month]
        : [budget.year_month, newYearMonth];
    const { data: closures } = await admin
      .from('month_closures')
      .select('year_month, status')
      .in('year_month', monthsToCheck);
    const blockedClosure = (closures ?? []).find(
      (c: { status: string }) => c.status === 'closed' || c.status === 'locked',
    );
    if (blockedClosure) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot edit budget — month ${blockedClosure.year_month} is ${blockedClosure.status}`,
          code: 'MONTH_BLOCKED',
          year_month: blockedClosure.year_month,
          closure_status: blockedClosure.status,
        },
        { status: 409 },
      );
    }

    // Sibling-collision check (only when scope or month is moving).
    const scopeOrMonthChanging =
      scopeChanging || newYearMonth !== budget.year_month;
    if (scopeOrMonthChanging) {
      let siblingQuery = admin
        .from('budgets')
        .select('id, current_version, project_id, department_id, year_month')
        .neq('id', budget_id)
        .eq('year_month', newYearMonth);
      if (newProjectId) {
        siblingQuery = siblingQuery.eq('project_id', newProjectId);
      } else if (newDepartmentId) {
        siblingQuery = siblingQuery.eq('department_id', newDepartmentId);
      }
      const { data: siblings } = await siblingQuery;

      const activeSiblingIds: string[] = [];
      for (const s of siblings ?? []) {
        const { data: sv } = await admin
          .from('budget_versions')
          .select('status')
          .eq('budget_id', s.id)
          .eq('version_number', s.current_version)
          .maybeSingle();
        if (sv && !['rejected', 'pm_rejected'].includes(sv.status)) {
          activeSiblingIds.push(s.id);
        }
      }

      if (activeSiblingIds.length > 0 && !force) {
        return NextResponse.json(
          {
            success: true,
            warnings: ['sibling_exists'],
            sibling_count: activeSiblingIds.length,
            sibling_ids: activeSiblingIds,
            message: `${activeSiblingIds.length} other active budget(s) exist for this scope+month. Confirm to proceed.`,
          },
          { status: 200 },
        );
      }
    }

    // Role-vs-new-scope authorization. CFO and accountant pass through.
    if (profile.role === 'team_leader' && newProjectId) {
      const { data: assignment } = await admin
        .from('user_project_assignments')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('project_id', newProjectId)
        .maybeSingle();
      if (!assignment) {
        return NextResponse.json(
          {
            success: false,
            error: 'Team leader does not have access to the new project',
            code: 'NO_PROJECT_ACCESS',
          },
          { status: 403 },
        );
      }
    }
    if (profile.role === 'project_manager' && newDepartmentId) {
      const { data: deptAccess } = await admin
        .from('user_department_assignments')
        .select('user_id')
        .eq('user_id', user.id)
        .eq('department_id', newDepartmentId)
        .maybeSingle();
      if (!deptAccess) {
        return NextResponse.json(
          {
            success: false,
            error: 'Project manager does not have access to the new department',
            code: 'NO_DEPT_ACCESS',
          },
          { status: 403 },
        );
      }
    }

    // Build the diffed UPDATE payload (only changed fields).
    const oldValues = {
      notes: budget.notes,
      year_month: budget.year_month,
      project_id: budget.project_id,
      department_id: budget.department_id,
    };
    const updatePayload: Record<string, unknown> = {};
    if (notes !== undefined && notes !== budget.notes) {
      updatePayload.notes = newNotes;
    }
    if (newYearMonth !== budget.year_month) {
      updatePayload.year_month = newYearMonth;
    }
    if (scopeChanging) {
      updatePayload.project_id = newProjectId;
      updatePayload.department_id = newDepartmentId;
    }

    const hasParentDiff = Object.keys(updatePayload).length > 0;
    if (!hasParentDiff && !itemsHasDiff) {
      return NextResponse.json({
        success: true,
        data: budget,
        message: 'No changes',
      });
    }

    // BUDG-4 / AUDIT1-ITEM2 Phase 3b: line-item diff. The five-call
    // PostgREST chain that previously lived here (snapshot SELECT, DELETE,
    // bulk INSERT, N×UPDATE, parent-total recompute, audit-write) is
    // replaced by a single transactional RPC. The RPC owns the audit row;
    // do NOT write one here too.
    //
    // Reference:
    //   - fn_budget_items_sync body: supabase/migrations/00060_audit1_item2_budget_items_transactional_rpc.sql
    //   - Design rationale + scope lock: AUDIT1-ITEM2-PHASE3B-DIAGNOSIS.md
    //     ("Answers from Njuguna (Phase 1.5 — scope lock)" A1–A7).
    type ItemsSyncResult = {
      ok: true;
      idempotent_hit: boolean;
      version_total_kes: number;
      audit_log_id: string | null;
    };
    let itemsSyncResult: ItemsSyncResult | null = null;

    if (itemsHasDiff) {
      // A7: validate body.idempotency_key when present; mirror the
      // withdrawals precedent at src/app/api/withdrawals/create/route.ts:51-56.
      // On absence, generate locally per A1 (client-side keys deferred).
      let idempotencyKey: string;
      if (body.idempotency_key !== undefined) {
        if (!isValidUuid(body.idempotency_key)) {
          return NextResponse.json(
            {
              success: false,
              error: `Invalid idempotency_key: must be a UUID. Received: ${String(body.idempotency_key)}`,
              code: 'INVALID_IDEMPOTENCY_KEY',
            },
            { status: 400 },
          );
        }
        idempotencyKey = body.idempotency_key;
      } else {
        idempotencyKey = crypto.randomUUID();
      }

      // Single transactional RPC. The admin client is untyped — see
      // src/lib/supabase/admin.ts and the same pattern in
      // src/app/api/budgets/resubmit/route.ts.
      const { data: rpcData, error: rpcErr } = await admin.rpc(
        'fn_budget_items_sync',
        {
          p_version_id: activeVersion!.id,
          p_user_id: user.id,
          p_added: itemsAdded,                       // JSONB — supabase-js serialises the JS array.
          p_edited: itemsEdited,                     // JSONB — same.
          p_deleted: itemsDeleted.map((d) => d.id),  // UUID[] — flatten Array<{id}> to string[].
          p_idempotency_key: idempotencyKey,
        },
      );

      if (rpcErr) {
        // A3: ITEMS_NOT_FOUND survives as a distinct 400 because the RPC
        // raises with HINT='ITEMS_NOT_FOUND' (migration 00060:146).
        // Everything else collapses to ITEMS_SYNC_FAILED because the RPC
        // transaction means there is no "deleted but insert failed"
        // partial-failure outcome — the five mid-chain *_FAILED codes
        // are structurally impossible.
        if (rpcErr.hint === 'ITEMS_NOT_FOUND') {
          return NextResponse.json(
            {
              success: false,
              error: 'One or more line items do not belong to this budget version.',
              code: 'ITEMS_NOT_FOUND',
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          {
            success: false,
            error: rpcErr.message,
            code: 'ITEMS_SYNC_FAILED',
          },
          { status: 500 },
        );
      }

      // A4: nested items_sync field carries the RPC return shape verbatim.
      // The cast is safe because the success arm of fn_budget_items_sync
      // always returns the four-field JSONB documented in
      // AUDIT1-ITEM2-DESIGN.md §1.
      itemsSyncResult = rpcData as ItemsSyncResult;

      // Q5 (soft amendment to A2): server-side observability for
      // idempotent hits. Vercel captures console output; this gives us
      // a grep path if hits start firing unexpectedly. No helper, no
      // audit-row, no telemetry pipeline.
      if (itemsSyncResult.idempotent_hit) {
        console.log('[budget-items-sync] idempotent_hit', {
          version_id: activeVersion!.id,
          idempotency_key: idempotencyKey,
        });
      }
    }

    let updated: typeof budget = budget;
    if (hasParentDiff) {
      const { data: updatedRow, error: upErr } = await admin
        .from('budgets')
        .update(updatePayload)
        .eq('id', budget_id)
        .select()
        .single();
      if (upErr) {
        return NextResponse.json(
          { success: false, error: upErr.message, code: 'UPDATE_FAILED' },
          { status: 500 },
        );
      }
      updated = updatedRow;

      // Manual audit row with full attribution. The audit_budgets trigger
      // (00004:26) will also fire on the UPDATE — accepted two-row pattern
      // (the manual row carries user_id; the trigger row carries NULL).
      const newValues = {
        notes: newNotes,
        year_month: newYearMonth,
        project_id: newProjectId,
        department_id: newDepartmentId,
      };
      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'budget_edited',
        table_name: 'budgets',
        record_id: budget_id,
        old_values: oldValues,
        new_values: newValues,
        reason: null,
      });
    }

    // A4: items_sync is only present when itemsHasDiff was true. The
    // top-level `data` field still carries the parent budget row, so the
    // four UI call sites that read `json.data` keep working unchanged.
    return NextResponse.json({
      success: true,
      data: updated,
      ...(itemsSyncResult ? { items_sync: itemsSyncResult } : {}),
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update budget.', 'BUDGET_UPDATE_ERROR');
  }
}
