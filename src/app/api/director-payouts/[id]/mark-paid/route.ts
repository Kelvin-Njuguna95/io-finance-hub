import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    }

    const { profile, user, admin } = auth;
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can mark payouts as paid.' }, { status: 403 });
    }

    const { id } = await params;

    const { error } = await admin
      .from('director_payouts')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        paid_by: user.id,
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to mark payout paid.', 'DIRECTOR_PAYOUT_MARK_PAID_ERROR');
  }
}
