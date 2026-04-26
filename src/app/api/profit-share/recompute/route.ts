import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';

type RecomputePayload = {
  year_month: string;
};

type RecomputeRow = {
  year_month: string;
  rows_created: number;
  total_director_share_kes: number;
  total_company_share_kes: number;
  loss_making_projects: number;
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
    if (profile.role !== 'cfo') {
      return NextResponse.json(
        { error: 'Only CFO can recompute profit share.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as RecomputePayload;
    const yearMonth = body?.year_month;

    if (!yearMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return NextResponse.json(
        { error: 'year_month must match YYYY-MM format.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { data, error } = await admin.rpc('fn_recompute_profit_share', {
      p_year_month: yearMonth,
    });

    if (error) {
      // Closed-month guard from the RPC body — translate to 409.
      if (error.message?.includes('Cannot recompute profit share for closed month')) {
        return NextResponse.json(
          {
            error: error.message,
            code: 'MONTH_CLOSED',
            hint: 'Reopen the month first, then recompute.',
          },
          { status: 409 },
        );
      }
      // CFO guard from the RPC body — defensive; route auth should have caught this first.
      if (error.message?.includes('Only CFO role can recompute')) {
        return NextResponse.json(
          { error: error.message, code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
      // Anything else: propagate through apiErrorResponse → 500.
      return apiErrorResponse(error, 'Failed to recompute profit share.', 'PROFIT_SHARE_RECOMPUTE_ERROR');
    }

    // RPC returns TABLE (5 columns); Supabase wraps that as Array<Row>.
    const result = (data as RecomputeRow[] | null)?.[0];
    if (!result) {
      return NextResponse.json(
        { error: 'Recompute returned no result row.', code: 'RPC_EMPTY' },
        { status: 500 },
      );
    }

    // Best-effort audit. Failure is logged but does not fail the request —
    // the recompute itself succeeded; audit is observability, not consistency.
    const { error: auditError } = await admin.from('audit_logs').insert({
      user_id: user.id,
      action: 'profit_share_recomputed',
      table_name: 'profit_share_records',
      record_id: null,
      new_values: {
        year_month: result.year_month,
        rows_created: result.rows_created,
        total_director_share_kes: result.total_director_share_kes,
        total_company_share_kes: result.total_company_share_kes,
        loss_making_projects: result.loss_making_projects,
      },
    });
    if (auditError) {
      console.error('[profit-share/recompute] audit log insert failed:', auditError, {
        userId: user.id,
        yearMonth,
      });
    }

    return NextResponse.json({
      status: 'ok',
      year_month: result.year_month,
      rows_created: result.rows_created,
      total_director_share_kes: result.total_director_share_kes,
      total_company_share_kes: result.total_company_share_kes,
      loss_making_projects: result.loss_making_projects,
    });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to recompute profit share.', 'PROFIT_SHARE_RECOMPUTE_ERROR');
  }
}
