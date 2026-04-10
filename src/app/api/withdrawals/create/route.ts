import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

const DIRECTOR_NAMES = ['Kelvin', 'Evans', 'Dan', 'Gidraph', 'Victor'] as const;

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
    if ('error' in auth) return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    const { user, profile, admin } = auth;

    if (!['cfo', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'Only CFO and Accountant can record withdrawals.' }, { status: 403 });
    }

    const body = (await request.json()) as WithdrawPayload;
    const withdrawalType = body.withdrawal_type ?? 'operations';
    const withdrawalDate = body.withdrawal_date || new Date().toISOString().split('T')[0];

    if (Number(body.amount_kes) <= 0) {
      return NextResponse.json({ error: 'Amount KES must be greater than zero.' }, { status: 422 });
    }

    if (withdrawalType === 'director_payout') {
      if (!body.profit_share_record_id) {
        return NextResponse.json({ error: 'A profit share record must be selected for director payout withdrawals.' }, { status: 422 });
      }

      if (!body.director_name || !DIRECTOR_NAMES.includes(body.director_name as (typeof DIRECTOR_NAMES)[number])) {
        return NextResponse.json({ error: 'A valid director must be selected.' }, { status: 422 });
      }

      if (!body.payout_type || !['full', 'partial'].includes(body.payout_type)) {
        return NextResponse.json({ error: 'Payout type must be full or partial.' }, { status: 422 });
      }

      const { data: psRecord } = await admin
        .from('profit_share_records')
        .select('id, status, balance_remaining, director_name')
        .eq('id', body.profit_share_record_id)
        .eq('status', 'cfo_reviewed')
        .single();

      if (!psRecord) {
        return NextResponse.json({ error: 'The selected profit share record was not found or has not been approved.' }, { status: 422 });
      }

      if (psRecord.director_name !== body.director_name) {
        return NextResponse.json({ error: 'The selected profit share record does not match the selected director.' }, { status: 422 });
      }

      const remaining = Number(psRecord.balance_remaining || 0);
      if (Number(body.amount_kes) > remaining) {
        return NextResponse.json({ error: `Payout amount exceeds remaining balance. Maximum: ${remaining}` }, { status: 422 });
      }

      const { data: withdrawal, error } = await admin
        .from('withdrawals')
        .insert({
          withdrawal_type: 'director_payout',
          profit_share_record_id: body.profit_share_record_id,
          director_name: body.director_name,
          payout_type: body.payout_type,
          amount_usd: body.amount_usd,
          exchange_rate: body.exchange_rate,
          amount_kes: body.amount_kes,
          notes: body.notes || null,
          recorded_by: user.id,
          withdrawal_date: withdrawalDate,
          year_month: body.year_month || withdrawalDate.slice(0, 7),
        })
        .select()
        .single();

      if (error) throw error;

      await admin.from('audit_logs').insert({
        user_id: user.id,
        action: 'director_payout_withdrawal_recorded',
        table_name: 'withdrawals',
        record_id: withdrawal.id,
        new_values: {
          director_name: body.director_name,
          profit_share_record_id: body.profit_share_record_id,
          payout_type: body.payout_type,
          amount_kes: body.amount_kes,
          amount_usd: body.amount_usd,
        },
      });

      return NextResponse.json({ data: withdrawal });
    }

    if (!body.director_tag || !body.director_user_id || Number(body.amount_usd) <= 0 || Number(body.exchange_rate) <= 0) {
      return NextResponse.json({ error: 'Director, USD amount, and exchange rate are required' }, { status: 422 });
    }

    const { data: withdrawal, error } = await admin.from('withdrawals').insert({
      withdrawal_type: 'operations',
      withdrawal_date: withdrawalDate,
      director_tag: body.director_tag,
      director_user_id: body.director_user_id,
      amount_usd: body.amount_usd,
      exchange_rate: body.exchange_rate,
      amount_kes: body.amount_kes,
      forex_bureau: body.forex_bureau || null,
      reference_id: body.reference_id || null,
      reference_rate: body.reference_rate || null,
      variance_kes: body.variance_kes || null,
      year_month: body.year_month || withdrawalDate.slice(0, 7),
      notes: body.notes || null,
      recorded_by: user.id,
    }).select().single();

    if (error) throw error;

    if (body.exchange_rate > 0) {
      await admin.from('forex_logs').insert({
        withdrawal_id: withdrawal.id,
        rate_date: withdrawalDate,
        rate_usd_to_kes: body.exchange_rate,
        source: body.forex_bureau || 'Manual entry',
      });
    }

    return NextResponse.json({ data: withdrawal });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to record withdrawal.', 'WITHDRAWAL_CREATE_ERROR');
  }
}
