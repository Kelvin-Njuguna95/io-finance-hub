// Client-side fire-and-forget telemetry for client-direct insert paths
// that catch isIdempotencyConflict on a Supabase write. The browser
// can't call logDuplicateSubmissionBlocked() in src/lib/idempotency.ts
// directly because that helper writes via the admin (service-role)
// client to bypass RLS. Instead, we POST to /api/audit/duplicate-blocked
// which performs the lookup + audit insert with proper attribution.
//
// Closes the IDEMP-4..IDEMP-10 telemetry gap. The actual idempotency
// protection (the partial unique indexes from migrations 00047–00053)
// is unchanged; only the audit_logs row was missing on the client path.
//
// The tableName union is the runtime allow-list on the route. Keep them
// in sync manually — there are only three tables and they're load-bearing
// enough that drift would surface immediately on a 400.

'use client';

import { createClient } from '@/lib/supabase/client';

export type DuplicateBlockedTable = 'expenses' | 'payments' | 'invoices';

export async function fireDuplicateBlocked(
  tableName: DuplicateBlockedTable,
  idempotencyKey: string,
): Promise<void> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;

    await fetch('/api/audit/duplicate-blocked', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        table_name: tableName,
        idempotency_key: idempotencyKey,
      }),
    });
  } catch {
    // Fire-and-forget. The user's primary write already succeeded;
    // a failed audit ping must not surface as an error.
  }
}
