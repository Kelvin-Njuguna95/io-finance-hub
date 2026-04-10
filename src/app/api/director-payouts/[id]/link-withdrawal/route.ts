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

    const { error } = await admin
      .from('director_payouts')
      .update({
        withdrawal_id: body.withdrawal_id,
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: user.id,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to link withdrawal.', 'DIRECTOR_PAYOUT_LINK_WITHDRAWAL_ERROR');
  }
}
