// Server-side helpers for the idempotency-key protection added by
// migrations 00047–00053. Used by API routes that INSERT financial records:
//
//   1. Validate the incoming idempotency_key is a UUID (reject 400 otherwise).
//   2. Pass the key through to the INSERT.
//   3. If the INSERT fails with isIdempotencyConflict(error) === true,
//      treat it as "already created on a prior attempt" — fetch the
//      existing row by key, log a duplicate_submission_blocked entry to
//      audit_logs, and return the existing row to the client as success.
//
// Pattern is intentionally framework-agnostic so each route handler can
// compose it however suits — no Next-specific or table-specific assumptions.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if the value is a syntactically valid UUID v1–v5 string. */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * True if the error is a unique-violation specifically on an
 * idempotency_key partial index. Filters out unrelated unique-violations
 * on other indexes of the same table.
 */
export function isIdempotencyConflict(
  error: PostgrestError | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code !== UNIQUE_VIOLATION) return false;
  // Postgres emits e.g. `duplicate key value violates unique constraint
  // "idx_payments_idempotency_key"`. The index name carries the column
  // name, so a substring match is sufficient and won't false-match an
  // unrelated unique constraint on the same table.
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`;
  return /idempotency_key/i.test(haystack);
}

/**
 * Fetches the row previously inserted with this idempotency key. Returns
 * null if no row matches (which would be unexpected after a 23505 — the
 * caller should treat that as a real error rather than silently succeed).
 */
export async function fetchExistingByIdempotencyKey<T = unknown>(
  admin: SupabaseClient,
  table: string,
  idempotencyKey: string,
): Promise<T | null> {
  const { data } = await admin
    .from(table)
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  return (data as T | null) ?? null;
}

/**
 * Records that a duplicate submission was blocked. Fire-and-forget — the
 * primary response (returning the existing row) does not depend on this
 * succeeding, but the entry is the audit trail for monitoring near-misses.
 */
export async function logDuplicateSubmissionBlocked(
  admin: SupabaseClient,
  params: {
    userId: string | null;
    tableName: string;
    recordId: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await admin.from('audit_logs').insert({
    user_id: params.userId,
    action: 'duplicate_submission_blocked',
    table_name: params.tableName,
    record_id: params.recordId,
    new_values: { idempotency_key: params.idempotencyKey },
  });
}
