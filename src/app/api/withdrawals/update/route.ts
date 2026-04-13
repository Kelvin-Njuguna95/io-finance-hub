import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const DIRECTOR_NAMES = ['Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'] as const;

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
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can edit withdrawals.' }, { status: 403 });
    }

    const body = (await request.json()) as WithdrawUpdatePayload;
    if (!body.id) {
      return NextResponse.json({ error: 'Withdrawal ID is required.' }, { status: 422 });
    }

    const { data: existingRecord } = await admin
      .from('withdrawals')
      .select('*')
      .eq('id', body.id)
      .single();

    if (!existingRecord) {
      return NextResponse.json({ error: 'Withdrawal not found.' }, { status: 404 });
    }

    const submittedType = body.withdrawal_type ?? existingRecord.withdrawal_type;
    const typeChanged = existingRecord.withdrawal_type !== submittedType;
    const nextAmountKes = Number(body.amount_kes ?? existingRecord.amount_kes);
    if (nextAmountKes <= 0) {
      return NextResponse.json({ error: 'Amount KES must be greater than zero.' }, { status: 422 });
    }

    const nextAmountUsd = Number(body.amount_usd ?? existingRecord.amount_usd);
    const nextExchangeRate = Number(body.exchange_rate ?? existingRecord.exchange_rate);

    if (submittedType === 'operations') {
      if (!body.director_tag || !body.director_user_id || nextAmountUsd <= 0 || nextExchangeRate <= 0) {
        return NextResponse.json({ error: 'Director, USD amount, and exchange rate are required.' }, { status: 422 });
      }
    }

    const nextProfitShareRecordId = submittedType === 'director_payout'
      ? (body.profit_share_record_id ?? existingRecord.profit_share_record_id)
      : null;
    const nextDirectorName = submittedType === 'director_payout'
      ? (body.director_name ?? existingRecord.director_name)
      : null;
    const nextPayoutType = submittedType === 'director_payout'
      ? (body.payout_type ?? existingRecord.payout_type)
      : null;

    if (submittedType === 'director_payout') {
      if (!nextProfitShareRecordId) {
        return NextResponse.json({ error: 'A profit share record must be selected for director payout withdrawals.' }, { status: 422 });
      }

      if (!nextDirectorName || !DIRECTOR_NAMES.includes(nextDirectorName as (typeof DIRECTOR_NAMES)[number])) {
        return NextResponse.json({ error: 'A valid director must be selected.' }, { status: 422 });
      }

      if (!['full', 'partial'].includes(String(nextPayoutType ?? ''))) {
        return NextResponse.json({ error: 'Payout type must be full or partial.' }, { status: 422 });
      }

      if (nextExchangeRate <= 0) {
        return NextResponse.json({ error: 'Exchange rate is required for director payout updates.' }, { status: 422 });
      }

      const { data: psRecord } = await admin
        .from('profit_share_records')
        .select('id, status, balance_remaining, director_name')
        .eq('id', nextProfitShareRecordId)
        .in('status', ['cfo_reviewed', 'approved'])
        .single();

      if (!psRecord) {
        return NextResponse.json({ error: 'Profit share record not found or is not approved.' }, { status: 422 });
      }

      if (psRecord.director_name !== nextDirectorName) {
        return NextResponse.json({ error: 'The selected profit share record does not match the selected director.' }, { status: 422 });
      }

      const originalAmountKes = Number(existingRecord.amount_kes || 0);
      const isSameRecord = existingRecord.withdrawal_type === 'director_payout'
        && existingRecord.profit_share_record_id
        && existingRecord.profit_share_record_id === nextProfitShareRecordId;
      const availableKes = Number(psRecord.balance_remaining || 0) + (isSameRecord ? originalAmountKes : 0);
      if (nextAmountKes > availableKes) {
        return NextResponse.json({ error: `Payout amount exceeds remaining balance. Maximum: ${availableKes}` }, { status: 422 });
      }
    }

    const editableData: Record<string, unknown> = {
      withdrawal_type: submittedType,
      purpose: submittedType === 'director_payout' ? 'director_payout' : 'company_operations',
      withdrawal_date: body.withdrawal_date ?? existingRecord.withdrawal_date,
      amount_usd: nextAmountUsd,
      exchange_rate: nextExchangeRate,
      amount_kes: nextAmountKes,
      forex_bureau: body.forex_bureau ?? existingRecord.forex_bureau,
      reference_id: body.reference_id ?? existingRecord.reference_id,
      reference_rate: body.reference_rate ?? existingRecord.reference_rate,
      variance_kes: body.variance_kes ?? existingRecord.variance_kes,
      notes: body.notes ?? existingRecord.notes,
    };

    if (submittedType === 'operations') {
      editableData.director_tag = body.director_tag ?? existingRecord.director_tag;
      editableData.director_user_id = body.director_user_id ?? existingRecord.director_user_id;
      editableData.director_name = null;
      editableData.profit_share_record_id = null;
      editableData.payout_type = null;
    } else {
      editableData.director_name = nextDirectorName;
      editableData.profit_share_record_id = nextProfitShareRecordId;
      editableData.payout_type = nextPayoutType;
      editableData.director_tag = null;
      editableData.director_user_id = null;
      editableData.project_id = null;
      editableData.budget_id = null;
    }

    const { data: updatedWithdrawal, error: updateError } = await admin
      .from('withdrawals')
      .update(editableData)
      .eq('id', body.id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (existingRecord.withdrawal_type === 'director_payout' && existingRecord.profit_share_record_id) {
      const { data: oldPSR } = await admin
        .from('profit_share_records')
        .select('balance_remaining, total_paid_out')
        .eq('id', existingRecord.profit_share_record_id)
        .single();

      if (oldPSR) {
        const creditedBalance = Number(oldPSR.balance_remaining || 0) + Number(existingRecord.amount_kes || 0);
        const creditedPaidOut = Number(oldPSR.total_paid_out || 0) - Number(existingRecord.amount_kes || 0);
        await admin
          .from('profit_share_records')
          .update({
            balance_remaining: creditedBalance,
            total_paid_out: Math.max(creditedPaidOut, 0),
            payout_status: creditedPaidOut <= 0 ? 'unpaid' : (creditedBalance <= 0 ? 'paid' : 'partial'),
          })
          .eq('id', existingRecord.profit_share_record_id);
      }
    }

    if (submittedType === 'director_payout' && nextProfitShareRecordId) {
      const { data: newPSR } = await admin
        .from('profit_share_records')
        .select('balance_remaining, total_paid_out')
        .eq('id', nextProfitShareRecordId)
        .single();

      if (!newPSR) {
        return NextResponse.json({ error: 'Profit share record not found' }, { status: 400 });
      }

      const availableBalance = Number(newPSR.balance_remaining || 0);
      if (nextAmountKes > availableBalance) {
        return NextResponse.json({
          error: `Amount exceeds remaining balance of ${availableBalance}`,
        }, { status: 400 });
      }

      const debitedBalance = availableBalance - nextAmountKes;
      const debitedPaidOut = Number(newPSR.total_paid_out || 0) + nextAmountKes;
      await admin
        .from('profit_share_records')
        .update({
          balance_remaining: debitedBalance,
          total_paid_out: debitedPaidOut,
          payout_status: debitedBalance <= 0 ? 'paid' : 'partial',
        })
        .eq('id', nextProfitShareRecordId);
    }

    if (Number(existingRecord.exchange_rate) !== Number(editableData.exchange_rate) && Number(editableData.exchange_rate) > 0) {
      const { data: existingForex } = await admin
        .from('forex_logs')
        .select('id')
        .eq('withdrawal_id', existingRecord.id)
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
          withdrawal_id: existingRecord.id,
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
      record_id: existingRecord.id,
      old_values: {
        withdrawal_date: existingRecord.withdrawal_date,
        director_tag: existingRecord.director_tag,
        director_user_id: existingRecord.director_user_id,
        director_name: existingRecord.director_name,
        profit_share_record_id: existingRecord.profit_share_record_id,
        amount_usd: existingRecord.amount_usd,
        exchange_rate: existingRecord.exchange_rate,
        amount_kes: existingRecord.amount_kes,
        payout_type: existingRecord.payout_type,
        forex_bureau: existingRecord.forex_bureau,
        reference_id: existingRecord.reference_id,
        reference_rate: existingRecord.reference_rate,
        variance_kes: existingRecord.variance_kes,
        notes: existingRecord.notes,
        withdrawal_type: existingRecord.withdrawal_type,
      },
      new_values: {
        ...editableData,
        withdrawal_type: submittedType,
        type_changed: typeChanged,
      },
    });

    return NextResponse.json({ data: updatedWithdrawal });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to update withdrawal.', 'WITHDRAWAL_UPDATE_ERROR');
  }
}
