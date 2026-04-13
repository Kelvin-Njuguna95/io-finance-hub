import { NextResponse } from 'next/server';
import { createAdminClient, getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
    const { user, profile } = auth;

    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: opsFixed, error: opsError } = await admin
      .from('withdrawals')
      .update({
        withdrawal_type: 'operations',
        purpose: 'company_operations',
      })
      .is('withdrawal_type', null)
      .is('profit_share_record_id', null)
      .select('id');

    if (opsError) {
      return NextResponse.json({ error: 'Failed to fix operations records', details: opsError.message }, { status: 500 });
    }

    const { data: dpFixed, error: dpError } = await admin
      .from('withdrawals')
      .update({
        withdrawal_type: 'director_payout',
        purpose: 'director_payout',
      })
      .is('withdrawal_type', null)
      .not('profit_share_record_id', 'is', null)
      .select('id');

    if (dpError) {
      return NextResponse.json({ error: 'Failed to fix director payout records', details: dpError.message }, { status: 500 });
    }

    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'legacy_withdrawal_data_fixed',
      table_name: 'withdrawals',
      record_id: 'bulk_migration',
      old_values: { description: 'Legacy records had null withdrawal_type and incorrect purpose' },
      new_values: {
        operations_fixed: (opsFixed || []).length,
        director_payouts_fixed: (dpFixed || []).length,
      },
    });

    return NextResponse.json({
      success: true,
      operations_fixed: (opsFixed || []).length,
      director_payouts_fixed: (dpFixed || []).length,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to fix legacy withdrawal records.', 'WITHDRAWAL_FIX_LEGACY_ERROR');
  }
}
