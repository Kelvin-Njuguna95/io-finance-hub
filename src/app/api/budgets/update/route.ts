import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { BUDGET_EDITABLE_STATUSES } from '@/lib/budgets/status';

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
  // BUDG-4: optional line-item diff. Same version-state guard as the
  // parent-field path (BUDGET_EDITABLE_STATUSES). Server owns the
  // INSERT/UPDATE/DELETE, recomputes budget_versions.total_amount_kes,
  // and writes a single 'budget_items_synced' audit row per call.
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

    // BUDG-4: line-item diff. The state guard at the top of the route
    // (BUDGET_EDITABLE_STATUSES) already gates this — we don't need to
    // re-check here. Apply DELETE → INSERT → UPDATE → recompute total
    // → write a single 'budget_items_synced' audit row capturing the
    // before/after for forensic reconstruction.
    let itemsAuditPayload: {
      added: Array<Record<string, unknown>>;
      edited: Array<{ id: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
      deleted: Array<Record<string, unknown>>;
    } | null = null;

    if (itemsHasDiff) {
      const versionId = activeVersion!.id;

      // Snapshot rows touched by edited/deleted before mutating, so the
      // audit row can carry the prior state. One IN() query for both.
      const touchedIds = Array.from(
        new Set<string>([
          ...itemsEdited.map((e) => e.id),
          ...itemsDeleted.map((d) => d.id),
        ]),
      );
      type ItemRow = {
        id: string;
        description: string | null;
        category: string | null;
        amount_kes: number | string | null;
        sort_order: number | null;
      };
      const beforeById = new Map<string, ItemRow>();
      if (touchedIds.length > 0) {
        const { data: beforeRows } = await admin
          .from('budget_items')
          .select('id, description, category, amount_kes, sort_order')
          .in('id', touchedIds)
          .eq('budget_version_id', versionId);
        for (const r of (beforeRows as ItemRow[] | null) ?? []) {
          beforeById.set(r.id, r);
        }
        // Reject if any id doesn't belong to this active version — caller
        // can't be allowed to edit/delete items on a different budget by
        // claiming the wrong active version.
        const missing = touchedIds.filter((id) => !beforeById.has(id));
        if (missing.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Some line items do not belong to this budget version`,
              code: 'ITEMS_NOT_FOUND',
              missing_ids: missing,
            },
            { status: 400 },
          );
        }
      }

      // DELETE
      const deletedAuditRows: Record<string, unknown>[] = [];
      if (itemsDeleted.length > 0) {
        const ids = itemsDeleted.map((d) => d.id);
        const { error: delErr } = await admin
          .from('budget_items')
          .delete()
          .in('id', ids)
          .eq('budget_version_id', versionId);
        if (delErr) {
          return NextResponse.json(
            { success: false, error: delErr.message, code: 'ITEMS_DELETE_FAILED' },
            { status: 500 },
          );
        }
        for (const id of ids) {
          const before = beforeById.get(id);
          if (before) {
            deletedAuditRows.push({
              id,
              description: before.description,
              category: before.category,
              amount_kes: Number(before.amount_kes ?? 0),
              sort_order: before.sort_order,
            });
          }
        }
      }

      // INSERT (added). Mirrors the existing client convention of
      // amount_kes === unit_cost_kes for KES-only line items.
      const addedAuditRows: Record<string, unknown>[] = [];
      if (itemsAdded.length > 0) {
        const insertRows = itemsAdded.map((a, i) => ({
          budget_version_id: versionId,
          description: a.description,
          category: a.category ?? null,
          amount_kes: a.amount_kes,
          unit_cost_kes: a.amount_kes,
          quantity: 1,
          sort_order: a.sort_order ?? i,
        }));
        const { data: insertedRows, error: insErr } = await admin
          .from('budget_items')
          .insert(insertRows)
          .select('id, description, category, amount_kes, sort_order');
        if (insErr) {
          return NextResponse.json(
            { success: false, error: insErr.message, code: 'ITEMS_INSERT_FAILED' },
            { status: 500 },
          );
        }
        for (const r of (insertedRows as ItemRow[] | null) ?? []) {
          addedAuditRows.push({
            id: r.id,
            description: r.description,
            category: r.category,
            amount_kes: Number(r.amount_kes ?? 0),
            sort_order: r.sort_order,
          });
        }
      }

      // UPDATE (edited). One UPDATE per id; only fields actually
      // present in the patch are sent. amount_kes mirrors to
      // unit_cost_kes to preserve the existing convention.
      const editedAuditRows: Array<{
        id: string;
        before: Record<string, unknown>;
        after: Record<string, unknown>;
      }> = [];
      for (const e of itemsEdited) {
        const before = beforeById.get(e.id);
        if (!before) continue;
        const patch: Record<string, unknown> = {};
        if (e.description !== undefined) patch.description = e.description;
        if (e.category !== undefined) patch.category = e.category;
        if (e.amount_kes !== undefined) {
          patch.amount_kes = e.amount_kes;
          patch.unit_cost_kes = e.amount_kes;
        }
        if (e.sort_order !== undefined) patch.sort_order = e.sort_order;
        if (Object.keys(patch).length === 0) continue;

        const { error: updErr } = await admin
          .from('budget_items')
          .update(patch)
          .eq('id', e.id)
          .eq('budget_version_id', versionId);
        if (updErr) {
          return NextResponse.json(
            { success: false, error: updErr.message, code: 'ITEMS_UPDATE_FAILED' },
            { status: 500 },
          );
        }
        editedAuditRows.push({
          id: e.id,
          before: {
            description: before.description,
            category: before.category,
            amount_kes: Number(before.amount_kes ?? 0),
            sort_order: before.sort_order,
          },
          after: {
            description: e.description ?? before.description,
            category: e.category !== undefined ? e.category : before.category,
            amount_kes:
              e.amount_kes !== undefined
                ? e.amount_kes
                : Number(before.amount_kes ?? 0),
            sort_order:
              e.sort_order !== undefined ? e.sort_order : before.sort_order,
          },
        });
      }

      // Recompute version total off the fresh DB state. Avoids the
      // double-count race the original client code worked around.
      const { data: liveItems } = await admin
        .from('budget_items')
        .select('amount_kes')
        .eq('budget_version_id', versionId);
      const newTotal = ((liveItems as { amount_kes: number | string | null }[] | null) ?? []).reduce(
        (s, r) => s + Number(r.amount_kes ?? 0),
        0,
      );
      const { error: totalErr } = await admin
        .from('budget_versions')
        .update({ total_amount_kes: newTotal })
        .eq('id', versionId);
      if (totalErr) {
        return NextResponse.json(
          { success: false, error: totalErr.message, code: 'ITEMS_TOTAL_UPDATE_FAILED' },
          { status: 500 },
        );
      }

      itemsAuditPayload = {
        added: addedAuditRows,
        edited: editedAuditRows,
        deleted: deletedAuditRows,
      };

      // Single audit row per call describing the diff. Action name
      // 'budget_items_synced' (chosen over '_changed' / '_updated' to
      // emphasise this is a batched diff apply, not a per-row mutation).
      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'budget_items_synced',
        table_name: 'budget_versions',
        record_id: versionId,
        new_values: {
          ...itemsAuditPayload,
          new_total_amount_kes: newTotal,
        },
        reason: null,
      });
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

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update budget.', 'BUDGET_UPDATE_ERROR');
  }
}
