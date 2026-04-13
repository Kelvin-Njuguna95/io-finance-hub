import { NextResponse } from 'next/server';
import { createAdminClient, getAuthUserProfile } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const auth = await getAuthUserProfile(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  const { user, profile } = auth;
  if (profile.role !== 'cfo') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  try {
    const { error: checkError } = await admin
      .from('withdrawals')
      .select('withdrawal_type')
      .limit(1);

    if (checkError && checkError.message.toLowerCase().includes('withdrawal_type')) {
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          query: 'ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_type text;',
        }),
      });

      if (!response.ok) {
        const sqlResponse = await fetch(`${supabaseUrl}/pg/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            query: 'ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS withdrawal_type text;',
          }),
        });

        if (!sqlResponse.ok) {
          return NextResponse.json({
            error: 'Cannot add withdrawal_type column automatically. Please add it manually in the Supabase dashboard: ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_type text;',
            manual_required: true,
          }, { status: 500 });
        }
      }
    }

    const { data: fixed, error: fixError } = await admin
      .from('withdrawals')
      .update({
        withdrawal_type: 'operations',
        purpose: 'company_operations',
      })
      .is('withdrawal_type', null)
      .select('id');

    if (fixError) {
      return NextResponse.json({
        error: 'Failed to backfill records',
        details: fixError.message,
      }, { status: 500 });
    }

    await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'legacy_withdrawal_data_fixed',
      table_name: 'withdrawals',
      record_id: 'bulk_migration',
      old_values: { description: 'Added withdrawal_type column and backfilled legacy records' },
      new_values: {
        records_fixed: (fixed || []).length,
      },
    });

    return NextResponse.json({
      success: true,
      records_fixed: (fixed || []).length,
    });
  } catch (e: any) {
    return NextResponse.json({
      error: 'Migration failed',
      details: e?.message || 'Unknown error',
      manual_sql: "ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_type text; UPDATE withdrawals SET withdrawal_type = 'operations', purpose = 'company_operations' WHERE withdrawal_type IS NULL;",
    }, { status: 500 });
  }
}
