import { NextResponse } from 'next/server';
import { getAuthUserProfile, assertRole } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import {
  fetchExistingByIdempotencyKey,
  isIdempotencyConflict,
  isValidUuid,
  logDuplicateSubmissionBlocked,
} from '@/lib/idempotency';

// 70% project-share predated payout (PRED-2). Wraps fn_record_predated_payout
// from migration 00056. The RPC owns business-rule validation (role gate,
// director-existence, project-existence, past-only year_month); this route
// owns request shape + idempotency.

const PAYMENT_METHODS = [
  'bank_transfer',
  'cash',
  'mobile_money',
  'cheque',
  'other',
] as const;

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type PredatedPayoutPayload = {
  director_user_id: string;
  project_id: string;
  year_month: string;
  amount_kes: number;
  payment_method: string;
  notes?: string | null;
  idempotency_key: string;
};

type PredatedPayoutRow = {
  id: string;
  director_user_id: string;
  project_id: string;
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
        { error: 'Only CFO or Accountant can record predated payouts.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    let body: PredatedPayoutPayload;
    try {
      body = (await request.json()) as PredatedPayoutPayload;
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON.', code: 'INVALID_JSON' },
        { status: 400 },
      );
    }

    // Shape validation. The RPC enforces business rules; this layer only
    // checks the inputs are well-formed before round-tripping to Postgres.
    if (!isValidUuid(body.director_user_id)) {
      return NextResponse.json(
        { error: 'director_user_id must be a valid UUID.', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!isValidUuid(body.project_id)) {
      return NextResponse.json(
        { error: 'project_id must be a valid UUID.', code: 'VALIDATION_ERROR' },
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

    // Pre-flight idempotency check. If a row exists for this key already,
    // return it without invoking the RPC. Defense-in-depth: the partial
    // unique index would also trap a true race at INSERT time.
    const preExisting = await fetchExistingByIdempotencyKey<PredatedPayoutRow>(
      admin,
      'predated_payouts',
      body.idempotency_key,
    );
    if (preExisting) {
      return NextResponse.json({ success: true, payout: preExisting });
    }

    const { data, error } = await admin.rpc('fn_record_predated_payout', {
      p_caller_id: user.id,
      p_director_user_id: body.director_user_id,
      p_project_id: body.project_id,
      p_year_month: body.year_month,
      p_amount_kes: body.amount_kes,
      p_payment_method: body.payment_method,
      p_notes: body.notes ?? null,
      p_idempotency_key: body.idempotency_key,
    });

    if (error && isIdempotencyConflict(error)) {
      const existing = await fetchExistingByIdempotencyKey<PredatedPayoutRow>(
        admin,
        'predated_payouts',
        body.idempotency_key,
      );
      if (existing) {
        await logDuplicateSubmissionBlocked(admin, {
          userId: user.id,
          tableName: 'predated_payouts',
          recordId: existing.id,
          idempotencyKey: body.idempotency_key,
        });
        return NextResponse.json({ success: true, payout: existing });
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
      if (msg.includes('Project') && msg.includes('does not exist')) {
        return NextResponse.json({ error: msg, code: 'INVALID_PROJECT' }, { status: 400 });
      }
      if (msg.includes('year_month must be a past month')) {
        return NextResponse.json({ error: msg, code: 'INVALID_YEAR_MONTH' }, { status: 400 });
      }
      return NextResponse.json({ error: msg, code: 'RPC_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ success: true, payout: data });
  } catch (error) {
    return apiErrorResponse(error, 'Failed to record predated payout.', 'PREDATED_PAYOUT_ERROR');
  }
}
