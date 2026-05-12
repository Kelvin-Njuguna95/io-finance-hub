import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type LinkPayload = { withdrawal_id: string };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    }

    const { profile, user, admin } = auth;
    if (!['cfo', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = (await request.json()) as LinkPayload;

    if (!body.withdrawal_id) {
      return NextResponse.json({ error: 'withdrawal_id is required.' }, { status: 422 });
    }

    // Snapshot prior state for the audit_logs row. director_payouts has no
    // fn_audit_log trigger (00018), so this read + route-level insert is
    // the canonical attribution path.
    const { data: prior, error: priorErr } = await admin
      .from('director_payouts')
      .select('status, withdrawal_id, paid_at, paid_by')
      .eq('id', id)
      .single();

    if (priorErr) throw priorErr;
    if (!prior) {
      return NextResponse.json({ error: 'Payout not found.' }, { status: 404 });
    }

    const paidAt = new Date().toISOString();

    const { error } = await admin
      .from('director_payouts')
      .update({
        withdrawal_id: body.withdrawal_id,
        status: 'paid',
        paid_at: paidAt,
        paid_by: user.id,
      })
      .eq('id', id);

    if (error) throw error;

    try {
      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'UPDATE',
        table_name: 'director_payouts',
        record_id: id,
        old_values: {
          status: prior.status,
          withdrawal_id: prior.withdrawal_id,
          paid_at: prior.paid_at,
          paid_by: prior.paid_by,
        },
        new_values: {
          status: 'paid',
          withdrawal_id: body.withdrawal_id,
          paid_at: paidAt,
          paid_by: user.id,
        },
      });
    } catch (auditError) {
      console.error('[director-payouts link-withdrawal] audit_logs insert failed', auditError, {
        userId: user.id,
        recordId: id,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to link withdrawal.', 'DIRECTOR_PAYOUT_LINK_WITHDRAWAL_ERROR');
  }
}
