import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type CreateDirectorPayoutPayload = {
  director_name: string;
  profit_share_record_id: string;
  period_month: string;
  amount_kes: number;
  payment_method?: 'cash' | 'withdrawal';
  notes?: string;
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    }

    const { user, profile, admin } = auth;
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can initiate director payouts.' }, { status: 403 });
    }

    const body = (await request.json()) as CreateDirectorPayoutPayload;

    if (!body.director_name || !body.profit_share_record_id || !body.period_month || Number(body.amount_kes) <= 0) {
      return NextResponse.json({ error: 'director_name, profit_share_record_id, period_month and amount_kes are required.' }, { status: 422 });
    }

    const expectedTag = body.director_name.toLowerCase();
    const { data: psRecord } = await admin
      .from('profit_share_records')
      .select('id, director_tag, balance_remaining, distributable_amount')
      .eq('id', body.profit_share_record_id)
      .single();

    if (!psRecord) {
      return NextResponse.json({ error: 'Profit share record not found.' }, { status: 404 });
    }

    if (psRecord.director_tag !== expectedTag) {
      return NextResponse.json({ error: 'Selected director does not match this profit share record.' }, { status: 422 });
    }

    const remaining = Number(psRecord.balance_remaining ?? psRecord.distributable_amount ?? 0);
    if (Number(body.amount_kes) > remaining) {
      return NextResponse.json({ error: `Payout amount exceeds remaining balance (${remaining}).` }, { status: 422 });
    }

    const { data, error } = await admin
      .from('director_payouts')
      .insert({
        director_name: body.director_name,
        profit_share_record_id: body.profit_share_record_id,
        period_month: `${body.period_month}-01`,
        amount_kes: body.amount_kes,
        payment_method: body.payment_method ?? 'cash',
        notes: body.notes ?? null,
        initiated_by: user.id,
      })
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to create director payout.', 'DIRECTOR_PAYOUT_CREATE_ERROR');
  }
}
