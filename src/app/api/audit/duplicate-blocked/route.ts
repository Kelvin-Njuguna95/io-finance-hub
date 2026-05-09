import { NextResponse } from 'next/server';
import { getAuthUserProfile } from '@/lib/supabase/admin';
import { apiErrorResponse } from '@/lib/api-errors';
import {
  isValidUuid,
  fetchExistingByIdempotencyKey,
  logDuplicateSubmissionBlocked,
} from '@/lib/idempotency';

// Tight allow-list. Mirrors the union type on the client wrapper
// (src/lib/audit-duplicate-blocked.ts). Only the three tables hit by
// the six client-direct insert paths covered by IDEMP-4..IDEMP-10.
// Widen deliberately — any additional table needs an explicit add to
// keep this endpoint from doubling as an arbitrary audit-row writer.
const ALLOWED_TABLES = ['expenses', 'payments', 'invoices'] as const;
type AllowedTable = (typeof ALLOWED_TABLES)[number];

function isAllowedTable(value: unknown): value is AllowedTable {
  return (
    typeof value === 'string' &&
    (ALLOWED_TABLES as readonly string[]).includes(value)
  );
}

/**
 * Fire-and-forget telemetry endpoint for client-direct insert paths
 * that catch isIdempotencyConflict on a Supabase write. Those paths
 * cannot call logDuplicateSubmissionBlocked themselves — the helper
 * writes via the admin (service-role) client, which the browser doesn't
 * have. This route accepts { table_name, idempotency_key }, looks up
 * the existing row server-side, and writes the audit_logs row with
 * full attribution.
 *
 * Returns 200 in every reasonable shape (including missing-row and
 * silently-swallowed audit insert errors) so the client's fire-and-forget
 * call doesn't see a 5xx and surface it to the user. Genuine input
 * validation failures still 400.
 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthUserProfile(request);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error.message, code: 'AUTH_ERROR' },
        { status: auth.error.status },
      );
    }
    const { user, admin } = auth;

    const body = (await request.json().catch(() => null)) as
      | { table_name?: unknown; idempotency_key?: unknown }
      | null;
    if (!body) {
      return NextResponse.json(
        { error: 'Request body must be JSON.', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    if (!isAllowedTable(body.table_name)) {
      return NextResponse.json(
        {
          error: `table_name must be one of: ${ALLOWED_TABLES.join(', ')}`,
          code: 'TABLE_NOT_ALLOWED',
        },
        { status: 400 },
      );
    }
    const tableName: AllowedTable = body.table_name;

    if (!isValidUuid(body.idempotency_key)) {
      return NextResponse.json(
        {
          error: 'idempotency_key is required and must be a valid UUID.',
          code: 'IDEMPOTENCY_KEY_INVALID',
        },
        { status: 400 },
      );
    }
    const idempotencyKey = body.idempotency_key;

    const existing = await fetchExistingByIdempotencyKey<{ id: string }>(
      admin,
      tableName,
      idempotencyKey,
    );
    if (!existing) {
      // No row matches this key. Either the conflict raised on a
      // different unique index (defence-in-depth: isIdempotencyConflict
      // already filters for the idempotency_key index, but we don't
      // assume that here) or the row was deleted between conflict and
      // log call. No record_id → no meaningful audit row to write.
      // Don't error — the caller is fire-and-forget.
      return NextResponse.json({ ok: true, logged: false });
    }

    try {
      await logDuplicateSubmissionBlocked(admin, {
        userId: user.id,
        tableName,
        recordId: existing.id,
        idempotencyKey,
      });
    } catch (err) {
      // Audit write failed. Log server-side for forensic visibility but
      // still return 200 — a failed audit-trail write should not
      // surface as an error to a user whose primary write already
      // succeeded.
      console.error(
        '[audit/duplicate-blocked] logDuplicateSubmissionBlocked failed',
        err,
      );
      return NextResponse.json({ ok: true, logged: false });
    }

    return NextResponse.json({ ok: true, logged: true });
  } catch (error) {
    return apiErrorResponse(
      error,
      'Failed to record duplicate-submission audit entry.',
      'AUDIT_DUPLICATE_BLOCKED_ERROR',
    );
  }
}
