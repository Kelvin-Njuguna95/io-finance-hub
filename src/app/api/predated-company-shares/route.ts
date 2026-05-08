import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import {
  fetchExistingByIdempotencyKey,
  isIdempotencyConflict,
  isValidUuid,
  logDuplicateSubmissionBlocked,
} from '@/lib/idempotency';

// 30% company-pool predated distribution (PRED-2). Wraps
// fn_record_predated_company_share from migration 00056. Same shape as
// /api/predated-payouts minus project_id (the 30% is pooled at company
// level, no per-project attribution applies).

const PAYMENT_METHODS = [
  'bank_transfer',
  'cash',
  'mobile_money',
  'cheque',
  'other',
] as const;

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type PredatedCompanySharePayload = {
  director_user_id: string;
  year_month: string;
  amount_kes: number;
  payment_method: string;
  notes?: string | null;
  idempotency_key: string;
  // project_id is intentionally NOT part of this payload. If a caller
  // sends it (e.g. mistakenly reusing the 70% client), the route logs
  // a warning and ignores it for forward compatibility.
  project_id?: string;
};

type PredatedCompanyShareRow = {
  id: string;
  director_user_id: string;
  year_month: string;
  amount_kes: number | string;
  payment_method: string;
  notes: string | null;
  idempotency_key: string;
  recorded_by: string;
  recorded_at: string;
  created_at: string;
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

    const roleErr = assertRole(profile, ['cfo', 'accountant']);
    if (roleErr) {
      return NextResponse.json(
        {
          error: 'Only CFO or Accountant can record predated company-share distributions.',
          code: 'FORBIDDEN',
        },
        { status: 403 },
      );
    }

    let body: PredatedCompanySharePayload;
    try {
      body = (await request.json()) as PredatedCompanySharePayload;
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON.', code: 'INVALID_JSON' },
        { status: 400 },
      );
    }

    if (body.project_id !== undefined) {
      console.warn(
        '[predated-company-shares] project_id sent on a 30% pool route — ignoring. The 30% pool is company-level, not per-project.',
      );
    }

    if (!isValidUuid(body.director_user_id)) {
      return NextResponse.json(
        { error: 'director_user_id must be a valid UUID.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!YEAR_MONTH_RE.test(body.year_month ?? '')) {
      return NextResponse.json(
        { error: 'year_month must match YYYY-MM format.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (typeof body.amount_kes !== 'number' || !Number.isFinite(body.amount_kes) || body.amount_kes <= 0) {
      return NextResponse.json(
        { error: 'amount_kes must be a positive number.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!PAYMENT_METHODS.includes(body.payment_method as (typeof PAYMENT_METHODS)[number])) {
      return NextResponse.json(
        {
          error: `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}.`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 },
      );
    }
    if (!isValidUuid(body.idempotency_key)) {
      return NextResponse.json(
        {
          error: 'idempotency_key is required and must be a valid UUID.',
          code: 'IDEMPOTENCY_KEY_INVALID',
        },
        { status: 400 },
      );
    }

    // Pre-flight idempotency check.
    const preExisting = await fetchExistingByIdempotencyKey<PredatedCompanyShareRow>(
      admin,
      'predated_company_share_distributions',
      body.idempotency_key,
    );
    if (preExisting) {
      return NextResponse.json({ success: true, distribution: preExisting });
    }

    const { data, error } = await admin.rpc('fn_record_predated_company_share', {
      p_caller_id: user.id,
      p_director_user_id: body.director_user_id,
      p_year_month: body.year_month,
      p_amount_kes: body.amount_kes,
      p_payment_method: body.payment_method,
      p_notes: body.notes ?? null,
      p_idempotency_key: body.idempotency_key,
    });

    if (error && isIdempotencyConflict(error)) {
      const existing = await fetchExistingByIdempotencyKey<PredatedCompanyShareRow>(
        admin,
        'predated_company_share_distributions',
        body.idempotency_key,
      );
      if (existing) {
        await logDuplicateSubmissionBlocked(admin, {
          userId: user.id,
          tableName: 'predated_company_share_distributions',
          recordId: existing.id,
          idempotencyKey: body.idempotency_key,
        });
        return NextResponse.json({ success: true, distribution: existing });
      }
      // Conflict raised but row unfindable — fall through to error path
    }

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('Only CFO or Accountant')) {
        return NextResponse.json({ error: msg, code: 'FORBIDDEN' }, { status: 403 });
      }
      if (msg.includes('is not a director')) {
        return NextResponse.json({ error: msg, code: 'INVALID_DIRECTOR' }, { status: 400 });
      }
      if (msg.includes('year_month must be a past month')) {
        return NextResponse.json({ error: msg, code: 'INVALID_YEAR_MONTH' }, { status: 400 });
      }
      return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ success: true, distribution: data });
  } catch (error) {
    return apiErrorResponse(
      error,
      'Failed to record predated company-share distribution.',
      'PREDATED_COMPANY_SHARE_ERROR',
    );
  }
}
