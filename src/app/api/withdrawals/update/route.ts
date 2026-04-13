import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type WithdrawUpdatePayload = {
  id?: string;
  withdrawal_date?: string;
  director_tag?: string | null;
  director_user_id?: string | null;
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
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can edit withdrawals.' }, { status: 403 });
    }

    const body = (await request.json()) as WithdrawUpdatePayload;
    if (!body.id) {
      return NextResponse.json({ error: 'Withdrawal ID is required.' }, { status: 422 });
    }

    const { data: withdrawal } = await admin
      .from('withdrawals')
      .select('*')
      .eq('id', body.id)
      .single();

    if (!withdrawal) {
      return NextResponse.json({ error: 'Withdrawal not found.' }, { status: 404 });
    }

    const nextAmountKes = Number(body.amount_kes ?? withdrawal.amount_kes);
    if (nextAmountKes <= 0) {
      return NextResponse.json({ error: 'Amount KES must be greater than zero.' }, { status: 422 });
    }

    const nextAmountUsd = Number(body.amount_usd ?? withdrawal.amount_usd);
    const nextExchangeRate = Number(body.exchange_rate ?? withdrawal.exchange_rate);

    if (withdrawal.withdrawal_type === 'operations') {
      if (!body.director_tag || !body.director_user_id || nextAmountUsd <= 0 || nextExchangeRate <= 0) {
        return NextResponse.json({ error: 'Director, USD amount, and exchange rate are required.' }, { status: 422 });
      }
    }

    if (withdrawal.withdrawal_type === 'director_payout') {
      if (!withdrawal.profit_share_record_id) {
        return NextResponse.json({ error: 'Linked profit share record is missing for this withdrawal.' }, { status: 422 });
      }

      if (!['full', 'partial'].includes(String(body.payout_type ?? withdrawal.payout_type ?? ''))) {
        return NextResponse.json({ error: 'Payout type must be full or partial.' }, { status: 422 });
      }

      if (nextExchangeRate <= 0) {
        return NextResponse.json({ error: 'Exchange rate is required for director payout updates.' }, { status: 422 });
      }

      const { data: psRecord } = await admin
        .from('profit_share_records')
        .select('id, status, balance_remaining')
        .eq('id', withdrawal.profit_share_record_id)
        .in('status', ['cfo_reviewed', 'approved'])
        .single();

      if (!psRecord) {
        return NextResponse.json({ error: 'The linked profit share record was not found or is not approved.' }, { status: 422 });
      }

      const originalAmountKes = Number(withdrawal.amount_kes || 0);
      const availableKes = Number(psRecord.balance_remaining || 0) + originalAmountKes;
      if (nextAmountKes > availableKes) {
        return NextResponse.json({ error: `Payout amount exceeds remaining balance. Maximum: ${availableKes}` }, { status: 422 });
      }
    }

    const editableData = withdrawal.withdrawal_type === 'operations'
      ? {
        withdrawal_date: body.withdrawal_date ?? withdrawal.withdrawal_date,
        director_tag: body.director_tag ?? withdrawal.director_tag,
        director_user_id: body.director_user_id ?? withdrawal.director_user_id,
        amount_usd: nextAmountUsd,
        exchange_rate: nextExchangeRate,
        amount_kes: nextAmountKes,
        forex_bureau: body.forex_bureau ?? withdrawal.forex_bureau,
        reference_id: body.reference_id ?? withdrawal.reference_id,
        reference_rate: body.reference_rate ?? withdrawal.reference_rate,
        variance_kes: body.variance_kes ?? withdrawal.variance_kes,
        notes: body.notes ?? withdrawal.notes,
      }
      : {
        withdrawal_date: body.withdrawal_date ?? withdrawal.withdrawal_date,
        amount_usd: nextAmountUsd,
        exchange_rate: nextExchangeRate,
        amount_kes: nextAmountKes,
        payout_type: body.payout_type ?? withdrawal.payout_type,
        forex_bureau: body.forex_bureau ?? withdrawal.forex_bureau,
        reference_id: body.reference_id ?? withdrawal.reference_id,
        reference_rate: body.reference_rate ?? withdrawal.reference_rate,
        variance_kes: body.variance_kes ?? withdrawal.variance_kes,
        notes: body.notes ?? withdrawal.notes,
      };

    const { data: updatedWithdrawal, error: updateError } = await admin
      .from('withdrawals')
      .update(editableData)
      .eq('id', body.id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (Number(withdrawal.exchange_rate) !== Number(editableData.exchange_rate) && Number(editableData.exchange_rate) > 0) {
      const { data: existingForex } = await admin
        .from('forex_logs')
        .select('id')
        .eq('withdrawal_id', withdrawal.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingForex?.id) {
        await admin
          .from('forex_logs')
          .update({
            rate_date: editableData.withdrawal_date,
            rate_usd_to_kes: editableData.exchange_rate,
            source: editableData.forex_bureau || 'Manual entry',
          })
          .eq('id', existingForex.id);
      } else {
        await admin.from('forex_logs').insert({
          withdrawal_id: withdrawal.id,
          rate_date: editableData.withdrawal_date,
          rate_usd_to_kes: editableData.exchange_rate,
          source: editableData.forex_bureau || 'Manual entry',
        });
      }
    }

    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'withdrawal_edited',
      table_name: 'withdrawals',
      record_id: withdrawal.id,
      old_values: {
        withdrawal_date: withdrawal.withdrawal_date,
        director_tag: withdrawal.director_tag,
        director_user_id: withdrawal.director_user_id,
        amount_usd: withdrawal.amount_usd,
        exchange_rate: withdrawal.exchange_rate,
        amount_kes: withdrawal.amount_kes,
        payout_type: withdrawal.payout_type,
        forex_bureau: withdrawal.forex_bureau,
        reference_id: withdrawal.reference_id,
        reference_rate: withdrawal.reference_rate,
        variance_kes: withdrawal.variance_kes,
        notes: withdrawal.notes,
      },
      new_values: editableData,
    });

    return NextResponse.json({ data: updatedWithdrawal });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update withdrawal.', 'WITHDRAWAL_UPDATE_ERROR');
  }
}
