import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import { isValidUuid } from '@/lib/idempotency';

// PRED-8 part 2. CFO-only soft delete for a
// predated_company_share_distributions row. Wraps
// fn_soft_delete_predated_company_share (migration 00058).

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    const roleErr = assertRole(profile, ['cfo']);
    if (roleErr) {
      return NextResponse.json(
        {
          error: 'Only CFO can delete predated company-share distributions.',
          code: 'FORBIDDEN',
        },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json(
        { error: 'id must be a valid UUID.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { data, error } = await admin.rpc(
      'fn_soft_delete_predated_company_share',
      {
        p_caller_id: user.id,
        p_record_id: id,
      },
    );

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('Only CFO')) {
        return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
      }
      if (msg.includes('not found')) {
        return NextResponse.json({ error: msg, code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ success: true, distribution: data });
  } catch (error) {
    return apiErrorResponse(
      error,
      'Failed to delete predated company-share distribution.',
      'PREDATED_COMPANY_SHARE_DELETE_ERROR',
    );
  }
}
