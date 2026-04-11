import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type ClosePayload = {
  action: 'close' | 'reopen';
  year_month: string;
  warnings_acknowledged?: string[];
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error.message, code: 'AUTH_ERROR' }, { status: auth.error.status });
    }

    const { profile, admin } = auth;
    if (profile.role !== 'cfo') {
      return NextResponse.json({ error: 'Only CFO can close or reopen months.' }, { status: 403 });
    }

    const body = (await request.json()) as ClosePayload;
    if (!body?.year_month || !body?.action) {
      return NextResponse.json({ error: 'year_month and action are required.' }, { status: 422 });
    }

    if (body.action === 'close') {
      const { error } = await admin.rpc('fn_close_month', {
        p_year_month: body.year_month,
        p_warnings_acknowledged: body.warnings_acknowledged ?? [],
      });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (!body.reason?.trim()) {
      return NextResponse.json({ error: 'reason is required when reopening a month.' }, { status: 422 });
    }

    const { error } = await admin.rpc('fn_reopen_month', {
      p_year_month: body.year_month,
      p_reason: body.reason,
    });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to process month closure action.', 'MONTH_CLOSURE_ERROR');
  }
}
