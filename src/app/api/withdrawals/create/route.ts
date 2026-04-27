import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type WithdrawPayload = {
  withdrawal_type: 'operations' | 'director_payout';
  withdrawal_date?: string;
  director_tag?: string;
  director_user_id?: string;
  director_name?: string;
  profit_share_record_id?: string;
  payout_type?: 'full' | 'partial';
  amount_usd: number;
  exchange_rate: number;
  amount_kes: number;
  forex_bureau?: string | null;
  reference_id?: string | null;
  reference_rate?: number | null;
  variance_kes?: number | null;
  year_month?: string;
  notes?: string | null;
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    if (!['cfo', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'Only CFO and Accountant can record withdrawals.' }, { status: 403 });
    }

    const body = (await request.json()) as WithdrawPayload;
    const withdrawalType = body.withdrawal_type ?? 'operations';
    const withdrawalDate = body.withdrawal_date || new Date().toISOString().split('T')[0];

    const { data: withdrawal, error: rpcErr } = await admin.rpc('fn_withdrawal_record', {
      p_withdrawal_type: withdrawalType,
      p_recorded_by: user.id,
      p_withdrawal_date: withdrawalDate,
      p_year_month: body.year_month || withdrawalDate.slice(0, 7),
      p_amount_usd: body.amount_usd,
      p_amount_kes: body.amount_kes,
      p_exchange_rate: body.exchange_rate,
      p_forex_bureau: body.forex_bureau ?? null,
      p_reference_id: body.reference_id ?? null,
      p_reference_rate: body.reference_rate ?? null,
      p_variance_kes: body.variance_kes ?? null,
      p_notes: body.notes ?? null,
      p_director_tag: body.director_tag ?? null,
      p_director_user_id: body.director_user_id ?? null,
      p_profit_share_record_id: body.profit_share_record_id ?? null,
      p_director_name: body.director_name ?? null,
      p_payout_type: body.payout_type ?? null,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message, code: 'WITHDRAWAL_CREATE_FAILED' },
        { status: 422 },
      );
    }

    return NextResponse.json({ data: withdrawal });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to record withdrawal.', 'WITHDRAWAL_CREATE_ERROR');
  }
}
