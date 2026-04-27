import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const DIRECTOR_NAMES = ['Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'] as const;
const DIRECTOR_TAG_MAP: Record<(typeof DIRECTOR_NAMES)[number], string> = {
  Kelvin: 'kelvin',
  Evans: 'evans',
  Dan: 'dan',
  Gidraph: 'gidraph',
  Victor: 'victor',
};

type WithdrawUpdatePayload = {
  id?: string;
  withdrawal_type?: 'operations' | 'director_payout';
  purpose?: 'company_operations' | 'director_payout';
  withdrawal_date?: string;
  director_tag?: string | null;
  director_user_id?: string | null;
  director_name?: string | null;
  profit_share_record_id?: string | null;
  amount_usd?: number;
  exchange_rate?: number;
  amount_kes?: number;
  payout_type?: 'full' | 'partial' | null;
  forex_bureau?: string | null;
  reference_id?: string | null;
  reference_rate?: number | null;
  variance_kes?: number | null;
  notes?: string | null;
};

export async function PUT(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, profile, admin } = auth;

    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can edit withdrawals.' }, { status: 403 });
    }

    const body = (await request.json()) as WithdrawUpdatePayload;
    if (!body.id) {
      return NextResponse.json({ error: 'Withdrawal ID is required.' }, { status: 422 });
    }

    // Read existing record for type-defaulting only — RPC re-reads under FOR UPDATE lock
    const { data: existingRecord } = await admin
      .from('withdrawals')
      .select('withdrawal_type, director_tag, director_user_id, withdrawal_date, amount_usd, amount_kes, exchange_rate, forex_bureau, reference_id, reference_rate, variance_kes, notes, recorded_by, profit_share_record_id, director_name, payout_type')
      .eq('id', body.id)
      .single();

    if (!existingRecord) {
      return NextResponse.json({ error: 'Withdrawal not found.' }, { status: 404 });
    }

    const submittedType = body.withdrawal_type ?? existingRecord.withdrawal_type;

    // Resolve final payload values, defaulting to existing values when not provided
    const nextAmountUsd = Number(body.amount_usd ?? existingRecord.amount_usd);
    const nextAmountKes = Number(body.amount_kes ?? existingRecord.amount_kes);
    const nextExchangeRate = Number(body.exchange_rate ?? existingRecord.exchange_rate);
    const nextWithdrawalDate = body.withdrawal_date ?? existingRecord.withdrawal_date;

    const nextDirectorName = submittedType === 'director_payout'
      ? (body.director_name ?? existingRecord.director_name)
      : null;
    const nextProfitShareRecordId = submittedType === 'director_payout'
      ? (body.profit_share_record_id === undefined
        ? (existingRecord.profit_share_record_id || null)
        : (body.profit_share_record_id || null))
      : null;
    const nextPayoutType = submittedType === 'director_payout'
      ? (body.payout_type ?? existingRecord.payout_type)
      : null;

    const mappedDirectorTag = nextDirectorName
      ? DIRECTOR_TAG_MAP[nextDirectorName as (typeof DIRECTOR_NAMES)[number]]
      : null;
    const nextDirectorTag = submittedType === 'director_payout'
      ? (body.director_tag ?? existingRecord.director_tag ?? mappedDirectorTag)
      : (body.director_tag ?? existingRecord.director_tag);
    const nextDirectorUserId = submittedType === 'director_payout'
      ? (body.director_user_id ?? existingRecord.director_user_id ?? existingRecord.recorded_by ?? user.id)
      : (body.director_user_id ?? existingRecord.director_user_id);

    const { data: updated, error: rpcErr } = await admin.rpc('fn_withdrawal_update', {
      p_withdrawal_id: body.id,
      p_updated_by: user.id,
      p_withdrawal_type: submittedType,
      p_purpose: submittedType === 'director_payout' ? 'director_payout' : 'company_operations',
      p_withdrawal_date: nextWithdrawalDate,
      p_amount_usd: nextAmountUsd,
      p_amount_kes: nextAmountKes,
      p_exchange_rate: nextExchangeRate,
      p_forex_bureau: body.forex_bureau ?? existingRecord.forex_bureau ?? null,
      p_reference_id: body.reference_id ?? existingRecord.reference_id ?? null,
      p_reference_rate: body.reference_rate ?? existingRecord.reference_rate ?? null,
      p_variance_kes: body.variance_kes ?? existingRecord.variance_kes ?? null,
      p_notes: body.notes ?? existingRecord.notes ?? null,
      p_director_tag: nextDirectorTag,
      p_director_user_id: nextDirectorUserId,
      p_director_name: nextDirectorName,
      p_profit_share_record_id: nextProfitShareRecordId,
      p_payout_type: nextPayoutType,
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message, code: 'WITHDRAWAL_UPDATE_FAILED' },
        { status: 422 },
      );
    }

    return NextResponse.json({ data: updated });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update withdrawal.', 'WITHDRAWAL_UPDATE_ERROR');
  }
}
